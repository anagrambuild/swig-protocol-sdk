use alloy::primitives::Address;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CodecError {
    #[error("invalid authority key, address, or version")]
    InvalidAuthority,
    #[error("unsupported authority discriminant: {0}")]
    UnsupportedAuthority(u8),
    #[error("unsupported permission discriminant: {0}")]
    UnsupportedPermission(u8),
    #[error("invalid permission payload length or address padding")]
    InvalidPayload,
    #[error("recurring window must be positive and current amount cannot exceed recurring amount")]
    InvalidRecurringLimit,
}

pub(crate) fn require_length(data: &[u8], length: usize) -> Result<(), CodecError> {
    if data.len() != length {
        return Err(CodecError::InvalidPayload);
    }
    Ok(())
}

pub(crate) fn read_address(data: &[u8], offset: usize) -> Result<Address, CodecError> {
    let word = data
        .get(offset..offset + 32)
        .ok_or(CodecError::InvalidPayload)?;
    let padding = word.get(..12).ok_or(CodecError::InvalidPayload)?;
    if padding.iter().any(|byte| *byte != 0) {
        return Err(CodecError::InvalidPayload);
    }
    let address: [u8; 20] = word
        .get(12..)
        .ok_or(CodecError::InvalidPayload)?
        .try_into()
        .map_err(|_| CodecError::InvalidPayload)?;
    Ok(Address::from(address))
}

pub(crate) fn read_u64(data: &[u8], offset: usize) -> Result<u64, CodecError> {
    let encoded: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or(CodecError::InvalidPayload)?
        .try_into()
        .map_err(|_| CodecError::InvalidPayload)?;
    Ok(u64::from_le_bytes(encoded))
}
