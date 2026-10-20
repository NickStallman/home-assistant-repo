#!/usr/bin/env python3
"""Exercise the image's real entrypoint with synthetic, offline inputs."""
import json
import subprocess
import sys
import base64
from pathlib import Path
import tempfile
import uuid

image = sys.argv[1]


def run(args, command=()):
    name = "winet-startup-test-" + uuid.uuid4().hex
    try:
        return subprocess.run(
            ["docker", "run", "--rm", "--name", name, "--network", "none",
             *args, image, *command],
            text=True, capture_output=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        # Only clean up the unique disposable container created by this test.
        subprocess.run(["docker", "rm", "-f", name], check=False, capture_output=True)
        raise


# If s6 loses SSL, startup fails for a missing host instead of this invalid boolean.
# A missing host also prevents accidental network clients on a regressed image.
result = run(["-e", "SSL=synthetic-invalid-boolean"])
output = result.stdout + result.stderr
assert result.returncode != 0, "Invalid configuration must fail startup"
assert "Invalid SSL: expected a boolean" in output, output
assert "synthetic-invalid-boolean" not in output, "Do not log input values"
assert "MQTT client connecting" not in output, output

with tempfile.TemporaryDirectory(prefix="winet-startup-") as directory:
    root = Path(directory)
    options = root / "options.json"
    options.write_text(json.dumps({
        "winet_host": "synthetic.invalid", "mqtt_url": "mqtt://synthetic.invalid",
    }))
    mount = ["-v", str(options) + ":/data/options.json:ro"]
    result = run([*mount, "-e", "WINET_TLS_CA_CERT_BASE64=synthetic-invalid-certificate"])
    output = result.stdout + result.stderr
    assert result.returncode != 0, "Invalid certificate must fail startup"
    assert "Invalid WINET_TLS_CA_CERT_BASE64" in output, output
    assert "synthetic-invalid-certificate" not in output, output
    assert "MQTT client connecting" not in output, output

    subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", str(root / "key.pem"), "-out", str(root / "cert.pem"),
        "-days", "1", "-subj", "/CN=synthetic.example",
        "-addext", "subjectAltName=DNS:synthetic.example",
    ], check=True, capture_output=True)
    encoded = base64.b64encode((root / "cert.pem").read_bytes()).decode()
    command = ["/usr/bin/with-contenv", "node", "-e", """
const config = require('./build/src/config').loadConfig();
const {WinetTls} = require('./build/src/winetTls');
const policy = new WinetTls(config.tls.certificateBase64, config.tls.serverName);
console.log('TLS_RESULT=' + JSON.stringify({
  required: policy.required,
  rejectUnauthorized: policy.agent.options.rejectUnauthorized,
  serverName: policy.agent.options.servername
}));
policy.agent.destroy();
"""]
    for certificate, expected in [("", False), (encoded, True)]:
        result = run([
            *mount,
            "-e", "WINET_TLS_CA_CERT_BASE64=" + certificate,
            "-e", "WINET_TLS_SERVER_NAME=synthetic.example",
        ], command)
        assert result.returncode == 0, result.stdout + result.stderr
        lines = [line for line in result.stdout.splitlines() if line.startswith("TLS_RESULT=")]
        assert len(lines) == 1, result.stdout
        assert json.loads(lines[0].split("=", 1)[1]) == {
            "required": True, "rejectUnauthorized": expected,
            "serverName": "synthetic.example",
        }

print(json.dumps({"status": "passed", "checks": 4, "network": "none"}))
