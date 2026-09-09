#!/usr/bin/env python3
"""Install the built npm archive in isolation and import it using plain Node.js."""

import json
from pathlib import Path
import subprocess
import tempfile

package = Path(__file__).resolve().parents[1] / "typescript"
with tempfile.TemporaryDirectory(prefix="swig-npm-package-") as directory:
    root = Path(directory)
    result = subprocess.run(["npm", "pack", "--json", "--pack-destination", str(root)], cwd=package, check=True, capture_output=True, text=True)
    archive = root / json.loads(result.stdout)[0]["filename"]
    (root / "package.json").write_text('{"private":true,"type":"module"}')
    subprocess.run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", str(archive), "viem@2.56.3"], cwd=root, check=True)
    (root / "smoke.mjs").write_text('''
import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
import { getSwigConfig, encodePermission, decodePermission } from "@swig-wallet/evm";
import { swigConfigAbi } from "@swig-wallet/evm/abi";
const client = createPublicClient({ transport: http("http://127.0.0.1:1") });
const address = "0x1111111111111111111111111111111111111111";
assert.equal(getSwigConfig(address, client).address, address);
assert(swigConfigAbi.some(entry => entry.name === "signV2"));
const permission = { type: "nativeLimit", amount: 18446744073709551615n };
assert.deepEqual(decodePermission(encodePermission(permission)), permission);
console.log("Isolated npm package imports and uint64 codec passed in Node.js");
''')
    subprocess.run(["node", "smoke.mjs"], cwd=root, check=True)
