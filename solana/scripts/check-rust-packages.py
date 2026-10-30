#!/usr/bin/env python3
"""Verify Rust release archives before their protocol dependencies are on crates.io."""

import argparse
import os
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--program-repo", type=Path, required=True)
args = parser.parse_args()
rust = Path(__file__).resolve().parents[1] / "rust"
wallet = args.program_repo.resolve()

with tempfile.TemporaryDirectory(prefix="swig-rust-package-check-") as directory:
    root = Path(directory)
    source = root / "source"
    shutil.copytree(rust, source, ignore=shutil.ignore_patterns("target"))
    env = os.environ.copy()
    env["CARGO_TARGET_DIR"] = str(rust / "target")
    overrides = []
    for name, path in [
        ("no-padding", wallet / "no-padding"),
        ("swig-assertions", wallet / "assertions"),
        ("swig-state", wallet / "state"),
        ("swig-compact-instructions", wallet / "instructions"),
    ]:
        overrides.extend(["--config", f'patch.crates-io.{name}.path="{path}"'])
    workspace = tomllib.loads((source / "Cargo.toml").read_text())["workspace"]
    version = workspace["package"]["version"]
    for package in ["swig-interface", "swig-sdk"]:
        subprocess.run(
            ["cargo", "package", "-p", package, *overrides],
            cwd=source,
            env=env,
            check=True,
        )
        archive = rust / "target/package" / f"{package}-{version}.crate"
        with tarfile.open(archive) as tar:
            names = tar.getnames()
            prefix = f"{package}-{version}/"
            assert prefix + "LICENSE.txt" in names
            manifest_file = tar.extractfile(prefix + "Cargo.toml")
            manifest = tomllib.loads(manifest_file.read().decode())
            for dependency, settings in manifest.get("dependencies", {}).items():
                assert dependency != "swig", "program leaked into published dependencies"
                assert "git" not in settings and "path" not in settings
            tar.extractall(root / "archives", filter="data")
        if package == "swig-interface":
            extracted_interface = root / "archives" / f"{package}-{version}"
            overrides.extend([
                "--config",
                f'patch.crates-io.swig-interface.path="{extracted_interface}"',
            ])

    consumer = root / "consumer"
    (consumer / "src").mkdir(parents=True)
    (consumer / "Cargo.toml").write_text(
        '[package]\nname = "swig-published-consumer"\nversion = "0.0.0"\nedition = "2021"\n'
        f'[dependencies]\nswig-sdk = {{ path = "{root / "archives" / ("swig-sdk-" + version)}" }}\n'
    )
    (consumer / "src/main.rs").write_text(
        'fn main() { let _address = swig_sdk::SwigInstructionBuilder::swig_key(&[0; 32]); }\n'
    )
    subprocess.run(["cargo", "check", *overrides], cwd=consumer, env=env, check=True)
    tree = subprocess.check_output(
        ["cargo", "tree", "--edges", "normal,build", "--prefix", "none", *overrides],
        cwd=consumer,
        env=env,
        text=True,
    )
    excluded = ("swig v", "shank v", "shank_idl v", "shank_macro v")
    assert not any(line.startswith(excluded) for line in tree.splitlines())
    print(
        "Both archives and the external consumer passed; "
        "protocol dependencies used local release candidates."
    )
