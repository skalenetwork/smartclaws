#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/../artifacts/contracts"
OUT_DIR="$SCRIPT_DIR/../../packages/core/abi"

CONTRACTS=(
    SmartClaws
    SmartClawsChannel
    SmartClawsChannelEncrypted
    SmartClawsAgent
    SmartClawsDevice
    SmartClawsDeviceGroup
    PublicKeyRegistry
)

mkdir -p "$OUT_DIR"
for contract in "${CONTRACTS[@]}"; do
    SRC="$ARTIFACTS/$contract.sol/$contract.json"
    if [ -f "$SRC" ]; then
        jq '{abi: .abi, bytecode: .bytecode}' "$SRC" > "$OUT_DIR/$contract.json"
        echo "Exported $contract -> $OUT_DIR/$contract.json"
    else
        # Skipping would leave a stale ABI committed and let the CI drift check pass.
        echo "Error: $SRC not found. Run 'npx hardhat compile' first." >&2
        exit 1
    fi
done
