use alloy_primitives::B256;
use alloy_signer::SignerSync;
use alloy_signer_local::LocalSigner;
use solana_sdk::{
    native_token::LAMPORTS_PER_SOL,
    signature::{Keypair, Signer},
};
use solana_system_interface::instruction as system_instruction;
use swig_state::tail::authorization_locks::NATIVE_SOL_MINT;

use super::*;
use crate::{
    client_role::{Ed25519ClientRole, Secp256k1ClientRole, Secp256r1ClientRole},
    tests::common::{create_test_secp256r1_keypair, mint_to, setup_mint},
    types::UpdateAuthorityData,
};

fn assert_program_error(error: &SwigError, code: u32) {
    let expected = format!("custom program error: 0x{code:x}");
    assert!(
        matches!(error, SwigError::TransactionFailedWithLogs { logs, .. }
            if logs.iter().any(|line| line.contains(&expected))),
        "expected program error {code}, got {error:?}"
    );
}

#[test_log::test]
fn should_lock_enforce_and_release_sol_through_wallet() {
    let (litesvm, main_authority) = setup_test_environment();
    let mut wallet = create_test_wallet(litesvm, &main_authority);
    // Locking needs the explicit permission, even for the root `All` role.
    wallet
        .update_authority(
            0,
            UpdateAuthorityData::AddActions(vec![Permission::ManageAuthorizationLocks {
                max_duration_slots: 10_000,
            }]),
        )
        .unwrap();
    let rent_claimer = Keypair::new().pubkey();
    wallet.litesvm().airdrop(&rent_claimer, 1_000_000).unwrap();
    wallet.set_rent_claimer(rent_claimer).unwrap();
    let wallet_address = wallet.get_swig_wallet_address().unwrap();
    wallet
        .litesvm()
        .airdrop(&wallet_address, 5 * LAMPORTS_PER_SOL)
        .unwrap();
    let slot = wallet.get_current_slot().unwrap();

    wallet
        .add_authorization_lock(
            wallet_address,
            NATIVE_SOL_MINT,
            4 * LAMPORTS_PER_SOL,
            slot + 1_000,
        )
        .unwrap();
    let locks = wallet.get_authorization_locks().unwrap();
    assert_eq!(locks.len(), 1);
    assert_eq!(locks[0].amount, 4 * LAMPORTS_PER_SOL);
    assert_eq!(locks[0].role_id, 0);

    let recipient = Keypair::new().pubkey();
    let overspend = system_instruction::transfer(&wallet_address, &recipient, 2 * LAMPORTS_PER_SOL);
    let swig_account = wallet.get_swig_account().unwrap();
    let before_swig = wallet.litesvm().get_account(&swig_account).unwrap().data;
    let before_wallet_lamports = wallet
        .litesvm()
        .get_account(&wallet_address)
        .unwrap()
        .lamports;
    let error = wallet.sign_v2(vec![overspend.clone()], None).unwrap_err();
    assert_program_error(&error, 89); // AuthorizationLockViolated
    assert_eq!(wallet.get_authorization_locks().unwrap(), locks);
    assert_eq!(
        wallet.litesvm().get_account(&swig_account).unwrap().data,
        before_swig
    );
    assert_eq!(
        wallet
            .litesvm()
            .get_account(&wallet_address)
            .unwrap()
            .lamports,
        before_wallet_lamports
    );
    assert!(wallet.litesvm().get_account(&recipient).is_none());

    let claimer_balance_before_remove = wallet.litesvm().get_balance(&rent_claimer).unwrap();
    wallet.remove_authorization_lock(locks[0].lock_id).unwrap();
    assert!(wallet.litesvm().get_balance(&rent_claimer).unwrap() > claimer_balance_before_remove);
    wallet.litesvm().expire_blockhash();
    assert!(wallet.get_authorization_locks().unwrap().is_empty());
    wallet.sign_v2(vec![overspend], None).unwrap();
}

