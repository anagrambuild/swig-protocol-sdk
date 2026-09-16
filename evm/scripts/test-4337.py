#!/usr/bin/env python3
"""Run the thin adapter through isolated Geth and Alto. Strict mode is a release gate."""

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--contracts-repo", required=True, type=Path)
parser.add_argument("--mode", choices=("strict", "alternative"), default="strict")
parser.add_argument("--forge", default="forge")
args = parser.parse_args()
evm = Path(__file__).resolve().parents[1]
source = json.loads((evm / "abi/source.json").read_text())
geth_image = "ethereum/client-go:v1.15.11@sha256:798b7eb1bcef6d4be7576232beea63bf291450f48b025dc8fb5c6e37840e4364"
alto_image = "ghcr.io/pimlicolabs/alto:v1.2.7@sha256:8420c602c1b4618d4e244e693f8d4cfd28fc86fd5808b74fdd185730f934e29e"
prefix = f"swig-sdk-4337-{uuid.uuid4().hex[:8]}"
network, geth, alto = prefix, f"{prefix}-geth", f"{prefix}-alto"
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
        port, bundler_port = free_port(), free_port()
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
        # Upstream eth-infinitism/account-abstraction v0.8.0 Create2Factory.ts and hardhat.config.ts.
        factory_tx = "0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222"
        mined(url, rpc(url, "eth_sendRawTransaction", [factory_tx]))
        entry = json.loads((root / "evm/node_modules/@account-abstraction/contracts/artifacts/EntryPoint.json").read_text())
        salt = "0a59dbff790c23c976a548690c27297883cc66b4c67024f9117b0238995e35e9"
        mined(url, rpc(url, "eth_sendTransaction", [{"from": owner, "to": "0x4e59b44847b379578588920ca78fbf26c0b4956c", "data": f"0x{salt}{entry['bytecode'][2:]}", "gas": hex(8_000_000)}]))
        entry_address = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"
        assert rpc(url, "eth_getCode", [entry_address, "latest"]) != "0x"
        command("docker", "run", "-d", "--name", alto, "--network", network, "-p", f"127.0.0.1:{bundler_port}:4337", alto_image,
                "--rpc-url", f"http://{geth}:8545", "--entrypoints", entry_address,
                "--executor-private-keys", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
                "--utility-private-key", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
                "--safe-mode", "true" if args.mode == "strict" else "false", "--port", "4337", "--log-level", "warn", stdout=subprocess.DEVNULL)
        containers.append(alto)
        assert [address.lower() for address in wait_rpc(bundler_url, "eth_supportedEntryPoints", [])] == [entry_address.lower()]
        env = {**os.environ, "SWIG_TEST_RPC_URL": url, "SWIG_TEST_BUNDLER_URL": bundler_url, "SWIG_TEST_ARTIFACTS": str(root / "evm/out")}
        print(f"Testing {args.mode} bundler mode at contract revision {source['revision']}", flush=True)
        command("bun", "run", "typecheck:integration", cwd=evm / "typescript")
        command("bun", "run", "integration/erc4337.ts", cwd=evm / "typescript", env=env)
        print(f"PASS: {args.mode} mode only. Alternative mode does not establish ERC-7562 acceptance.")
    except BaseException:
        for container in containers:
            subprocess.run(["docker", "logs", "--tail", "35", container], check=False)
        raise
    finally:
        for container in reversed(containers):
            subprocess.run(["docker", "rm", "-f", container], check=False, stdout=subprocess.DEVNULL)
        subprocess.run(["docker", "network", "rm", network], check=False, stdout=subprocess.DEVNULL)
