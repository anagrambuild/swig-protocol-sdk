#!/usr/bin/env python3
"""Verify the SDK archive and an external consumer against released protocol crates."""

import argparse
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--local-dependencies",
    action="store_true",
    help="Check unpublished swig-wallet candidates; this is not a registry release check.",
)
args = parser.parse_args()
rust = Path(__file__).resolve().parents[1] / "rust"

with tempfile.TemporaryDirectory(prefix="swig-rust-package-check-") as directory:
    root = Path(directory)
    source = root / "source"
    shutil.copytree(rust, source, ignore=shutil.ignore_patterns("target"))
    env = os.environ.copy()
    env["CARGO_TARGET_DIR"] = str(rust / "target")
    overrides = []
    if args.local_dependencies:
        metadata = json.loads(subprocess.check_output(
            ["cargo", "metadata", "--locked", "--format-version", "1"],
            cwd=source, env=env, text=True,
        ))
        revision = json.loads((rust.parent / "source.json").read_text())["rust"]["dependency_revision"]
        for name in [
            "swig-no-padding", "swig-assertions", "swig-compact-instructions",
            "swig-state", "swig-interface",
        ]:
            candidates = [
                package for package in metadata["packages"]
                if package["name"] == name
                and (package["source"] or "").endswith("#" + revision)
            ]
            if len(candidates) != 1:
                raise RuntimeError(f"Expected one {name} from swig-wallet@{revision}")
            path = Path(candidates[0]["manifest_path"]).parent
            overrides.extend(["--config", f'patch.crates-io.{name}.path="{path}"'])

    version = tomllib.loads((source / "Cargo.toml").read_text())["workspace"]["package"]["version"]
    subprocess.run(
        ["cargo", "package", "-p", "swig-sdk", *overrides],
        cwd=source, env=env, check=True,
    )
    archive = rust / "target/package" / f"swig-sdk-{version}.crate"
    with tarfile.open(archive) as tar:
        prefix = f"swig-sdk-{version}/"
        assert prefix + "LICENSE.txt" in tar.getnames()
        manifest_file = tar.extractfile(prefix + "Cargo.toml")
        manifest = tomllib.loads(manifest_file.read().decode())
        for dependency, settings in manifest.get("dependencies", {}).items():
            assert settings.get("package", dependency) != "swig", "program leaked into SDK dependencies"
            assert "git" not in settings and "path" not in settings
        assert manifest["dependencies"]["swig-interface"]["version"] == "=4.0.0"
        tar.extractall(root / "archives", filter="data")

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
        cwd=consumer, env=env, text=True,
    )
    excluded = ("swig v", "shank v", "shank_idl v", "shank_macro v")
    assert not any(line.startswith(excluded) for line in tree.splitlines())
    print(
        "SDK archive and external consumer passed against "
        + ("local dependency candidates (not a registry check)." if args.local_dependencies
           else "released crates.io dependencies.")
    )
