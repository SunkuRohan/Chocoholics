#!/usr/bin/env bash
# One command to get Chocoholics running on a fresh EC2 instance (Ubuntu or Amazon Linux).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

echo "==> Preparing .env"
if [ ! -f .env ]; then
  rand() { head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  cat > .env <<ENV
POSTGRES_PASSWORD=$(rand)
COOKIE_SECURE=false
TRUST_PROXY=
SEED_SAMPLE_REVIEWS=true
ADMIN_INITIAL_PASSWORD=${ADMIN_INITIAL_PASSWORD:-}
ENV
  chmod 600 .env
  echo "    created .env with a random database password"
else
  echo "    .env already exists, keeping it"
fi

echo "==> Building and starting the stack"
sudo docker compose up -d --build

echo "==> Waiting for the app to be healthy"
for i in $(seq 1 60); do
  if curl -fs http://localhost:3000/healthz >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = 1 ] || { echo "App did not become healthy. Check: sudo docker compose logs app"; exit 1; }

TOKEN=$(curl -s -m 2 -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60" || true)
IP=$(curl -s -m 2 -H "X-aws-ec2-metadata-token: ${TOKEN}" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
HOST=${IP:-<your-ec2-public-ip>}

echo
echo "Chocoholics is running."
echo "  Shop:   http://${HOST}:3000"
echo "  Admin:  http://${HOST}:3000/admin.html"
echo "  First admin login: username admin, password admin (you must set a new one straight away)."
echo "  Open port 3000 in the EC2 security group, from your IP only."
