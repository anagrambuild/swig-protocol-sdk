use crate::{authorities::Authority, codec::CodecError, contracts::config::SwigConfig};

pub const ROOT_ROLE_ID: u32 = 0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Role {
    pub id: u32,
    pub authority: Authority,
    pub action_count: u16,
}

impl Role {
    /// Decode one getRole result without fetching actions or other wallet state.
    pub fn decode(data: &SwigConfig::Role) -> Result<Self, CodecError> {
        Ok(Self {
            id: data.id,
            authority: Authority::decode(&data.authority)?,
            action_count: data.actionCount,
        })
    }
}
