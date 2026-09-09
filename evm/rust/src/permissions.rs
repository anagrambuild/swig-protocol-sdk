use crate::{
    codec::{CodecError, read_address, read_u64, require_length},
    contracts::config::SwigConfig,
};
use alloy::primitives::{Address, Bytes};

/// Canonical wire discriminants, including variants without EVM enforcement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PermissionKind {
    None = 0,
    SolLimit = 1,
    SolRecurringLimit = 2,
    Program = 3,
    ProgramScope = 4,
    TokenLimit = 5,
    TokenRecurringLimit = 6,
    All = 7,
    ManageAuthority = 8,
    SubAccount = 9,
    StakeLimit = 10,
    StakeRecurringLimit = 11,
    StakeAll = 12,
    ProgramAll = 13,
    ProgramCurated = 14,
    AllButManageAuthority = 15,
    SolDestinationLimit = 16,
    SolRecurringDestinationLimit = 17,
    TokenDestinationLimit = 18,
    TokenRecurringDestinationLimit = 19,
    CloseSwigAuthority = 20,
    RecoveryAuthority = 21,
}

/// Full stored state, in base units and timestamp seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecurringLimit {
    pub recurring_amount: u64,
    pub window: u64,
    pub last_reset: u64,
    pub current_amount: u64,
}

impl RecurringLimit {
    pub fn new(recurring_amount: u64, window: u64) -> Result<Self, CodecError> {
        let limit = Self {
            recurring_amount,
            window,
            last_reset: 0,
            current_amount: recurring_amount,
        };
        limit.validate()?;
        Ok(limit)
    }

    fn validate(&self) -> Result<(), CodecError> {
        if self.window == 0 || self.current_amount > self.recurring_amount {
            return Err(CodecError::InvalidRecurringLimit);
        }
        Ok(())
    }
}

/// Permissions with enforcement in the pinned EVM contract version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    All,
    ManageAuthority,
    AllButManageAuthority,
    ProgramAll,
    Program {
        target: Address,
    },
    NativeLimit {
        amount: u64,
    },
    NativeRecurringLimit {
        limit: RecurringLimit,
    },
    NativeDestinationLimit {
        destination: Address,
        amount: u64,
    },
    NativeRecurringDestinationLimit {
        destination: Address,
        limit: RecurringLimit,
    },
    TokenLimit {
        token: Address,
        amount: u64,
    },
    TokenRecurringLimit {
        token: Address,
        limit: RecurringLimit,
    },
    TokenDestinationLimit {
        token: Address,
        destination: Address,
        amount: u64,
    },
    TokenRecurringDestinationLimit {
        token: Address,
        destination: Address,
        limit: RecurringLimit,
    },
}

fn append_recurring(data: &mut Vec<u8>, limit: RecurringLimit) -> Result<(), CodecError> {
    limit.validate()?;
    data.extend_from_slice(&limit.recurring_amount.to_le_bytes());
    data.extend_from_slice(&limit.window.to_le_bytes());
    data.extend_from_slice(&limit.last_reset.to_le_bytes());
    data.extend_from_slice(&limit.current_amount.to_le_bytes());
    Ok(())
}

fn read_recurring(data: &[u8], offset: usize) -> Result<RecurringLimit, CodecError> {
    let limit = RecurringLimit {
        recurring_amount: read_u64(data, offset)?,
        window: read_u64(data, offset + 8)?,
        last_reset: read_u64(data, offset + 16)?,
        current_amount: read_u64(data, offset + 24)?,
    };
    limit.validate()?;
    Ok(limit)
}

