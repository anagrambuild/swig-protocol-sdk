use crate::{
    codec::{CodecError, read_address},
    contracts::config::SwigConfig,
};
use alloy::{
    primitives::{Address, B256, Bytes, b256},
    sol_types::SolValue,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AuthorityKind {
    None = 0,
    Ed25519 = 1,
    Ed25519Session = 2,
    Secp256k1 = 3,
    Secp256k1Session = 4,
    Secp256r1 = 5,
    Secp256r1Session = 6,
    ProgramExec = 7,
    ProgramExecSession = 8,
}

const PROGRAM_EXEC_VERSION: B256 =
    b256!("0000000000000000000000000000000000000000000000000000000000000001");

/// Authority variants accepted by the pinned contract version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authority {
    Secp256k1 { address: Address },
    Secp256r1 { x: B256, y: B256 },
    Ed25519 { public_key: B256, verifier: Address },
    ProgramExec { verifier: Address },
}

impl Authority {
    /// Encode the contract's authority tuple. On-chain verifier checks remain on chain.
    pub fn encode(&self) -> Result<SwigConfig::Authority, CodecError> {
        let (kind, key, key_extra) = match *self {
            Self::Secp256k1 { address } if !address.is_zero() => {
                (AuthorityKind::Secp256k1, address.into_word(), B256::ZERO)
            }
            Self::Secp256r1 { x, y } if !x.is_zero() && !y.is_zero() => {
                (AuthorityKind::Secp256r1, x, y)
            }
            Self::Ed25519 {
                public_key,
                verifier,
            } if !public_key.is_zero() && !verifier.is_zero() => {
                (AuthorityKind::Ed25519, public_key, verifier.into_word())
            }
            Self::ProgramExec { verifier } if !verifier.is_zero() => (
                AuthorityKind::ProgramExec,
                verifier.into_word(),
                PROGRAM_EXEC_VERSION,
            ),
            _ => return Err(CodecError::InvalidAuthority),
        };
        Ok(SwigConfig::Authority {
            authorityType: kind as u8,
            key,
            keyExtra: key_extra,
        })
    }

    pub fn decode(data: &SwigConfig::Authority) -> Result<Self, CodecError> {
        let authority = match data.authorityType {
            3 if data.keyExtra.is_zero() => Self::Secp256k1 {
                address: read_address(data.key.as_slice(), 0)?,
            },
            3 => return Err(CodecError::InvalidAuthority),
            5 => Self::Secp256r1 {
                x: data.key,
                y: data.keyExtra,
            },
            1 => Self::Ed25519 {
                public_key: data.key,
                verifier: read_address(data.keyExtra.as_slice(), 0)?,
            },
            7 if data.keyExtra == PROGRAM_EXEC_VERSION => Self::ProgramExec {
                verifier: read_address(data.key.as_slice(), 0)?,
            },
            7 => return Err(CodecError::InvalidAuthority),
            kind => return Err(CodecError::UnsupportedAuthority(kind)),
        };
        authority.encode()?;
        Ok(authority)
    }
}

/// Wrap an application-supplied proof in the current ProgramExec envelope.
pub fn encode_program_exec_authorization(proof: &[u8]) -> Bytes {
    (1_u32, Bytes::copy_from_slice(proof))
        .abi_encode_params()
        .into()
}
