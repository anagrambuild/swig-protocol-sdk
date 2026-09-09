//! Contract entry points generated from the shared ABI snapshot.

// Generated signatures must match the contract ABI, including initialize's nine inputs.
#[allow(clippy::too_many_arguments)]
pub mod config {
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug, PartialEq, Eq)]
        SwigConfig,
        "abi/SwigConfig.json"
    );
}

pub mod factory {
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug, PartialEq, Eq)]
        SwigConfigFactory,
        "abi/SwigConfigFactory.json"
    );
}

pub mod vault {
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug, PartialEq, Eq)]
        SwigVault,
        "abi/SwigVault.json"
    );
}

pub mod capsule {
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug, PartialEq, Eq)]
        SwigCapsule,
        "abi/SwigCapsule.json"
    );
}

// Alloy emits a distinct Action type for each ABI. Preserve the exact tuple
// when supplying the same permission codec output to factory deployment.
impl From<config::SwigConfig::Action> for factory::SwigConfig::Action {
    fn from(action: config::SwigConfig::Action) -> Self {
        Self {
            permission: action.permission,
            data: action.data,
        }
    }
}