#[test_log::test]
fn should_round_trip_manage_authorization_locks_permission() {
    let (litesvm, main_authority) = setup_test_environment();
    let mut wallet = create_test_wallet(litesvm, &main_authority);
    let card = Keypair::new();
    wallet
        .add_authority(
            AuthorityType::Ed25519,
            card.pubkey().as_ref(),
            vec![
                Permission::ManageAuthorizationLocks {
                    max_duration_slots: 500,
                },
                Permission::Sol {
                    amount: LAMPORTS_PER_SOL,
                    recurring: None,
                },
            ],
        )
        .unwrap();
    wallet
        .litesvm()
        .airdrop(&card.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();
    wallet
        .switch_authority(
            1,
            Box::new(Ed25519ClientRole::new(card.pubkey())),
            Some(&card),
        )
        .unwrap();
    let permissions = wallet.get_role_permissions(1).unwrap();
    assert!(permissions.contains(&Permission::ManageAuthorizationLocks {
        max_duration_slots: 500
    }));

    let wallet_address = wallet.get_swig_wallet_address().unwrap();
    wallet
        .litesvm()
        .airdrop(&wallet_address, 2 * LAMPORTS_PER_SOL)
        .unwrap();
    let slot = wallet.get_current_slot().unwrap();
    let swig_account = wallet.get_swig_account().unwrap();
    let before_swig = wallet.litesvm().get_account(&swig_account).unwrap().data;
    let before_wallet_lamports = wallet
        .litesvm()
        .get_account(&wallet_address)
        .unwrap()
        .lamports;
    // Beyond the role's duration bound.
    let error = wallet
        .add_authorization_lock(wallet_address, NATIVE_SOL_MINT, 1, slot + 501)
        .unwrap_err();
    assert_program_error(&error, 82); // InvalidAuthorizationLockExpiry
    assert!(wallet.get_authorization_locks().unwrap().is_empty());
    assert_eq!(
        wallet.litesvm().get_account(&swig_account).unwrap().data,
        before_swig
    );
    assert_eq!(
        wallet
            .litesvm()
            .get_account(&wallet_address)
            .unwrap()
            .lamports,
        before_wallet_lamports
    );

    // Beyond the role's SOL limit.
    let error = wallet
        .add_authorization_lock(
            wallet_address,
            NATIVE_SOL_MINT,
            LAMPORTS_PER_SOL + 1,
            slot + 100,
        )
        .unwrap_err();
    assert_program_error(&error, 85); // AuthorizationLockExceedsSpendLimit
    assert!(wallet.get_authorization_locks().unwrap().is_empty());
    assert_eq!(
        wallet.litesvm().get_account(&swig_account).unwrap().data,
        before_swig
    );
    assert_eq!(
        wallet
            .litesvm()
            .get_account(&wallet_address)
            .unwrap()
            .lamports,
        before_wallet_lamports
    );
    wallet
        .add_authorization_lock(
            wallet_address,
            NATIVE_SOL_MINT,
            LAMPORTS_PER_SOL,
            slot + 100,
        )
        .unwrap();
    assert_eq!(wallet.get_authorization_locks().unwrap()[0].role_id, 1);
}

#[test_log::test]
fn should_lock_sol_and_tokens_through_convenience_helpers() {
    let (mut litesvm, main_authority) = setup_test_environment();
    let mint = setup_mint(&mut litesvm, &main_authority).unwrap();
    let mut wallet = create_test_wallet(litesvm, &main_authority);
    wallet
        .update_authority(
            0,
            UpdateAuthorityData::AddActions(vec![Permission::ManageAuthorizationLocks {
                max_duration_slots: 10_000,
            }]),
        )
        .unwrap();
    let wallet_address = wallet.get_swig_wallet_address().unwrap();
    wallet
        .litesvm()
        .airdrop(&wallet_address, 2 * LAMPORTS_PER_SOL)
        .unwrap();
    let token_account = wallet.create_ata(&mint).unwrap();
    mint_to(
        wallet.litesvm(),
        &mint,
        &main_authority,
        &token_account,
        1_000,
    )
    .unwrap();
    let slot = wallet.get_current_slot().unwrap();

    wallet
        .add_sol_authorization_lock(LAMPORTS_PER_SOL, slot + 10)
        .unwrap();
    wallet
        .add_token_authorization_lock(&mint, 600, slot + 1_000)
        .unwrap();

    let locks = wallet.get_authorization_locks().unwrap();
    assert_eq!(locks.len(), 2);
    assert!(locks[0].is_native_sol());
    assert_eq!(locks[0].asset_account, wallet_address.to_bytes());
    assert_eq!(locks[1].mint, mint.to_bytes());
    assert_eq!(locks[1].asset_account, token_account.to_bytes());
    assert_eq!(locks[1].amount, 600);

    // The SOL lock expires first; expired locks stay stored until pruned.
    wallet.litesvm().warp_to_slot(slot + 10);
    let active = wallet.get_active_authorization_locks().unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].lock_id, locks[1].lock_id);
    assert_eq!(wallet.get_authorization_locks().unwrap().len(), 2);
}

#[test_log::test]
fn should_add_and_remove_sol_lock_with_secp256k1_authority() {
    let (litesvm, main_authority) = setup_test_environment();
    let mut wallet = create_test_wallet(litesvm, &main_authority);
    let signer = LocalSigner::random();
    let public_key = signer
        .credential()
        .verifying_key()
        .to_encoded_point(false)
        .to_bytes();
    wallet
        .add_authority(
            AuthorityType::Secp256k1,
            &public_key.as_ref()[1..],
            vec![
                Permission::All,
                Permission::ManageAuthorizationLocks {
                    max_duration_slots: 100,
                },
            ],
        )
        .unwrap();
    let signing_fn = move |payload: &[u8]| -> [u8; 65] {
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&payload[..32]);
        signer.sign_hash_sync(&B256::from(hash)).unwrap().as_bytes()
    };
    wallet
        .switch_authority(
            1,
            Box::new(Secp256k1ClientRole::new(public_key, Box::new(signing_fn))),
            None,
        )
        .unwrap();

    let wallet_address = wallet.get_swig_wallet_address().unwrap();
    wallet
        .litesvm()
        .airdrop(&wallet_address, 2 * LAMPORTS_PER_SOL)
        .unwrap();
    let slot = wallet.get_current_slot().unwrap();
    wallet
        .add_sol_authorization_lock(LAMPORTS_PER_SOL, slot + 100)
        .unwrap();
    let locks = wallet.get_authorization_locks().unwrap();
    assert_eq!(locks.len(), 1);
    assert_eq!(locks[0].role_id, 1);
    assert_eq!(locks[0].amount, LAMPORTS_PER_SOL);
    wallet.remove_authorization_lock(locks[0].lock_id).unwrap();
    assert!(wallet.get_authorization_locks().unwrap().is_empty());
}

