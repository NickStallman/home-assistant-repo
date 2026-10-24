#!/usr/bin/env python3
"""Exercise the image's real entrypoint with synthetic, offline inputs."""
import json
import subprocess
import sys

image = sys.argv[1]


def run(args):
    return subprocess.run(
        ["docker", "run", "--rm", "--network", "none", *args, image],
        text=True, capture_output=True, timeout=30,
    )


# If s6 loses SSL, startup fails for a missing host instead of this invalid boolean.
# A missing host also prevents accidental network clients on a regressed image.
result = run(["-e", "SSL=synthetic-invalid-boolean"])
output = result.stdout + result.stderr
assert result.returncode != 0, "Invalid configuration must fail startup"
assert "Invalid SSL: expected a boolean" in output, output
assert "synthetic-invalid-boolean" not in output, "Do not log input values"
assert "MQTT client connecting" not in output, output

print(json.dumps({"status": "passed", "checks": 1, "network": "none"}))
