#!/usr/bin/env python3
"""Verify v0.9 through isolated Geth and Rundler with an explicit account exception."""

import argparse
import json
import os
import posixpath
import re
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--contracts-repo", required=True, type=Path)
parser.add_argument("--solc09", required=True, help="Solidity 0.8.28 executable for the canonical EntryPoint build")
parser.add_argument("--forge", default="forge")
args = parser.parse_args()
evm = Path(__file__).resolve().parents[1]
source = json.loads((evm / "abi/source.json").read_text())
geth_image = "ethereum/client-go:v1.15.11@sha256:798b7eb1bcef6d4be7576232beea63bf291450f48b025dc8fb5c6e37840e4364"
bundler_image = "alchemyplatform/rundler:v0.11.0@sha256:ffdc5fca2d5566152af6fe96f88c50a4cf22ce88852bb626c591d3e8ea426178"
prefix = f"swig-sdk-4337-{uuid.uuid4().hex[:8]}"
network, geth = prefix, f"{prefix}-geth"
integration = None
containers = []


def command(*values, **options):
    return subprocess.run(list(values), check=True, **options)


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def rpc(url, method, params):
    request = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(result["error"])
    return result["result"]


def wait_rpc(url, method, params):
    for _ in range(100):
        try:
            return rpc(url, method, params)
        except (OSError, RuntimeError):
            time.sleep(0.2)
    raise RuntimeError(f"Local RPC did not become ready: {url}")


def mined(url, tx_hash):
    for _ in range(100):
        receipt = rpc(url, "eth_getTransactionReceipt", [tx_hash])
        if receipt:
            assert receipt["status"] == "0x1", receipt
            return
        time.sleep(0.1)
    raise RuntimeError("Local transaction receipt timed out")


