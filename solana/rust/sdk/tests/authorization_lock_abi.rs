use swig_interface::instruction_data as client;
use swig_program::actions as program;
use swig_program_state::IntoBytes as _;
use swig_state::IntoBytes;

#[test]
fn authorization_lock_headers_match_pinned_program() -> Result<(), String> {
    for role in [0, 0x0102_0304, u32::MAX] {
        for amount in [0, 9_007_199_254_740_993, u64::MAX] {
            let client = client::AddAuthorizationLockV1Args::new(
                role,
                [0x44; 32],
                [0x55; 32],
                amount,
                amount.wrapping_add(1),
            );
            let program = program::add_authorization_lock_v1::AddAuthorizationLockV1Args::new(
                role,
                [0x44; 32],
                [0x55; 32],
                amount,
                amount.wrapping_add(1),
            );
            assert_eq!(
                core::mem::size_of_val(&client),
                core::mem::size_of_val(&program)
            );
            assert_eq!(
                core::mem::align_of_val(&client),
                core::mem::align_of_val(&program)
            );
            assert_eq!(
                client.into_bytes().map_err(|error| format!("{error:?}"))?,
                program.into_bytes().map_err(|error| format!("{error:?}"))?
            );
        }
        let client = client::RemoveAuthorizationLockV1Args::new(role, role.wrapping_add(1));
        let program = program::remove_authorization_lock_v1::RemoveAuthorizationLockV1Args::new(
            role,
            role.wrapping_add(1),
        );
        assert_eq!(
            core::mem::size_of_val(&client),
            core::mem::size_of_val(&program)
        );
        assert_eq!(
            core::mem::align_of_val(&client),
            core::mem::align_of_val(&program)
        );
        assert_eq!(
            client.into_bytes().map_err(|error| format!("{error:?}"))?,
            program.into_bytes().map_err(|error| format!("{error:?}"))?
        );
    }
    Ok(())
}
