use alloy::{
    primitives::{Address, Bytes, U256},
    providers::DynProvider,
};
use swig_evm::contracts::config::SwigConfig;
use tempo_alloy::TempoNetwork;

// Compile-time contract: the SDK accepts a caller-configured Tempo provider.
// This does not make a network request or claim live deployment compatibility.
fn tempo_binding(provider: DynProvider<TempoNetwork>, address: Address) {
    let contract = SwigConfig::new(address, provider);
    let call = contract.signV2(0, address, U256::ZERO, Bytes::new(), Bytes::new());
    let _transaction = call.into_transaction_request();
}

#[test]
fn accepts_tempo_provider() {
    let _binding = tempo_binding;
}
