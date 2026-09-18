//! Thin ERC-4337 v0.9 adapter. Alloy owns RPC and signing; EntryPoint owns hashing.
use alloy::{
    primitives::{Address, B256, Bytes, U256, address, aliases::U48},
    providers::{DynProvider, Provider},
    rpc::types::erc4337::PackedUserOperation as RpcUserOperation,
    sol,
    sol_types::{SolCall, SolValue},
};

use crate::contracts::config::SwigConfig::{self, PackedUserOperation};

pub const ENTRY_POINT_V09: Address = address!("433709009B8330FDa32311DF1C2AFA402eD8D009");
pub const MAX_TIMESTAMP: u64 = (1_u64 << 47) - 1;

sol! {
    #[derive(Debug, PartialEq, Eq)]
    struct TokenFunding {
        address token;
        uint64 amount;
    }
    #[derive(Debug, PartialEq, Eq)]
    struct CallExecution {
        address target;
        uint256 value;
        bytes data;
        TokenFunding[] tokenFunding;
        address[] sweepTokens;
    }
    #[derive(Debug, PartialEq, Eq)]
    struct UserOpRequest {
        uint8 version;
        uint32 roleId;
        uint256 directAuthorizationNonce;
        address signer;
        uint48 validAfter;
        uint48 validUntil;
        uint8 kind;
        CallExecution execution;
    }

    function getNonce(address sender, uint192 key) external view returns (uint256);
    function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes) userOp) external view returns (bytes32);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionKind {
    SignV2,
    Capsule,
}

