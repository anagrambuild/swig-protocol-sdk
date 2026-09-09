use alloy::{
    network::EthereumWallet,
    primitives::{Address, B256, Bytes, U256, keccak256},
    providers::{Provider, ProviderBuilder},
    signers::{
        Signer,
        local::{MnemonicBuilder, coins_bip39::English},
    },
    sol_types::SolCall,
};
use serde::Deserialize;
use std::{env, error::Error, fs};
use swig_evm::{
    authorities::Authority,
    contracts::{
        capsule::SwigCapsule, config::SwigConfig, factory::SwigConfigFactory, vault::SwigVault,
    },
    permissions::Permission,
    roles::Role,
};

alloy::sol! {
    #[sol(rpc)]
    interface SdkToken {
        function mint(address account, uint256 amount) external;
        function transfer(address recipient, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
    }
    #[sol(rpc)]
    interface SdkTarget {
        function ping() external;
        function count() external view returns (uint256);
    }
}

#[derive(Deserialize)]
struct Context {
    factory: Address,
    target: Address,
    token: Address,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let rpc: alloy::transports::http::reqwest::Url = env::var("SWIG_TEST_RPC_URL")?.parse()?;
    assert_eq!(rpc.host_str(), Some("127.0.0.1"));
    let context: Context =
        serde_json::from_str(&fs::read_to_string(env::var("SWIG_TEST_CONTEXT")?)?)?;
    // Public, disposable Anvil accounts. Never use these accounts outside the test node.
    let mnemonic = "test test test test test test test test test test test junk";
    let root = MnemonicBuilder::<English>::default()
        .phrase(mnemonic)
        .build()?;
    let delegate = MnemonicBuilder::<English>::default()
        .phrase(mnemonic)
        .index(1)?
        .build()?;
    let recipient = MnemonicBuilder::<English>::default()
        .phrase(mnemonic)
        .index(3)?
        .build()?
        .address();
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(root.clone()))
        .connect_http(rpc.clone())
        .erased();
    let delegated_provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(delegate.clone()))
        .connect_http(rpc)
        .erased();
    assert_eq!(provider.get_chain_id().await?, 31337);
    let factory = SwigConfigFactory::new(context.factory, provider.clone());
    let authority = Authority::Secp256k1 {
        address: root.address(),
    }
    .encode()?;
    let salt = keccak256("rust-sdk-integration");
    let id = keccak256("rust-sdk-wallet");
    let actions = vec![Permission::All.encode()?.into()];
    let config_address = factory
        .computeConfigAddress(
            salt,
            id,
            authority.authorityType,
            authority.key,
            authority.keyExtra,
            actions.clone(),
        )
        .call()
        .await?;
    let vault_address = factory
        .computeVaultAddress(
            salt,
            id,
            authority.authorityType,
            authority.key,
            authority.keyExtra,
            actions.clone(),
        )
        .call()
        .await?;
    let capsule_address = factory
        .computeCapsuleAddress(
            salt,
            id,
            authority.authorityType,
            authority.key,
            authority.keyExtra,
            actions.clone(),
        )
        .call()
        .await?;
    assert!(
        factory
            .deploy_call(
                salt,
                id,
                authority.authorityType,
                authority.key,
                authority.keyExtra,
                actions
            )
            .value(U256::from(10_000))
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    let config = SwigConfig::new(config_address, provider.clone());
    let delegated = SwigConfig::new(config_address, delegated_provider);
    assert_eq!(config.vault().call().await?, vault_address);
    assert_eq!(config.capsule().call().await?, capsule_address);
    assert_eq!(
        SwigVault::new(vault_address, provider.clone())
            .swigAccount()
            .call()
            .await?,
        config_address
    );
    assert_eq!(
        SwigCapsule::new(capsule_address, provider.clone())
            .vault()
            .call()
            .await?,
        vault_address
    );
    assert_eq!(
        Role::decode(&config.getRole(0).call().await?)?.authority,
        Authority::Secp256k1 {
            address: root.address()
        }
    );

    let delegate_authority = Authority::Secp256k1 {
        address: delegate.address(),
    }
    .encode()?;
    let native_role = config.roleCounter().call().await?;
    assert!(
        config
            .addRole(
                0,
                delegate_authority.authorityType,
                delegate_authority.key,
                delegate_authority.keyExtra,
                vec![Permission::NativeLimit { amount: 100 }.encode()?]
            )
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    let before = provider.get_balance(recipient).await?;
    assert!(
        delegated
            .signV2(
                native_role,
                recipient,
                U256::from(40),
                Bytes::new(),
                Bytes::new()
            )
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    assert_eq!(
        provider.get_balance(recipient).await?,
        before + U256::from(40)
    );
    assert_eq!(
        Permission::decode(&config.getAction(native_role, 0).call().await?)?,
        Permission::NativeLimit { amount: 60 }
    );
    let rejected = delegated
        .signV2(
            native_role,
            recipient,
            U256::from(61),
            Bytes::new(),
            Bytes::new(),
        )
        .call()
        .await
        .expect_err("over-limit transfer must fail");
    assert!(
        rejected
            .as_decoded_error::<SwigConfig::UnauthorizedSignV2>()
            .is_some()
    );
    assert_eq!(
        Permission::decode(&config.getAction(native_role, 0).call().await?)?,
        Permission::NativeLimit { amount: 60 }
    );

    let nonce = config.authorizationNonce(0).call().await?;
    let delegated_nonce = config.authorizationNonce(native_role).call().await?;
    let digest = config
        .signV2AuthorizationDigest(0, recipient, U256::from(1), keccak256([]), nonce)
        .call()
        .await?;
    let signature = Bytes::copy_from_slice(&root.sign_hash(&digest).await?.as_bytes());
    assert!(
        delegated
            .signV2(0, recipient, U256::from(1), Bytes::new(), signature)
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    assert_eq!(
        config.authorizationNonce(0).call().await?,
        nonce + U256::from(1)
    );
    assert_eq!(
        config.authorizationNonce(native_role).call().await?,
        delegated_nonce
    );

    let token = SdkToken::new(context.token, provider.clone());
    assert!(
        token
            .mint(vault_address, U256::from(100))
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    let token_role = config.roleCounter().call().await?;
    let actions = vec![
        Permission::TokenLimit {
            token: context.token,
            amount: 50,
        }
        .encode()?,
    ];
    let nonce = config.authorizationNonce(0).call().await?;
    let digest = config
        .addRoleAuthorizationDigest(
            0,
            delegate_authority.authorityType,
            delegate_authority.key,
            delegate_authority.keyExtra,
            actions.clone(),
            nonce,
        )
        .call()
        .await?;
    let signature = Bytes::copy_from_slice(&root.sign_hash(&digest).await?.as_bytes());
    assert!(
        delegated
            .addRoleWithAuthorization(
                0,
                delegate_authority.authorityType,
                delegate_authority.key,
                delegate_authority.keyExtra,
                actions,
                signature
            )
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    let transfer = SdkToken::transferCall {
        recipient,
        amount: U256::from(20),
    }
    .abi_encode();
    assert!(
        delegated
            .signV2(
                token_role,
                context.token,
                U256::ZERO,
                transfer.into(),
                Bytes::new()
            )
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    assert_eq!(token.balanceOf(recipient).call().await?, U256::from(20));
    assert_eq!(
        Permission::decode(&config.getAction(token_role, 0).call().await?)?,
        Permission::TokenLimit {
            token: context.token,
            amount: 30
        }
    );

    let program_role = config.roleCounter().call().await?;
    assert!(
        config
            .addRole(
                0,
                delegate_authority.authorityType,
                delegate_authority.key,
                delegate_authority.keyExtra,
                vec![
                    Permission::Program {
                        target: context.target
                    }
                    .encode()?
                ]
            )
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    let target = SdkTarget::new(context.target, provider);
    let before = target.count().call().await?;
    let execution = SwigConfig::CapsuleExecution {
        target: context.target,
        value: U256::ZERO,
        data: SdkTarget::pingCall {}.abi_encode().into(),
        tokenFunding: vec![],
        sweepTokens: vec![],
    };
    // The capsule digest entry point is callable independently of transaction submission.
    assert_ne!(
        config
            .signV2WithCapsuleAuthorizationDigest(
                program_role,
                execution.clone(),
                config.authorizationNonce(program_role).call().await?
            )
            .call()
            .await?,
        B256::ZERO
    );
    assert!(
        delegated
            .signV2WithCapsule(program_role, execution, Bytes::new())
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    assert_eq!(target.count().call().await?, before + U256::from(1));
    assert!(
        config
            .removeRole(0, native_role)
            .send()
            .await?
            .get_receipt()
            .await?
            .status()
    );
    assert!(!config.hasRole(native_role).call().await?);
    println!(
        "Rust: factory predictions, role reads/mutations, native/token limits, exact rejection, raw digest authorization, capsule execution passed"
    );
    Ok(())
}
