#!/usr/bin/env python3
"""Run isolated upstream-review probes; never attach to the managed service."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--soak-seconds", type=int, default=0)
parser.add_argument("--filter", help="Bun test-name pattern; isolate cases for comparable RSS")
args = parser.parse_args()
if args.soak_seconds < 0:
    parser.error("--soak-seconds must be nonnegative")
root = Path(__file__).resolve().parents[3]
args.output.mkdir(parents=True, exist_ok=True)
scratch = Path(tempfile.mkdtemp(prefix="redcode-upstream-probes-"))
(scratch / "node_modules").symlink_to(root / "packages/tui/node_modules", target_is_directory=True)
source = Path(__file__).with_name("probes.template.ts").read_text()
(scratch / "probes.test.ts").write_text(source.replace("__REPO__", str(root)))
command = ["bun", "test", str(scratch / "probes.test.ts")]
if args.filter:
    command += ["--test-name-pattern", args.filter]
record = {
    "status": "running",
    "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "runner_pid": os.getpid(),
    "checkout": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
    "command": command,
    "soak_seconds": args.soak_seconds,
    "scratch": str(scratch),
    "probe_sha256": hashlib.sha256((scratch / "probes.test.ts").read_bytes()).hexdigest(),
}
(args.output / "execution.json").write_text(json.dumps(record, indent=2) + "\n")
with (args.output / "output.log").open("w") as log:
    result = subprocess.run(
        command,
        cwd=root / "packages/tui",
        env={**os.environ, "AUDIT_SOAK_MS": str(args.soak_seconds * 1000)},
        stdout=log,
        stderr=subprocess.STDOUT,
    )
record.update({
    "status": "completed" if result.returncode == 0 else "failed",
    "exit_code": result.returncode,
    "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
})
(args.output / "execution.json").write_text(json.dumps(record, indent=2) + "\n")
measurements = [
    json.loads(line.removeprefix("AUDIT "))
    for line in (args.output / "output.log").read_text().splitlines()
    if line.startswith("AUDIT ")
]
(args.output / "measurements.json").write_text(json.dumps(measurements, indent=2) + "\n")
print(json.dumps({"output": str(args.output), "status": record["status"], "measurements": len(measurements)}))
raise SystemExit(result.returncode)
