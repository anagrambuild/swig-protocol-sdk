#!/usr/bin/env python3
"""Build the pinned contracts and run both SDKs against an isolated Anvil node."""

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--contracts-repo", required=True, type=Path)
parser.add_argument("--forge", default="forge")
parser.add_argument("--anvil", default="anvil")
args = parser.parse_args()
evm = Path(__file__).resolve().parents[1]
source = json.loads((evm / "abi/source.json").read_text())

with tempfile.TemporaryDirectory(prefix="swig-sdk-integration-") as temp:
    root = Path(temp)
    archive = root / "contracts.tar"
    subprocess.run(["git", "-C", str(args.contracts_repo), "archive", f"--output={archive}", source["revision"], "evm/src", "evm/foundry.toml", "evm/package.json", "evm/package-lock.json"], check=True)
    subprocess.run(["tar", "-xf", str(archive), "-C", str(root)], check=True)
    shutil.copyfile(evm / "integration/SdkFixtures.sol", root / "evm/src/SdkFixtures.sol")
    subprocess.run(["npm", "ci", "--ignore-scripts", "--prefix", str(root / "evm")], check=True)
    subprocess.run([args.forge, "build", "--root", str(root / "evm"), "--skip", "test", "--skip", "script"], check=True)
    for name in ("SwigConfig", "SwigConfigFactory", "SwigVault", "SwigCapsule"):
        artifact = json.loads((root / f"evm/out/{name}.sol/{name}.json").read_text())
        assert artifact["abi"] == json.loads((evm / f"abi/{name}.json").read_text()), f"Source ABI mismatch: {name}"

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    rpc = f"http://127.0.0.1:{port}"
    with (root / "anvil.log").open("w") as log:
        node = subprocess.Popen([args.anvil, "--host", "127.0.0.1", "--port", str(port), "--silent"], stdout=log, stderr=log)
        try:
            for attempt in range(100):
                if node.poll() is not None:
                    raise RuntimeError("Isolated Anvil process exited during startup")
                try:
                    request = urllib.request.Request(rpc, data=b'{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}', headers={"Content-Type": "application/json"})
                    with urllib.request.urlopen(request, timeout=1) as response:
                        assert json.load(response)["result"] == "0x7a69"
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Isolated Anvil node did not become ready")
            env = {**os.environ, "SWIG_TEST_RPC_URL": rpc, "SWIG_TEST_ARTIFACTS": str(root / "evm/out"), "SWIG_TEST_CONTEXT": str(root / "context.json")}
            subprocess.run(["bun", "run", "build"], cwd=evm / "typescript", check=True)
            subprocess.run(["bun", "run", "typecheck:integration"], cwd=evm / "typescript", check=True)
            subprocess.run(["bun", "run", "integration/anvil.ts"], cwd=evm / "typescript", env=env, check=True)
            subprocess.run(["cargo", "run", "--locked", "-p", "swig-evm-integration"], cwd=evm, env=env, check=True)
            print("TypeScript and Rust integration passed against the pinned contract source")
        finally:
            node.terminate()
            try:
                node.wait(timeout=5)
            except subprocess.TimeoutExpired:
                node.kill()
                node.wait()
