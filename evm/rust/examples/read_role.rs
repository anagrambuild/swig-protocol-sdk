use alloy::{primitives::Address, providers::ProviderBuilder};
use std::{env, error::Error};
use swig_evm::{contracts::config::SwigConfig, roles::Role};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let provider = ProviderBuilder::new().connect_http(env::var("RPC_URL")?.parse()?);
    let address: Address = env::var("ACCOUNT_ADDRESS")?.parse()?;
    let role_id = env::var("ROLE_ID").unwrap_or_else(|_| "0".into()).parse()?;
    let config = SwigConfig::new(address, provider);
    println!(
        "{:?}",
        Role::decode(&config.getRole(role_id).call().await?)?
    );
    Ok(())
}
