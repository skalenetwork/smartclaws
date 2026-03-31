#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/../artifacts/contracts"
OUT_DIR="$SCRIPT_DIR/../../packages/core/abi"

CONTRACTS=(SmartClaws SmartClawsChannel SmartClawsAgent SmartClawsDevice SmartClawsDeviceGroup)

mkdir -p "$OUT_DIR"
for contract in "${CONTRACTS[@]}"; do
    SRC="$ARTIFACTS/$contract.sol/$contract.json"
    if [ -f "$SRC" ]; then
        jq '{abi: .abi, bytecode: .bytecode}' "$SRC" > "$OUT_DIR/$contract.json"
        echo "Exported $contract -> $OUT_DIR/$contract.json"
    else
        echo "Warning: $SRC not found, skipping"
    fi
done
