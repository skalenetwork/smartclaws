#!/usr/bin/env bash
# Start a local Anvil node for integration tests.
# Exports ANVIL_PRIVATE_KEY to the environment.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker run -d --network host --name anvil ghcr.io/foundry-rs/foundry:v1.5.1 "anvil --prune-history 5" || true
sleep 5

ANVIL_PRIVATE_KEY=$(docker logs anvil 2>&1 | grep -A 10 "Private Keys" | grep "(0)" | awk '{print $2}')
export ANVIL_PRIVATE_KEY
echo "ANVIL_PRIVATE_KEY=${ANVIL_PRIVATE_KEY}"
