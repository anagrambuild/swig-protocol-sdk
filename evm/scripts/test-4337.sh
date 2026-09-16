#!/usr/bin/env bash
# Compose owns process isolation, ports, readiness, and teardown; Forge owns compilation.
set -euo pipefail
contracts_repo=${1:?Usage: test-4337.sh /path/to/swig-dev-portal}
evm=$(cd "$(dirname "$0")/.." && pwd)
export SWIG_TEST_WORKDIR
SWIG_TEST_WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/swig-4337.XXXXXXXX")
compose=(docker compose --project-name "swig-4337-$(basename "$SWIG_TEST_WORKDIR" | tr '[:upper:]' '[:lower:]' | tr '.' '-')" -f "$evm/integration/4337/compose.yaml")
cleanup() {
  result=$?
  if (( result != 0 )); then "${compose[@]}" logs --no-color >&2 || true; fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null || true
  rm -rf "$SWIG_TEST_WORKDIR"
  exit "$result"
}
trap cleanup EXIT
revision=$(bun -e 'console.log(require(process.argv[1]).revision)' "$evm/abi/source.json")
git -C "$contracts_repo" archive "$revision" evm | tar -x -C "$SWIG_TEST_WORKDIR"
npm ci --ignore-scripts --prefix "$SWIG_TEST_WORKDIR/evm"
forge build --root "$SWIG_TEST_WORKDIR/evm"
# Forge can reproduce the official release without a custom Solidity import walker.
entrypoint="$SWIG_TEST_WORKDIR/entrypoint"
mkdir "$entrypoint"
cp -R "$SWIG_TEST_WORKDIR/evm/node_modules/@account-abstraction/contracts/contracts" "$entrypoint/"
ln -s "$SWIG_TEST_WORKDIR/evm/node_modules/@openzeppelin" "$entrypoint/@openzeppelin"
cp "$evm/integration/4337/entrypoint.foundry.toml" "$entrypoint/foundry.toml"
forge build --root "$entrypoint" contracts/core/EntryPoint.sol
export SWIG_TEST_ARTIFACTS="$SWIG_TEST_WORKDIR/evm/out"
export SWIG_TEST_ENTRYPOINT_ARTIFACT="$entrypoint/out/EntryPoint.sol/EntryPoint.json"
export SWIG_TEST_BUNDLER_CONTEXT="$SWIG_TEST_WORKDIR/account.json"
"${compose[@]}" up -d --wait anvil
export SWIG_TEST_RPC_URL="http://$("${compose[@]}" port anvil 8545)"
cd "$evm/typescript"
bun run build
bun run typecheck:integration
bun run integration/deploy-4337.ts
"${compose[@]}" up -d strict compatible
export SWIG_TEST_BUNDLER_URL="http://$("${compose[@]}" port compatible 3000)"
export SWIG_TEST_STRICT_BUNDLER_URL="http://$("${compose[@]}" port strict 3000)"
bun run integration/erc4337.ts
# Exercise the public example entry points against the same funded fixture.
unset PAYMASTER_URL
export ROLE_ID=0 VALUE_WEI=1
export RPC_URL="$SWIG_TEST_RPC_URL" BUNDLER_URL="$SWIG_TEST_BUNDLER_URL"
export ACCOUNT_ADDRESS=$(bun -e 'console.log(require(process.argv[1]).address)' "$SWIG_TEST_BUNDLER_CONTEXT")
export TEST_PAYMASTER_ADDRESS=$(bun -e 'console.log(require(process.argv[1]).sponsor)' "$SWIG_TEST_BUNDLER_CONTEXT")
export SIGNER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
export RECIPIENT=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
bun run examples/read-role.ts
bun run examples/erc4337.ts
cd "$evm"
cargo run --locked -p swig-evm --example read_role
cargo run --locked -p swig-evm --example erc4337
