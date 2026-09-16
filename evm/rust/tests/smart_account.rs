use alloy::{
    primitives::{Address, Bytes, U256, address},
    rpc::types::erc4337::PackedUserOperation,
    sol_types::SolCall,
};
use serde::Deserialize;
use swig_evm::smart_account::{
    CallExecution, ExecutionKind, MAX_TIMESTAMP, SmartAccountError, SwigSmartAccount, TokenFunding,
    getUserOpHashCall, pack_user_operation,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    name: String,
    operation: PackedUserOperation,
    hash_call: Bytes,
}
fn account(kind: ExecutionKind) -> SwigSmartAccount {
    SwigSmartAccount {
        address: address!("1111111111111111111111111111111111111111"),
        chain_id: 1337,
        role_id: 2,
        signer: address!("2222222222222222222222222222222222222222"),
        valid_after: 10,
        valid_until: 1000,
        kind,
    }
}
fn execution() -> CallExecution {
    CallExecution {
        target: address!("3333333333333333333333333333333333333333"),
        value: U256::from(5),
        data: Bytes::from_static(&[0x12, 0x34]),
        tokenFunding: vec![],
        sweepTokens: vec![],
    }
}

#[test]
fn envelopes_and_entrypoint_calls_match_viem_vectors() -> Result<(), Box<dyn std::error::Error>> {
    let vectors: Vec<Vector> = serde_json::from_str(include_str!("../../fixtures/4337.json"))?;
    for vector in vectors {
        let kind = match vector.name.as_str() {
            "signV2" => ExecutionKind::SignV2,
            "capsule" => ExecutionKind::Capsule,
            _ => return Err("unknown fixture".into()),
        };
        let account = account(kind);
        let mut execution = execution();
        if kind == ExecutionKind::Capsule {
            let token = address!("4444444444444444444444444444444444444444");
            execution.tokenFunding.push(TokenFunding {
                token,
                amount: u64::MAX,
            });
            execution.sweepTokens.push(token);
        }
        assert_eq!(
            account.encode_call(U256::from(7), execution)?,
            vector.operation.call_data
        );
        let packed = pack_user_operation(&vector.operation)?;
        account.validate_user_operation(&packed)?;
        assert_eq!(
            getUserOpHashCall {
                userOp: (
                    packed.sender,
                    packed.nonce,
                    packed.initCode,
                    packed.callData,
                    packed.accountGasLimits,
                    packed.preVerificationGas,
                    packed.gasFees,
                    packed.paymasterAndData,
                    packed.signature,
                )
            }
            .abi_encode(),
            vector.hash_call.as_ref()
        );
    }
    Ok(())
}

#[test]
fn rejects_foreign_or_noncanonical_operations() -> Result<(), Box<dyn std::error::Error>> {
    let vectors: Vec<Vector> = serde_json::from_str(include_str!("../../fixtures/4337.json"))?;
    let vector = vectors.first().ok_or("missing vector")?;
    let valid = pack_user_operation(&vector.operation)?;
    let account = account(ExecutionKind::SignV2);
    let mut changed = valid.clone();
    changed.sender = Address::ZERO;
    assert!(account.validate_user_operation(&changed).is_err());
    changed = valid.clone();
    changed.nonce = U256::ZERO;
    assert!(account.validate_user_operation(&changed).is_err());
    changed = valid.clone();
    changed.initCode = Bytes::from_static(&[1]);
    assert!(matches!(
        account.validate_user_operation(&changed),
        Err(SmartAccountError::UnsupportedOperation)
    ));
    changed = valid.clone();
    changed.paymasterAndData = Bytes::new();
    assert!(account.validate_user_operation(&changed).is_err());
    changed = valid.clone();
    let mut bytes = changed.callData.to_vec();
    bytes.push(0);
    changed.callData = bytes.into();
    assert!(account.validate_user_operation(&changed).is_err());
    changed = valid;
    changed.callData = Bytes::from_static(&[0]);
    assert!(account.validate_user_operation(&changed).is_err());
    let mut changed_account = account;
    changed_account.signer = Address::ZERO;
    assert!(
        changed_account
            .validate_user_operation(&pack_user_operation(&vector.operation)?)
            .is_err()
    );
    Ok(())
}

#[test]
fn gas_and_validity_boundaries_do_not_truncate() -> Result<(), Box<dyn std::error::Error>> {
    let vectors: Vec<Vector> = serde_json::from_str(include_str!("../../fixtures/4337.json"))?;
    let mut operation = vectors.first().ok_or("missing fixture")?.operation.clone();
    operation.call_gas_limit = U256::from(u128::MAX) + U256::from(1);
    assert!(matches!(
        pack_user_operation(&operation),
        Err(SmartAccountError::InvalidGasLimits)
    ));
    let mut account = account(ExecutionKind::SignV2);
    account.valid_until = MAX_TIMESTAMP;
    assert!(account.encode_call(U256::ZERO, execution()).is_ok());
    account.valid_until += 1;
    assert!(matches!(
        account.encode_call(U256::ZERO, execution()),
        Err(SmartAccountError::InvalidValidity)
    ));
    account.valid_until = 0;
    assert!(account.encode_call(U256::ZERO, execution()).is_err());
    account.valid_after = u64::MAX;
    assert!(account.encode_call(U256::ZERO, execution()).is_err());
    Ok(())
}
