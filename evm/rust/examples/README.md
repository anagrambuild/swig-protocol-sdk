# Rust examples

Run from `evm`. These examples use the unpublished local `swig-evm` crate.

- `cargo run -p swig-evm --example read_role`: reads the selected role. Set
  `RPC_URL`, `ACCOUNT_ADDRESS`, and optional `ROLE_ID` (default `0`).
- `cargo run -p swig-evm --example erc4337`: submits a sponsored one-wei transfer
  on the disposable Compose chain (1337). Also set `BUNDLER_URL`,
  `SIGNER_PRIVATE_KEY`, `RECIPIENT`, and `TEST_PAYMASTER_ADDRESS`.

`../scripts/test-4337.sh /path/to/swig-dev-portal` deploys and funds the fixture,
sets the public development key and addresses, and runs both examples. It checks
the submitted hash against EntryPoint and waits for a successful receipt.

Applications use Alloy for provider/signer configuration and native JSON-RPC for
bundler operations. The adapter owns only Swig encoding, operation checks, and
asking canonical EntryPoint v0.9 for the EIP-712 digest. Sign that digest raw;
`personal_sign` changes it. The account must already exist and its authority must
match the role or active session. Gas sponsorship is separate from that authority.

The local fixture paymaster is unrestricted. For production, obtain current
paymaster data and gas quotes through your sponsor's supported client before
signing, and route through a bundler with the agreed account policy. Keep keys in
your application's secret storage; examples read a local environment variable
and never print it. Nonces and upgrade recovery remain the application's and
operator's responsibility, respectively.
