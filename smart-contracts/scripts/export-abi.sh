#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS="$SCRIPT_DIR/../artifacts/contracts"
TS_OUT="$SCRIPT_DIR/../../typescript/abi"
PY_OUT="$SCRIPT_DIR/../../python/src/smartclaws/abi"

CONTRACTS=(SmartClaws SmartClawsChannel SmartClawsAgent SmartClawsDevice SmartClawsDeviceGroup)

for OUT_DIR in "$TS_OUT" "$PY_OUT"; do
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
done
