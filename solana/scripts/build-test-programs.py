#!/usr/bin/env python3
"""Build pinned Solana program fixtures for both imported SDK test suites."""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--program-repo", type=Path, required=True)
args = parser.parse_args()
solana = Path(__file__).resolve().parents[1]
revision = json.loads((solana / "source.json").read_text())["rust"]["revision"]

with tempfile.TemporaryDirectory(prefix="swig-solana-fixtures-") as directory:
    root = Path(directory)
    archive = root / "program.tar"
    subprocess.run(
        [
            "git",
            "-C",
            str(args.program_repo),
            "archive",
            f"--output={archive}",
            revision,
        ],
        check=True,
    )
    subprocess.run(["tar", "-xf", str(archive), "-C", str(root)], check=True)
    for crate, features in [
        ("program", []),
        ("test-program-authority", ["--features", "program_scope_test"]),
    ]:
        subprocess.run(
            [
                "cargo",
                "build-sbf",
                "--arch",
                "v1",
                "--sbf-out-dir",
                str(root / "artifacts"),
                "--manifest-path",
                str(root / crate / "Cargo.toml"),
                *features,
                "--",
                "--locked",
            ],
            cwd=root,
            check=True,
        )

    # Read both successful builds before replacing either suite's fixtures.
    artifacts = {
        name: (root / "artifacts" / name).read_bytes()
        for name in ["swig.so", "test_program_authority.so"]
    }
    for destination in [solana / "typescript", solana / "rust/target/deploy"]:
        destination.mkdir(parents=True, exist_ok=True)
        for name, binary in artifacts.items():
            path = destination / name
            path.write_bytes(binary)
            print(f"Built {path} from swig-wallet@{revision}")