impl Permission {
    /// Encode exact state. Use RecurringLimit::new for fresh role permissions.
    pub fn encode(&self) -> Result<SwigConfig::Action, CodecError> {
        let mut data = Vec::new();
        let kind = match *self {
            Self::All => PermissionKind::All,
            Self::ManageAuthority => PermissionKind::ManageAuthority,
            Self::AllButManageAuthority => PermissionKind::AllButManageAuthority,
            Self::ProgramAll => PermissionKind::ProgramAll,
            Self::Program { target } => {
                data.extend_from_slice(target.into_word().as_slice());
                PermissionKind::Program
            }
            Self::NativeLimit { amount } => {
                data.extend_from_slice(&amount.to_le_bytes());
                PermissionKind::SolLimit
            }
            Self::NativeRecurringLimit { limit } => {
                append_recurring(&mut data, limit)?;
                PermissionKind::SolRecurringLimit
            }
            Self::NativeDestinationLimit {
                destination,
                amount,
            } => {
                data.extend_from_slice(destination.into_word().as_slice());
                data.extend_from_slice(&amount.to_le_bytes());
                PermissionKind::SolDestinationLimit
            }
            Self::NativeRecurringDestinationLimit { destination, limit } => {
                data.extend_from_slice(destination.into_word().as_slice());
                append_recurring(&mut data, limit)?;
                PermissionKind::SolRecurringDestinationLimit
            }
            Self::TokenLimit { token, amount } => {
                data.extend_from_slice(token.into_word().as_slice());
                data.extend_from_slice(&amount.to_le_bytes());
                PermissionKind::TokenLimit
            }
            Self::TokenRecurringLimit { token, limit } => {
                limit.validate()?;
                data.extend_from_slice(token.into_word().as_slice());
                // This layout orders the recurring fields differently.
                data.extend_from_slice(&limit.window.to_le_bytes());
                data.extend_from_slice(&limit.recurring_amount.to_le_bytes());
                data.extend_from_slice(&limit.current_amount.to_le_bytes());
                data.extend_from_slice(&limit.last_reset.to_le_bytes());
                PermissionKind::TokenRecurringLimit
            }
            Self::TokenDestinationLimit {
                token,
                destination,
                amount,
            } => {
                data.extend_from_slice(token.into_word().as_slice());
                data.extend_from_slice(destination.into_word().as_slice());
                data.extend_from_slice(&amount.to_le_bytes());
                PermissionKind::TokenDestinationLimit
            }
            Self::TokenRecurringDestinationLimit {
                token,
                destination,
                limit,
            } => {
                data.extend_from_slice(token.into_word().as_slice());
                data.extend_from_slice(destination.into_word().as_slice());
                append_recurring(&mut data, limit)?;
                PermissionKind::TokenRecurringDestinationLimit
            }
        };
        Ok(SwigConfig::Action {
            permission: kind as u8,
            data: Bytes::from(data),
        })
    }

    /// Decode stored state. Unsupported wire variants fail explicitly.
    pub fn decode(action: &SwigConfig::Action) -> Result<Self, CodecError> {
        let data = action.data.as_ref();
        let permission = match action.permission {
            7 => {
                require_length(data, 0)?;
                Self::All
            }
            8 => {
                require_length(data, 0)?;
                Self::ManageAuthority
            }
            15 => {
                require_length(data, 0)?;
                Self::AllButManageAuthority
            }
            13 => {
                require_length(data, 0)?;
                Self::ProgramAll
            }
            3 => {
                require_length(data, 32)?;
                Self::Program {
                    target: read_address(data, 0)?,
                }
            }
            1 => {
                require_length(data, 8)?;
                Self::NativeLimit {
                    amount: read_u64(data, 0)?,
                }
            }
            2 => {
                require_length(data, 32)?;
                Self::NativeRecurringLimit {
                    limit: read_recurring(data, 0)?,
                }
            }
            16 => {
                require_length(data, 40)?;
                Self::NativeDestinationLimit {
                    destination: read_address(data, 0)?,
                    amount: read_u64(data, 32)?,
                }
            }
            17 => {
                require_length(data, 64)?;
                Self::NativeRecurringDestinationLimit {
                    destination: read_address(data, 0)?,
                    limit: read_recurring(data, 32)?,
                }
            }
            5 => {
                require_length(data, 40)?;
                Self::TokenLimit {
                    token: read_address(data, 0)?,
                    amount: read_u64(data, 32)?,
                }
            }
            6 => {
                require_length(data, 64)?;
                let limit = RecurringLimit {
                    window: read_u64(data, 32)?,
                    recurring_amount: read_u64(data, 40)?,
                    current_amount: read_u64(data, 48)?,
                    last_reset: read_u64(data, 56)?,
                };
                limit.validate()?;
                Self::TokenRecurringLimit {
                    token: read_address(data, 0)?,
                    limit,
                }
            }
            18 => {
                require_length(data, 72)?;
                Self::TokenDestinationLimit {
                    token: read_address(data, 0)?,
                    destination: read_address(data, 32)?,
                    amount: read_u64(data, 64)?,
                }
            }
            19 => {
                require_length(data, 96)?;
                Self::TokenRecurringDestinationLimit {
                    token: read_address(data, 0)?,
                    destination: read_address(data, 32)?,
                    limit: read_recurring(data, 64)?,
                }
            }
            kind => return Err(CodecError::UnsupportedPermission(kind)),
        };
        Ok(permission)
    }
}
