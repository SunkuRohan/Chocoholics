#!/usr/bin/env bash
# Let this Docker host talk plain HTTP to the Nexus registry (practice only; use TLS in real life).
# Usage: sudo bash infra/insecure-registry.sh 10.0.1.20:8083
set -euo pipefail
REG="${1:?Usage: $0 <nexus-private-ip>:8083}"
mkdir -p /etc/docker
if [ -s /etc/docker/daemon.json ]; then
  echo "/etc/docker/daemon.json already exists, edit it by hand and add: \"insecure-registries\": [\"$REG\"]"; exit 1
fi
printf '{\n  "insecure-registries": ["%s"]\n}\n' "$REG" > /etc/docker/daemon.json
systemctl restart docker
echo "Docker now trusts $REG"
