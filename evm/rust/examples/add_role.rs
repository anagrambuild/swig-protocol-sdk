//! Give a delegate a fixed native-currency spending allowance.
use alloy::{
    network::EthereumWallet, primitives::Address, providers::ProviderBuilder,
    signers::local::PrivateKeySigner,
};
use std::{env, error::Error};
use swig_evm::{authorities::Authority, contracts::config::SwigConfig, permissions::Permission};

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
    let authority = Authority::Secp256k1 {
        address: env::var("DELEGATE_ADDRESS")?.parse()?,
    }
    .encode()?;
    let manager = env::var("MANAGER_ROLE_ID")
        .unwrap_or_else(|_| "0".into())
        .parse()?;
    let action = Permission::NativeLimit {
        amount: env::var("LIMIT_WEI")?.parse()?,
    }
    .encode()?;
    let receipt = config
        .addRole(
            manager,
            authority.authorityType,
            authority.key,
            authority.keyExtra,
            vec![action],
        )
        .send()
        .await?
        .get_receipt()
        .await?;
    if !receipt.status() {
        return Err("role creation reverted".into());
    }
    // Use the mined event instead of predicting a role counter that may change in flight.
    let event = receipt
        .decoded_log::<SwigConfig::RoleAdded>()
        .ok_or("missing role creation event")?;
    if event.address != address {
        return Err("role event came from another account".into());
    }
    println!(
        "{}",
        serde_json::json!({"roleId": event.data.roleId,
        "transactionHash": receipt.transaction_hash})
    );
    Ok(())
}
