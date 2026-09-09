use alloy::primitives::{Address, B256, Bytes, address, b256, hex};
use serde::Deserialize;
use swig_evm::{
    CodecError,
    authorities::{Authority, encode_program_exec_authorization},
    contracts::{config::SwigConfig, factory},
    permissions::{Permission, RecurringLimit},
    roles::Role,
};

#[derive(Deserialize)]
struct PermissionVector {
    name: String,
    permission: u8,
    data: Bytes,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthorityVector {
    name: String,
    authority_type: u8,
    key: B256,
    key_extra: B256,
}

#[test]
fn shared_permission_vectors_preserve_wire_layout_and_stored_state()
-> Result<(), Box<dyn std::error::Error>> {
    let vectors: Vec<PermissionVector> =
        serde_json::from_str(include_str!("../../fixtures/permissions.json"))?;
    let token = address!("1111111111111111111111111111111111111111");
    let destination = address!("2222222222222222222222222222222222222222");
    let amount = 0x0102030405060708;
    let limit = RecurringLimit::new(amount, 0x01020304)?;
    let stored = RecurringLimit {
        last_reset: 0x05060708,
        current_amount: 0x0102030405,
        ..limit
    };
    for vector in vectors {
        let expected = match vector.name.as_str() {
            "all" => Permission::All,
            "manageAuthority" => Permission::ManageAuthority,
            "allButManageAuthority" => Permission::AllButManageAuthority,
            "programAll" => Permission::ProgramAll,
            "program" => Permission::Program {
                target: address!("3333333333333333333333333333333333333333"),
            },
            "nativeLimit" => Permission::NativeLimit { amount },
            "nativeRecurringLimit" => Permission::NativeRecurringLimit { limit },
            "nativeDestinationLimit" => Permission::NativeDestinationLimit {
                destination,
                amount,
            },
            "nativeRecurringDestinationLimit" => {
                Permission::NativeRecurringDestinationLimit { destination, limit }
            }
            "tokenLimit" => Permission::TokenLimit { token, amount },
            "tokenRecurringLimit" => Permission::TokenRecurringLimit { token, limit },
            "tokenDestinationLimit" => Permission::TokenDestinationLimit {
                token,
                destination,
                amount,
            },
            "tokenRecurringDestinationLimit" => Permission::TokenRecurringDestinationLimit {
                token,
                destination,
                limit,
            },
            "storedNativeRecurring" => Permission::NativeRecurringLimit { limit: stored },
            "storedTokenRecurring" => Permission::TokenRecurringLimit {
                token,
                limit: stored,
            },
            "maximumNativeLimit" => Permission::NativeLimit { amount: u64::MAX },
            _ => return Err(format!("Unknown vector: {}", vector.name).into()),
        };
        let wire = SwigConfig::Action {
            permission: vector.permission,
            data: vector.data,
        };
        assert_eq!(Permission::decode(&wire)?, expected, "{}", vector.name);
        assert_eq!(expected.encode()?, wire, "{}", vector.name);
        let factory_action: factory::SwigConfig::Action = expected.encode()?.into();
        assert_eq!(factory_action.permission, wire.permission);
        assert_eq!(factory_action.data, wire.data);
    }
    Ok(())
}

#[test]
fn rejects_malformed_permission_payloads() {
    for (permission, data) in [
        (7, vec![0]),
        (1, vec![1]),
        (3, vec![1; 32]),
        (5, vec![0; 39]),
    ] {
        assert_eq!(
            Permission::decode(&SwigConfig::Action {
                permission,
                data: data.into()
            }),
            Err(CodecError::InvalidPayload)
        );
    }
    assert_eq!(
        Permission::decode(&SwigConfig::Action {
            permission: 4,
            data: vec![0; 144].into()
        }),
        Err(CodecError::UnsupportedPermission(4))
    );
    assert_eq!(
        Permission::decode(&SwigConfig::Action {
            permission: 255,
            data: Bytes::new()
        }),
        Err(CodecError::UnsupportedPermission(255))
    );
    assert_eq!(
        RecurringLimit::new(1, 0),
        Err(CodecError::InvalidRecurringLimit)
    );
    assert_eq!(
        Permission::NativeRecurringLimit {
            limit: RecurringLimit {
                recurring_amount: 1,
                window: 1,
                last_reset: 0,
                current_amount: 2
            }
        }
        .encode(),
        Err(CodecError::InvalidRecurringLimit)
    );
}

#[test]
fn shared_authority_vectors_preserve_wire_keys_and_role_data()
-> Result<(), Box<dyn std::error::Error>> {
    let vectors: Vec<AuthorityVector> =
        serde_json::from_str(include_str!("../../fixtures/authorities.json"))?;
    for vector in vectors {
        let expected = match vector.name.as_str() {
            "secp256k1" => Authority::Secp256k1 {
                address: address!("1111111111111111111111111111111111111111"),
            },
            "secp256r1" => Authority::Secp256r1 {
                x: B256::repeat_byte(0x12),
                y: B256::repeat_byte(0x34),
            },
            "ed25519" => Authority::Ed25519 {
                public_key: B256::repeat_byte(0x56),
                verifier: address!("2222222222222222222222222222222222222222"),
            },
            "programExec" => Authority::ProgramExec {
                verifier: address!("3333333333333333333333333333333333333333"),
            },
            _ => return Err(format!("Unknown authority: {}", vector.name).into()),
        };
        let data = SwigConfig::Authority {
            authorityType: vector.authority_type,
            key: vector.key,
            keyExtra: vector.key_extra,
        };
        assert_eq!(Authority::decode(&data)?, expected);
        assert_eq!(expected.encode()?, data);
        let role = Role::decode(&SwigConfig::Role {
            id: 7,
            authority: data,
            actionCount: 2,
        })?;
        assert_eq!(
            role,
            Role {
                id: 7,
                authority: expected,
                action_count: 2
            }
        );
    }
    Ok(())
}

#[test]
fn rejects_unsupported_and_malformed_authorities() {
    for authority_type in [0, 2, 4, 6, 8, 255] {
        assert_eq!(
            Authority::decode(&SwigConfig::Authority {
                authorityType: authority_type,
                key: B256::ZERO,
                keyExtra: B256::ZERO
            }),
            Err(CodecError::UnsupportedAuthority(authority_type))
        );
    }
    assert_eq!(
        Authority::Secp256k1 {
            address: Address::ZERO
        }
        .encode(),
        Err(CodecError::InvalidAuthority)
    );
    assert_eq!(
        Authority::Secp256r1 {
            x: B256::ZERO,
            y: B256::ZERO
        }
        .encode(),
        Err(CodecError::InvalidAuthority)
    );
    let nonzero = b256!("0000000000000000000000000000000000000000000000000000000000000001");
    assert_eq!(
        Authority::decode(&SwigConfig::Authority {
            authorityType: 7,
            key: nonzero,
            keyExtra: B256::ZERO
        }),
        Err(CodecError::InvalidAuthority)
    );
    assert_eq!(
        Authority::decode(&SwigConfig::Authority {
            authorityType: 3,
            key: B256::repeat_byte(1),
            keyExtra: B256::ZERO
        }),
        Err(CodecError::InvalidPayload)
    );
}

#[test]
fn program_exec_proof_uses_the_v1_abi_envelope() {
    let expected = hex!(
        "0000000000000000000000000000000000000000000000000000000000000001"
        "0000000000000000000000000000000000000000000000000000000000000040"
        "0000000000000000000000000000000000000000000000000000000000000003"
        "1234560000000000000000000000000000000000000000000000000000000000"
    );
    assert_eq!(
        encode_program_exec_authorization(&[0x12, 0x34, 0x56]).as_ref(),
        expected
    );
}