#[test_log::test]
fn should_add_and_remove_sol_lock_with_secp256r1_authority() {
    use solana_secp256r1_program::sign_message;

    let (litesvm, main_authority) = setup_test_environment();
    let mut wallet = create_test_wallet(litesvm, &main_authority);
    let (signing_key, public_key) = create_test_secp256r1_keypair();
    wallet
        .add_authority(
            AuthorityType::Secp256r1,
            &public_key,
            vec![
                Permission::All,
                Permission::ManageAuthorizationLocks {
                    max_duration_slots: 100,
                },
            ],
        )
        .unwrap();
    let signing_fn = move |message_hash: &[u8]| -> [u8; 64] {
        sign_message(message_hash, &signing_key.private_key_to_der().unwrap()).unwrap()
    };
    wallet
        .switch_authority(
            1,
            Box::new(Secp256r1ClientRole::new(public_key, Box::new(signing_fn))),
            None,
        )
        .unwrap();

    let wallet_address = wallet.get_swig_wallet_address().unwrap();
    wallet
        .litesvm()
        .airdrop(&wallet_address, 2 * LAMPORTS_PER_SOL)
        .unwrap();
    let slot = wallet.get_current_slot().unwrap();
    wallet
        .add_sol_authorization_lock(LAMPORTS_PER_SOL, slot + 100)
        .unwrap();
    let locks = wallet.get_authorization_locks().unwrap();
    assert_eq!(locks.len(), 1);
    assert_eq!(locks[0].role_id, 1);
    assert_eq!(locks[0].amount, LAMPORTS_PER_SOL);
    wallet.remove_authorization_lock(locks[0].lock_id).unwrap();
    assert!(wallet.get_authorization_locks().unwrap().is_empty());
}

#[test_log::test]
fn should_add_and_remove_sol_lock_with_ed25519_session() {
    let (litesvm, main_authority) = setup_test_environment();
    let session_root = Keypair::new();
    let session_key = Keypair::new();
    let mut wallet = create_test_wallet(litesvm, &main_authority);
    let create_authority =
        CreateEd25519SessionAuthority::new(session_root.pubkey().to_bytes(), [0; 32], 100);
    wallet
        .add_authority(
            AuthorityType::Ed25519Session,
            create_authority.into_bytes().unwrap(),
            vec![
                Permission::All,
                Permission::ManageAuthorizationLocks {
                    max_duration_slots: 100,
                },
            ],
        )
        .unwrap();
    let role_id = wallet
        .get_role_id(&session_root.pubkey().to_bytes())
        .unwrap();
    wallet
        .switch_authority(
            role_id,
            Box::new(Ed25519SessionClientRole::new(create_authority)),
            Some(&session_root),
        )
        .unwrap();
    wallet
        .litesvm()
        .airdrop(&session_root.pubkey(), LAMPORTS_PER_SOL)
        .unwrap();
    wallet.switch_payer(&session_root).unwrap();
    wallet.create_session(session_key.pubkey(), 100).unwrap();
    wallet.switch_payer(&main_authority).unwrap();
    wallet
        .switch_authority(
            role_id,
            Box::new(Ed25519SessionClientRole::new(
                CreateEd25519SessionAuthority::new(
                    session_root.pubkey().to_bytes(),
                    session_key.pubkey().to_bytes(),
                    100,
                ),
            )),
            Some(&session_key),
        )
        .unwrap();

    let wallet_address = wallet.get_swig_wallet_address().unwrap();
    wallet
        .litesvm()
        .airdrop(&wallet_address, 2 * LAMPORTS_PER_SOL)
        .unwrap();
    let slot = wallet.get_current_slot().unwrap();
    wallet
        .add_sol_authorization_lock(LAMPORTS_PER_SOL, slot + 50)
        .unwrap();
    let locks = wallet.get_authorization_locks().unwrap();
    assert_eq!(locks.len(), 1);
    assert_eq!(locks[0].role_id, role_id);
    wallet.remove_authorization_lock(locks[0].lock_id).unwrap();
    assert!(wallet.get_authorization_locks().unwrap().is_empty());
}
