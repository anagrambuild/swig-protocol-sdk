#!/usr/bin/env python3
"""Check the built Solana npm tarballs from an isolated consumer."""

import json
import subprocess
import tarfile
import tempfile
from pathlib import Path

workspace = Path(__file__).resolve().parents[1] / "typescript"
with tempfile.TemporaryDirectory(prefix="swig-solana-consumer-") as directory:
    root = Path(directory)
    deps = {}
    for name in ["coder", "lib", "classic", "kit"]:
        subprocess.run(
            [
                "bun",
                "pm",
                "pack",
                "--ignore-scripts",
                "--destination",
                str(root),
                "--quiet",
            ],
            cwd=workspace / "packages" / name,
            check=True,
        )
        version = json.loads(
            (workspace / "packages" / name / "package.json").read_text()
        )["version"]
        archive = root / f"swig-wallet-{name}-{version}.tgz"
        with tarfile.open(archive) as tar:
            pkg = json.load(tar.extractfile("package/package.json"))
            assert all(
                not v.startswith("workspace:")
                for v in pkg.get("dependencies", {}).values()
            ), pkg
        deps[f"@swig-wallet/{name}"] = str(archive)
    for package in ["typescript", "@types/node"]:
        deps[package] = json.loads(
            (workspace / "node_modules" / package / "package.json").read_text()
        )["version"]
    (root / "package.json").write_text(
        json.dumps(
            {
                "name": "swig-solana-artifact-check",
                "private": True,
                "type": "module",
                "dependencies": deps,
            }
        )
    )
    subprocess.run(["bun", "install", "--ignore-scripts"], cwd=root, check=True)
    smoke = """
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ['coder','lib','classic','kit']) {
  const nodeImport = await import('@swig-wallet/' + name);
  for (const sdk of [nodeImport.default, require('@swig-wallet/' + name)]) {
    const codec = sdk.getSolLimitCodec();
    const amount = 18446744073709551615n;
    const encoded = codec.encode({ amount });
    assert.equal(encoded.length, 8);
    assert.deepEqual(codec.decode(encoded), { amount });
    assert.throws(() => codec.decode(new Uint8Array(7)));
    if (name !== 'coder') assert.equal(sdk.Actions.set().all().get().isRoot(), true);
    if (name === 'classic') assert.equal(sdk.SWIG_PROGRAM_ADDRESS.toBase58(), sdk.SWIG_PROGRAM_ADDRESS_STRING);
    if (name === 'kit') assert.equal(sdk.SWIG_PROGRAM_ADDRESS, sdk.SWIG_PROGRAM_ADDRESS_STRING);
  }
}
console.log('PASS: all four packed packages load via Node default import and CJS; uint64 round-trip and truncated-buffer rejection');
"""
    (root / "smoke.mjs").write_text(smoke)
    subprocess.run(["node", "smoke.mjs"], cwd=root, check=True)
    (root / "consumer.ts").write_text("""
import { getSolLimitCodec, type SolLimit } from '@swig-wallet/coder';
import { Actions } from '@swig-wallet/lib';
import { SWIG_PROGRAM_ADDRESS as classicAddress } from '@swig-wallet/classic';
import { SWIG_PROGRAM_ADDRESS as kitAddress } from '@swig-wallet/kit';
const limit: SolLimit = { amount: 1n };
getSolLimitCodec().encode(limit);
Actions.set().all().get();
const publicKey: string = classicAddress.toBase58();
const address: string = kitAddress;
// @ts-expect-error Solana amounts must retain integer precision.
getSolLimitCodec().encode({ amount: 1 });
// @ts-expect-error Required amount cannot be omitted.
getSolLimitCodec().encode({});
""")
    for mode in ["NodeNext", "bundler"]:
        subprocess.run(
            [
                str(root / "node_modules/.bin/tsc"),
                "--noEmit",
                "--strict",
                "--skipLibCheck",
                "--target",
                "ES2022",
                "--module",
                "NodeNext" if mode == "NodeNext" else "ESNext",
                "--moduleResolution",
                mode,
                "consumer.ts",
            ],
            cwd=root,
            check=True,
        )
    subprocess.run(
        [
            "bun",
            "build",
            "consumer.ts",
            "--target",
            "node",
            "--format",
            "esm",
            "--outfile",
            "bundle.mjs",
        ],
        cwd=root,
        check=True,
    )
    print(
        "PASS: strict external TypeScript consumers (NodeNext and bundler), including negative type cases"
    )