#[derive(Debug, thiserror::Error)]
pub enum SmartAccountError {
    #[error("Swig requires an explicit uint47 timestamp validity window")]
    InvalidValidity,
    #[error(
        "Swig requires a deployed account on the configured chain and canonical EntryPoint v0.9"
    )]
    InvalidDeployment,
    #[error("operation must match the account, signer, role nonce lane, and execution envelope")]
    InvalidOperation,
    #[error("Swig requires sponsorship and does not support account creation in a UserOperation")]
    UnsupportedOperation,
    #[error("gas and fee values must fit uint128")]
    InvalidGasLimits,
    #[error(transparent)]
    Contract(#[from] alloy::contract::Error),
    #[error(transparent)]
    Transport(#[from] alloy::transports::TransportError),
}

/// The signer is an authorized secp256k1 role key or active EVM session key.
/// This value stores no private key and does not reserve nonces or retry submissions.
#[derive(Debug, Clone)]
pub struct SwigSmartAccount {
    pub address: Address,
    pub chain_id: u64,
    pub role_id: u32,
    pub signer: Address,
    pub valid_after: u64,
    pub valid_until: u64,
    pub kind: ExecutionKind,
}

impl SwigSmartAccount {
    /// Encode the same single-call envelope as the TypeScript adapter.
    /// Obtain the direct nonce with `SwigConfig::authorizationNonce(role_id)`.
    pub fn encode_call(
        &self,
        direct_authorization_nonce: U256,
        execution: CallExecution,
    ) -> Result<Bytes, SmartAccountError> {
        if self.valid_until <= self.valid_after || self.valid_until > MAX_TIMESTAMP {
            return Err(SmartAccountError::InvalidValidity);
        }
        if self.kind == ExecutionKind::SignV2
            && (!execution.tokenFunding.is_empty() || !execution.sweepTokens.is_empty())
        {
            return Err(SmartAccountError::InvalidOperation);
        }
        let request = UserOpRequest {
            version: 1,
            roleId: self.role_id,
            directAuthorizationNonce: direct_authorization_nonce,
            signer: self.signer,
            validAfter: U48::from(self.valid_after),
            validUntil: U48::from(self.valid_until),
            kind: match self.kind {
                ExecutionKind::SignV2 => 0,
                ExecutionKind::Capsule => 1,
            },
            execution,
        };
        let mut data = SwigConfig::executeUserOpCall::SELECTOR.to_vec();
        data.extend(request.abi_encode());
        Ok(data.into())
    }

    /// Check the Swig envelope before asking an existing signer to authorize it.
    pub fn validate_user_operation(
        &self,
        operation: &PackedUserOperation,
    ) -> Result<(), SmartAccountError> {
        if !operation.initCode.is_empty()
            || operation.paymasterAndData.len() < 52
            || operation.paymasterAndData.get(..20) == Some(Address::ZERO.as_slice())
        {
            return Err(SmartAccountError::UnsupportedOperation);
        }
        if self.valid_until <= self.valid_after || self.valid_until > MAX_TIMESTAMP {
            return Err(SmartAccountError::InvalidValidity);
        }
        let payload = operation
            .callData
            .get(4..)
            .ok_or(SmartAccountError::InvalidOperation)?;
        let request = UserOpRequest::abi_decode_validate(payload)
            .map_err(|_| SmartAccountError::InvalidOperation)?;
        if operation.sender != self.address
            || operation.nonce >> 64 != U256::from(self.role_id)
            || request.version != 1
            || request.roleId != self.role_id
            || request.signer != self.signer
            || request.validAfter != U48::from(self.valid_after)
            || request.validUntil != U48::from(self.valid_until)
            || request.kind
                != match self.kind {
                    ExecutionKind::SignV2 => 0,
                    ExecutionKind::Capsule => 1,
                }
            || self.encode_call(request.directAuthorizationNonce, request.execution)?
                != operation.callData
        {
            return Err(SmartAccountError::InvalidOperation);
        }
        Ok(())
    }

    /// Read the live deployment and delegate v0.9 EIP-712 hashing to EntryPoint.
    /// The returned digest must be signed raw, without a personal_sign prefix.
    /// A beacon upgrade or role change can invalidate an operation after this call.
    pub async fn user_operation_hash(
        &self,
        provider: DynProvider,
        operation: PackedUserOperation,
    ) -> Result<B256, SmartAccountError> {
        self.validate_user_operation(&operation)?;
        if provider.get_chain_id().await? != self.chain_id
            || provider.get_code_at(self.address).await?.is_empty()
        {
            return Err(SmartAccountError::InvalidDeployment);
        }
        let config = SwigConfig::new(self.address, provider.clone());
        if config.entryPoint().call().await? != ENTRY_POINT_V09 {
            return Err(SmartAccountError::InvalidDeployment);
        }
        let data = getUserOpHashCall {
            userOp: (
                operation.sender,
                operation.nonce,
                operation.initCode,
                operation.callData,
                operation.accountGasLimits,
                operation.preVerificationGas,
                operation.gasFees,
                operation.paymasterAndData,
                operation.signature,
            ),
        }
        .abi_encode();
        let result = provider
            .call(
                alloy::rpc::types::TransactionRequest::default()
                    .to(ENTRY_POINT_V09)
                    .input(data.into()),
            )
            .await?;
        B256::abi_decode(&result).map_err(|_| SmartAccountError::InvalidDeployment)
    }
}

/// Convert Alloy's unpacked ERC-4337 RPC type to the contract tuple.
/// Its `PackedUserOperation` name refers to the v0.7-compatible RPC fields also used by v0.9.
/// A v0.9 paymaster signature suffix may be supplied already encoded in `paymaster_data`.
pub fn pack_user_operation(
    operation: &RpcUserOperation,
) -> Result<PackedUserOperation, SmartAccountError> {
    if operation.factory.is_some() || operation.factory_data.is_some() {
        return Err(SmartAccountError::UnsupportedOperation);
    }
    let paymaster = operation
        .paymaster
        .filter(|address| !address.is_zero())
        .ok_or(SmartAccountError::UnsupportedOperation)?;
    let verification = operation
        .paymaster_verification_gas_limit
        .ok_or(SmartAccountError::UnsupportedOperation)?;
    let post_op = operation
        .paymaster_post_op_gas_limit
        .ok_or(SmartAccountError::UnsupportedOperation)?;
    let mut paymaster_data = paymaster.as_slice().to_vec();
    paymaster_data.extend(pack_gas(verification, post_op)?);
    if let Some(data) = &operation.paymaster_data {
        paymaster_data.extend_from_slice(data);
    }
    Ok(PackedUserOperation {
        sender: operation.sender,
        nonce: operation.nonce,
        initCode: Bytes::new(),
        callData: operation.call_data.clone(),
        accountGasLimits: pack_gas(operation.verification_gas_limit, operation.call_gas_limit)?,
        preVerificationGas: operation.pre_verification_gas,
        gasFees: pack_gas(
            operation.max_priority_fee_per_gas,
            operation.max_fee_per_gas,
        )?,
        paymasterAndData: paymaster_data.into(),
        signature: operation.signature.clone(),
    })
}

fn pack_gas(high: U256, low: U256) -> Result<B256, SmartAccountError> {
    if high > U256::from(u128::MAX) || low > U256::from(u128::MAX) {
        return Err(SmartAccountError::InvalidGasLimits);
    }
    Ok(((high << 128_usize) | low).to_be_bytes::<32>().into())
}
