//! Local sponsored transfer through standard Alloy JSON-RPC; no Swig bundler client.
use alloy::{
    primitives::{Address, B256, Bytes, U256, aliases::U192},
    providers::{Provider, ProviderBuilder},
    rpc::types::{TransactionRequest, erc4337::PackedUserOperation},
    signers::{Signer, local::PrivateKeySigner},
    sol_types::{SolCall, SolValue},
};
use serde::Deserialize;
use std::{env, error::Error, time::Duration};
use swig_evm::{
    contracts::config::SwigConfig,
    smart_account::{
        CallExecution, ENTRY_POINT_V09, ExecutionKind, SwigSmartAccount, getNonceCall,
        pack_user_operation,
    },
};

// The current Alloy convenience ERC-4337 methods use older response shapes.
// Its standard typed RPC client interoperates with the current v0.9 methods directly.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GasEstimate {
    call_gas_limit: U256,
    pre_verification_gas: U256,
    verification_gas_limit: U256,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationReceipt {
    success: bool,
    user_op_hash: B256,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let provider = ProviderBuilder::new()
        .connect_http(env::var("RPC_URL")?.parse()?)
        .erased();
    let bundler = ProviderBuilder::new().connect_http(env::var("BUNDLER_URL")?.parse()?);
    let chain_id = provider.get_chain_id().await?;
    if chain_id != 1337 {
        return Err(
            "this example requires the disposable Compose chain and fixture paymaster".into(),
        );
    }
    let signer: PrivateKeySigner = env::var("SIGNER_PRIVATE_KEY")?
        .parse()
        .map_err(|_| "invalid signing key")?;
    let address: Address = env::var("ACCOUNT_ADDRESS")?.parse()?;
    let role_id: u32 = env::var("ROLE_ID").unwrap_or_else(|_| "0".into()).parse()?;
    let recipient: Address = env::var("RECIPIENT")?.parse()?;
    let paymaster: Address = env::var("TEST_PAYMASTER_ADDRESS")?.parse()?;
    let config = SwigConfig::new(address, provider.clone());
    let block = provider
        .get_block_by_number(alloy::eips::BlockNumberOrTag::Latest)
        .await?
        .ok_or("missing latest block")?;
    let account = SwigSmartAccount {
        address,
        chain_id,
        role_id,
        signer: signer.address(),
        valid_after: 0,
        valid_until: block.header.timestamp + 600,
        kind: ExecutionKind::SignV2,
    };
    let call_data = account.encode_call(
        config.authorizationNonce(role_id).call().await?,
        CallExecution {
            target: recipient,
            value: env::var("VALUE_WEI")
                .unwrap_or_else(|_| "1".into())
                .parse()?,
            data: Bytes::new(),
            tokenFunding: vec![],
            sweepTokens: vec![],
        },
    )?;
    let nonce_call = getNonceCall {
        sender: address,
        key: U192::from(role_id),
    };
    let nonce = U256::abi_decode(
        &provider
            .call(
                TransactionRequest::default()
                    .to(ENTRY_POINT_V09)
                    .input(nonce_call.abi_encode().into()),
            )
            .await?,
    )?;
    // The local Rundler has its own admission fee floor; use its advertised tip.
    let priority_fee: U256 = bundler
        .client()
        .request("rundler_maxPriorityFeePerGas", ())
        .await?;
    let base_fee = block.header.base_fee_per_gas.ok_or("missing base fee")?;
    let mut operation = PackedUserOperation {
        sender: address,
        nonce,
        factory: None,
        factory_data: None,
        call_data,
        call_gas_limit: U256::from(500_000),
        verification_gas_limit: U256::from(200_000),
        pre_verification_gas: U256::from(100_000),
        max_fee_per_gas: U256::from(base_fee) * U256::from(2) + priority_fee,
        max_priority_fee_per_gas: priority_fee,
        paymaster: Some(paymaster),
        paymaster_verification_gas_limit: Some(U256::from(100_000)),
        paymaster_post_op_gas_limit: Some(U256::from(50_000)),
        paymaster_data: Some(Bytes::new()),
        signature: alloy::primitives::hex::decode(format!(
            "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798{}1b",
            "22".repeat(32)
        ))?
        .into(),
    };
    let estimate: GasEstimate = bundler
        .client()
        .request(
            "eth_estimateUserOperationGas",
            (&operation, ENTRY_POINT_V09),
        )
        .await?;
    operation.call_gas_limit = estimate.call_gas_limit;
    operation.pre_verification_gas = estimate.pre_verification_gas;
    operation.verification_gas_limit = estimate.verification_gas_limit.max(U256::from(200_000));
    let packed = pack_user_operation(&operation)?;
    let hash = account.user_operation_hash(provider, packed).await?;
    operation.signature = signer.sign_hash(&hash).await?.as_bytes().into();
    let submitted: B256 = bundler
        .client()
        .request("eth_sendUserOperation", (&operation, ENTRY_POINT_V09))
        .await?;
    if submitted != hash {
        return Err("bundler hash differs from EntryPoint".into());
    }
    for _ in 0..120 {
        let receipt: Option<OperationReceipt> = bundler
            .client()
            .request("eth_getUserOperationReceipt", (hash,))
            .await?;
        if let Some(receipt) = receipt {
            if !receipt.success || receipt.user_op_hash != hash {
                return Err("operation receipt did not confirm success".into());
            }
            println!("UserOperation included: {hash}");
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err("UserOperation receipt timed out".into())
}
