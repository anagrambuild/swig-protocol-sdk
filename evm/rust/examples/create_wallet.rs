//! Create a wallet controlled by the caller and fund its vault.
use alloy::primitives::keccak256;
use alloy::{
    network::EthereumWallet,
    primitives::{Address, U256},
    providers::ProviderBuilder,
    signers::local::PrivateKeySigner,
};
use std::{env, error::Error};
use swig_evm::{
    authorities::Authority, contracts::factory::SwigConfigFactory, permissions::Permission,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let signer: PrivateKeySigner = env::var("SIGNER_PRIVATE_KEY")?
        .parse()
        .map_err(|_| "invalid signing key")?;
    let owner = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .connect_http(env::var("RPC_URL")?.parse()?);
    let address: Address = env::var("FACTORY_ADDRESS")?.parse()?;
    let factory = SwigConfigFactory::new(address, provider);
    let authority = Authority::Secp256k1 { address: owner }.encode()?;
    // The public name and root settings determine the address; choose a fresh name.
    let id = keccak256(env::var("WALLET_NAME")?);
    let actions = vec![Permission::All.encode()?.into()];
    let predicted = factory
        .computeConfigAddress(
            id,
            id,
            authority.authorityType,
            authority.key,
            authority.keyExtra,
            actions.clone(),
        )
        .call()
        .await?;
    let receipt = factory
        .deploy_call(
            id,
            id,
            authority.authorityType,
            authority.key,
            authority.keyExtra,
            actions,
        )
        .value(env::var("INITIAL_BALANCE_WEI")?.parse::<U256>()?)
        .send()
        .await?
        .get_receipt()
        .await?;
    if !receipt.status() {
        return Err("wallet creation reverted".into());
    }
    let event = receipt
        .decoded_log::<SwigConfigFactory::SwigDeployed>()
        .ok_or("missing wallet deployment event")?;
    if event.address != address || event.data.config != predicted {
        return Err("deployment event differs from prediction".into());
    }
    println!(
        "{}",
        serde_json::json!({"accountAddress": event.data.config,
        "vaultAddress": event.data.vault, "capsuleAddress": event.data.capsule,
        "transactionHash": receipt.transaction_hash})
    );
    Ok(())
}