with tempfile.TemporaryDirectory(prefix="swig-sdk-4337-") as temp:
    root = Path(temp)
    archive = root / "contracts.tar"
    command("git", "-C", str(args.contracts_repo), "archive", f"--output={archive}", source["revision"], "evm")
    command("tar", "-xf", str(archive), "-C", str(root))
    command("npm", "ci", "--ignore-scripts", "--prefix", str(root / "evm"))
    command(args.forge, "build", "--root", str(root / "evm"))
    command("docker", "network", "create", network, stdout=subprocess.DEVNULL)
    try:
        port, bundler_port, strict_port = free_port(), free_port(), free_port()
        url, bundler_url = f"http://127.0.0.1:{port}", f"http://127.0.0.1:{bundler_port}"
        command("docker", "run", "-d", "--name", geth, "--network", network, "-p", f"127.0.0.1:{port}:8545", geth_image,
                "--dev", "--dev.period", "1", "--http", "--http.addr", "0.0.0.0", "--http.api", "eth,net,web3,debug",
                "--http.vhosts", "*", "--rpc.allow-unprotected-txs", "--ipcdisable", "--nodiscover", stdout=subprocess.DEVNULL)
        containers.append(geth)
        assert wait_rpc(url, "eth_chainId", []) == "0x539"
        owner = rpc(url, "eth_accounts", [])[0]
        # Known public test keys only; disposable chain and funds.
        for recipient in ("0x3fab184622dc19b6109349b94811493bf2a45362", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"):
            mined(url, rpc(url, "eth_sendTransaction", [{"from": owner, "to": recipient, "value": hex(100 * 10**18)}]))
        # Upstream v0.9.0 Create2Factory.ts and hardhat.config.ts; build exact source names without remapping metadata.
        factory_tx = "0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222"
        mined(url, rpc(url, "eth_sendRawTransaction", [factory_tx]))
        upstream = root / "evm/node_modules/@account-abstraction/contracts"
        assert json.loads((upstream / "package.json").read_text())["version"] == "0.9.0"
        version = command(args.solc09, "--version", capture_output=True, text=True).stdout
        assert "Version: 0.8.28+commit.7893614a" in version, version
        remaining, sources = ["contracts/core/EntryPoint.sol"], {}
        while remaining:
            name = remaining.pop()
            if name in sources:
                continue
            content = ((root / "evm/node_modules" if name.startswith("@") else upstream) / name).read_text()
            sources[name] = {"content": content}
            for imported in re.findall(r"import\s+(?:[^;]*?from\s+)?[\"']([^\"']+)[\"']", content):
                remaining.append(posixpath.normpath(posixpath.join(posixpath.dirname(name), imported)) if imported.startswith(".") else imported)
        compiler_input = root / "solc-input.json"
        compiler_output = root / "solc-output.json"
        compiler_input.write_text(json.dumps({"language": "Solidity", "sources": sources, "settings": {
            "evmVersion": "cancun", "optimizer": {"enabled": True, "runs": 1000000}, "viaIR": True,
            "outputSelection": {"*": {"*": ["evm.bytecode.object"]}}
        }}))
        with compiler_input.open() as stdin, compiler_output.open("w") as stdout:
            command(args.solc09, "--standard-json", stdin=stdin, stdout=stdout)
        compiled = json.loads(compiler_output.read_text())
        assert not [e for e in compiled.get("errors", []) if e["severity"] == "error"], compiled.get("errors")
        bytecode = compiled["contracts"]["contracts/core/EntryPoint.sol"]["EntryPoint"]["evm"]["bytecode"]["object"]
        salt = "7702864008ddeab30aa67b7adc3d2653bc8d162714b1fe8fe4582df814f3bf61"
        mined(url, rpc(url, "eth_sendTransaction", [{"from": owner, "to": "0x4e59b44847b379578588920ca78fbf26c0b4956c", "data": f"0x{salt}{bytecode}", "gas": hex(8_000_000)}]))
        entry_address = "0x433709009B8330FDa32311DF1C2AFA402eD8D009"
        assert rpc(url, "eth_getCode", [entry_address, "latest"]) != "0x", "Build did not reproduce the canonical v0.9 address"
        context = root / "account.json"
        env = {**os.environ, "SWIG_TEST_RPC_URL": url, "SWIG_TEST_BUNDLER_URL": bundler_url,
               "SWIG_TEST_STRICT_BUNDLER_URL": f"http://127.0.0.1:{strict_port}",
               "SWIG_TEST_BUNDLER_CONTEXT": str(context), "SWIG_TEST_ARTIFACTS": str(root / "evm/out")}
        command("bun", "run", "typecheck:integration", cwd=evm / "typescript")
        integration = subprocess.Popen(["bun", "run", "integration/erc4337.ts"], cwd=evm / "typescript", env=env)
        deadline = time.monotonic() + 90
        while not context.exists():
            if integration.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError("Integration did not publish its deployed account")
            time.sleep(0.2)
        account = json.loads(context.read_text())["account"]
        mempool = root / "mempool.json"
        mempool.write_text(json.dumps({"0x" + "01" * 32: {"entryPoint": entry_address,
            "allowlist": [{"entity": account, "rule": "notStaked"}]}}))
        for label, rpc_port in (("strict", strict_port), ("compatible", bundler_port)):
            name = f"{prefix}-{label}"
            policy = ["-v", f"{mempool}:/mempool.json:ro"] if label == "compatible" else []
            flags = ["--mempool_config_path", "/mempool.json"] if label == "compatible" else []
            command("docker", "run", "-d", "--name", name, "--network", network,
                    "-p", f"127.0.0.1:{rpc_port}:3000", *policy, bundler_image, "node",
                    "--network", "dev", "--node_http", f"http://{geth}:8545", "--enabled_entry_points", "v0.9",
                    "--signer.private_keys", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
                    "--rpc.api", "eth,debug,rundler", *flags, stdout=subprocess.DEVNULL)
            containers.append(name)
            assert [a.lower() for a in wait_rpc(f"http://127.0.0.1:{rpc_port}", "eth_supportedEntryPoints", [])] == [entry_address.lower()]
        print(f"Testing Rundler v0.11.0: tracing enabled, notStaked exception only for {account}, contracts {source['revision']}", flush=True)
        code = integration.wait(timeout=180)
        if code:
            raise RuntimeError(f"v0.9 integration exited {code}")
        print("PASS: v0.9 account-specific alternative policy; canonical beacon rejection independently verified.")
    except BaseException:
        for container in containers:
            subprocess.run(["docker", "logs", "--tail", "35", container], check=False)
        raise
    finally:
        if integration is not None and integration.poll() is None:
            integration.terminate()
            try:
                integration.wait(timeout=5)
            except subprocess.TimeoutExpired:
                integration.kill()
                integration.wait()
        for container in reversed(containers):
            subprocess.run(["docker", "rm", "-f", container], check=False, stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "network", "rm", network], check=False, stdout=subprocess.DEVNULL)
