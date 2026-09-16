//! Send native currency from the vault, directly as the role's authority.
use alloy::primitives::Bytes;
use alloy::{
    network::EthereumWallet,
    primitives::{Address, U256},
    providers::ProviderBuilder,
    signers::local::PrivateKeySigner,
};
use std::{env, error::Error};
use swig_evm::contracts::config::SwigConfig;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let signer: PrivateKeySigner = env::var("SIGNER_PRIVATE_KEY")?
        .parse()
        .map_err(|_| "invalid signing key")?;
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .connect_http(env::var("RPC_URL")?.parse()?);
    let address: Address = env::var("ACCOUNT_ADDRESS")?.parse()?;
    let config = SwigConfig::new(address, provider);
    let role_id = env::var("ROLE_ID").unwrap_or_else(|_| "0".into()).parse()?;
    let recipient = env::var("RECIPIENT")?.parse()?;
    let value: U256 = env::var("VALUE_WEI")?.parse()?;
    // Empty authorization selects direct EOA authentication; the caller pays gas.
    let receipt = config
        .signV2(role_id, recipient, value, Bytes::new(), Bytes::new())
        .send()
        .await?
        .get_receipt()
        .await?;
    if !receipt.status() {
        return Err("transfer reverted".into());
    }
    println!(
        "{}",
        serde_json::json!({"transactionHash": receipt.transaction_hash})
    );
    Ok(())
}
