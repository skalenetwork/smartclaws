#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_ROOT="${SMARTCLAWS_DEMO_ROOT:-$HOME/.smartclaws-demo}"
ENV_FILE="$DEMO_ROOT/demo.env"

OWNER_HOME="$DEMO_ROOT/owner"
MASTER_HOME="$DEMO_ROOT/master"
SHELLY_HOME="$DEMO_ROOT/shelly-bridge"
THERMAL_HOME="$DEMO_ROOT/thermal-bridge"
OPENCLAW_MASTER_WORKSPACE="${OPENCLAW_MASTER_WORKSPACE:-$HOME/.openclaw/workspace/smartclaws-agent}"

GROUP_NAME="${GROUP_NAME:-home}"
GROUP_SKILLS="${GROUP_SKILLS:-Shelly Plug S Gen3, thermal sensor}"
SHELLY_DEVICE_NAME="${SHELLY_DEVICE_NAME:-shelly-plug-s}"
THERMAL_DEVICE_NAME="${THERMAL_DEVICE_NAME:-thermal-sensor-1}"
MASTER_AGENT_NAME="${MASTER_AGENT_NAME:-master-1}"
SHELLY_AGENT_NAME="${SHELLY_AGENT_NAME:-shelly-bridge-1}"
THERMAL_AGENT_NAME="${THERMAL_AGENT_NAME:-thermal-bridge-1}"
NETWORK="${SMARTCLAWS_NETWORK:-base-testnet}"
POLL_SECONDS="${POLL_SECONDS:-30}"
TARIFF_FILE="${TARIFF_FILE:-$OPENCLAW_MASTER_WORKSPACE/state/tariff.json}"
AGENT_LOG_ENABLED_OVERRIDE_SET="${AGENT_LOG_ENABLED+x}"
AGENT_LOG_CYCLES_OVERRIDE_SET="${AGENT_LOG_CYCLES+x}"
AGENT_LOG_ENABLED="${AGENT_LOG_ENABLED:-0}"
AGENT_LOG_CYCLES="${AGENT_LOG_CYCLES:-0}"

SMARTCLAWS_BIN="${SMARTCLAWS_BIN:-smartclaws}"

usage() {
  cat <<EOF
Usage: $0 <command>

Commands:
  wallets      Create four local SmartClaws HOMEs/wallets and print addresses.
  register     Register group, devices, bridge agents, master agent, and grants.
  print        Print saved deployment env and bridge run commands.
  run-shelly   Run dev/shelly-bridge.py using saved env (requires SHELLY_HOST).
  run-thermal  Run dev/thermal-sim.py using saved env.
  run-tariff   Run dev/tariff-sim.py and write a local tariff snapshot.

Typical flow:
  $0 wallets
  # fund all printed wallets with sFUEL/CREDITS
  $0 register
  $0 print
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

wallet_address() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const file = path.join(process.argv[1], "wallets", "default.json");
    if (!fs.existsSync(file)) process.exit(2);
    console.log(JSON.parse(fs.readFileSync(file, "utf8")).address);
  ' "$1"
}

record_field() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [home, kind, name, field] = process.argv.slice(1);
    const dir = path.join(home, kind);
    if (!fs.existsSync(dir)) process.exit(2);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const value = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (value.name === name || value.agentId === name) {
        const out = value[field];
        if (out === undefined || out === null) process.exit(3);
        console.log(out);
        process.exit(0);
      }
    }
    process.exit(4);
  ' "$1" "$2" "$3" "$4"
}

init_wallet_home() {
  local home="$1"
  mkdir -p "$home"
  if [[ -f "$home/wallets/default.json" ]]; then
    echo "Wallet exists: $home"
    return
  fi
  SMARTCLAWS_HOME="$home" "$SMARTCLAWS_BIN" init \
    --mode controller \
    --network "$NETWORK" \
    --yes \
    --no-backup
}

write_env() {
  mkdir -p "$DEMO_ROOT"
  cat > "$ENV_FILE" <<EOF
export SMARTCLAWS_DEMO_ROOT="$DEMO_ROOT"
export OWNER_HOME="$OWNER_HOME"
export MASTER_HOME="$MASTER_HOME"
export SHELLY_HOME="$SHELLY_HOME"
export THERMAL_HOME="$THERMAL_HOME"
export OPENCLAW_MASTER_WORKSPACE="$OPENCLAW_MASTER_WORKSPACE"
export SMARTCLAWS_BIN="$SMARTCLAWS_BIN"
export SMARTCLAWS_NETWORK="$NETWORK"
export POLL_SECONDS="$POLL_SECONDS"
export TARIFF_FILE="$TARIFF_FILE"
export AGENT_LOG_ENABLED="$AGENT_LOG_ENABLED"
export AGENT_LOG_CYCLES="$AGENT_LOG_CYCLES"

export GROUP_NAME="$GROUP_NAME"
export SHELLY_DEVICE_NAME="$SHELLY_DEVICE_NAME"
export THERMAL_DEVICE_NAME="$THERMAL_DEVICE_NAME"
export MASTER_AGENT_NAME="$MASTER_AGENT_NAME"
export SHELLY_AGENT_NAME="$SHELLY_AGENT_NAME"
export THERMAL_AGENT_NAME="$THERMAL_AGENT_NAME"

export OWNER_WALLET="${OWNER_WALLET:-}"
export MASTER_WALLET="${MASTER_WALLET:-}"
export SHELLY_WALLET="${SHELLY_WALLET:-}"
export THERMAL_WALLET="${THERMAL_WALLET:-}"

export GROUP_ADDRESS="${GROUP_ADDRESS:-}"
export SHELLY_DEVICE_ADDRESS="${SHELLY_DEVICE_ADDRESS:-}"
export SHELLY_OUTGOING_CHANNEL="${SHELLY_OUTGOING_CHANNEL:-}"
export SHELLY_INCOMING_CHANNEL="${SHELLY_INCOMING_CHANNEL:-}"
export THERMAL_DEVICE_ADDRESS="${THERMAL_DEVICE_ADDRESS:-}"
export THERMAL_OUTGOING_CHANNEL="${THERMAL_OUTGOING_CHANNEL:-}"
export THERMAL_INCOMING_CHANNEL="${THERMAL_INCOMING_CHANNEL:-}"
export MASTER_AGENT_ADDRESS="${MASTER_AGENT_ADDRESS:-}"
export SHELLY_AGENT_ADDRESS="${SHELLY_AGENT_ADDRESS:-}"
export THERMAL_AGENT_ADDRESS="${THERMAL_AGENT_ADDRESS:-}"
EOF
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    local override_agent_log_enabled="${AGENT_LOG_ENABLED:-}"
    local override_agent_log_cycles="${AGENT_LOG_CYCLES:-}"
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    if [[ -n "$AGENT_LOG_ENABLED_OVERRIDE_SET" ]]; then
      AGENT_LOG_ENABLED="$override_agent_log_enabled"
    fi
    if [[ -n "$AGENT_LOG_CYCLES_OVERRIDE_SET" ]]; then
      AGENT_LOG_CYCLES="$override_agent_log_cycles"
    fi
  fi
  OPENCLAW_MASTER_WORKSPACE="${OPENCLAW_MASTER_WORKSPACE:-$HOME/.openclaw/workspace/smartclaws-agent}"
  TARIFF_FILE="${TARIFF_FILE:-$OPENCLAW_MASTER_WORKSPACE/state/tariff.json}"
}

command_wallets() {
  require_cmd "$SMARTCLAWS_BIN"
  require_cmd node

  init_wallet_home "$OWNER_HOME"
  init_wallet_home "$MASTER_HOME"
  init_wallet_home "$SHELLY_HOME"
  init_wallet_home "$THERMAL_HOME"

  OWNER_WALLET="$(wallet_address "$OWNER_HOME")"
  MASTER_WALLET="$(wallet_address "$MASTER_HOME")"
  SHELLY_WALLET="$(wallet_address "$SHELLY_HOME")"
  THERMAL_WALLET="$(wallet_address "$THERMAL_HOME")"
  write_env

  cat <<EOF

Wallets ready. Fund each address with sFUEL/CREDITS before running register:

OWNER_WALLET=$OWNER_WALLET
MASTER_WALLET=$MASTER_WALLET
SHELLY_WALLET=$SHELLY_WALLET
THERMAL_WALLET=$THERMAL_WALLET

Saved: $ENV_FILE

Next:
  $0 register
EOF
}

ensure_group() {
  if GROUP_ADDRESS="$(record_field "$OWNER_HOME" groups "$GROUP_NAME" groupAddress 2>/dev/null)"; then
    echo "Group exists: $GROUP_NAME ($GROUP_ADDRESS)"
    return
  fi
  SMARTCLAWS_HOME="$OWNER_HOME" "$SMARTCLAWS_BIN" register \
    --name "$GROUP_NAME" \
    --skills "$GROUP_SKILLS"
  GROUP_ADDRESS="$(record_field "$OWNER_HOME" groups "$GROUP_NAME" groupAddress)"
}

ensure_device() {
  local name="$1"
  local prefix="$2"
  local address outgoing incoming
  if address="$(record_field "$OWNER_HOME" devices "$name" deviceContract 2>/dev/null)"; then
    echo "Device exists: $name ($address)"
  else
    SMARTCLAWS_HOME="$OWNER_HOME" "$SMARTCLAWS_BIN" device register --name "$name"
    address="$(record_field "$OWNER_HOME" devices "$name" deviceContract)"
  fi
  outgoing="$(record_field "$OWNER_HOME" devices "$name" outgoingChannel)"
  incoming="$(record_field "$OWNER_HOME" devices "$name" incomingChannel)"
  printf -v "${prefix}_DEVICE_ADDRESS" "%s" "$address"
  printf -v "${prefix}_OUTGOING_CHANNEL" "%s" "$outgoing"
  printf -v "${prefix}_INCOMING_CHANNEL" "%s" "$incoming"
}

ensure_agent_home() {
  local home="$1"
  local mode="$2"
  local agent_name="$3"
  local metadata="$4"
  local device_arg="$5"
  local group_args=()
  local agent_args=()

  if [[ "$mode" == "master-agent" ]]; then
    group_args=(--group "$GROUP_ADDRESS")
  fi

  if record_field "$home" agents "$agent_name" agentContract >/dev/null 2>&1; then
    agent_args=(--agent "$agent_name")
    echo "Agent exists: $agent_name"
  else
    agent_args=(--create-agent "$agent_name" --metadata "$metadata")
  fi

  SMARTCLAWS_HOME="$home" "$SMARTCLAWS_BIN" init \
    --mode "$mode" \
    "${group_args[@]}" \
    --device "$device_arg" \
    "${agent_args[@]}" \
    --yes \
    --no-backup
}

command_register() {
  require_cmd "$SMARTCLAWS_BIN"
  require_cmd node
  load_env

  OWNER_WALLET="$(wallet_address "$OWNER_HOME")"
  MASTER_WALLET="$(wallet_address "$MASTER_HOME")"
  SHELLY_WALLET="$(wallet_address "$SHELLY_HOME")"
  THERMAL_WALLET="$(wallet_address "$THERMAL_HOME")"

  ensure_group
  ensure_device "$SHELLY_DEVICE_NAME" SHELLY
  ensure_device "$THERMAL_DEVICE_NAME" THERMAL

  ensure_agent_home "$MASTER_HOME" "master-agent" "$MASTER_AGENT_NAME" \
    "Coordinates Shelly and thermal devices" \
    "$SHELLY_DEVICE_ADDRESS,$THERMAL_DEVICE_ADDRESS"
  MASTER_AGENT_ADDRESS="$(record_field "$MASTER_HOME" agents "$MASTER_AGENT_NAME" agentContract)"

  ensure_agent_home "$SHELLY_HOME" "bridge-agent" "$SHELLY_AGENT_NAME" \
    "Publishes Shelly Plug S telemetry and applies switch commands" \
    "$SHELLY_DEVICE_ADDRESS"
  SHELLY_AGENT_ADDRESS="$(record_field "$SHELLY_HOME" agents "$SHELLY_AGENT_NAME" agentContract)"

  ensure_agent_home "$THERMAL_HOME" "bridge-agent" "$THERMAL_AGENT_NAME" \
    "Simulates thermal telemetry from Shelly relay state" \
    "$THERMAL_DEVICE_ADDRESS"
  THERMAL_AGENT_ADDRESS="$(record_field "$THERMAL_HOME" agents "$THERMAL_AGENT_NAME" agentContract)"

  SMARTCLAWS_HOME="$OWNER_HOME" "$SMARTCLAWS_BIN" device grant \
    --device "$SHELLY_DEVICE_ADDRESS" \
    --role master \
    --account "$MASTER_WALLET"
  SMARTCLAWS_HOME="$OWNER_HOME" "$SMARTCLAWS_BIN" device grant \
    --device "$SHELLY_DEVICE_ADDRESS" \
    --role publisher \
    --account "$SHELLY_WALLET"
  SMARTCLAWS_HOME="$OWNER_HOME" "$SMARTCLAWS_BIN" device grant \
    --device "$THERMAL_DEVICE_ADDRESS" \
    --role publisher \
    --account "$THERMAL_WALLET"

  write_env
  command_print
}

command_print() {
  load_env
  cat <<EOF
Saved deployment env:
  $ENV_FILE

Addresses:
  Group:             $GROUP_ADDRESS
  Shelly device:     $SHELLY_DEVICE_ADDRESS
  Shelly outgoing:   $SHELLY_OUTGOING_CHANNEL
  Shelly incoming:   $SHELLY_INCOMING_CHANNEL
  Thermal device:    $THERMAL_DEVICE_ADDRESS
  Thermal outgoing:  $THERMAL_OUTGOING_CHANNEL
  Thermal incoming:  $THERMAL_INCOMING_CHANNEL
  Master agent:      $MASTER_AGENT_ADDRESS
  Shelly agent:      $SHELLY_AGENT_ADDRESS
  Thermal agent:     $THERMAL_AGENT_ADDRESS

OpenClaw master plugin config:
  { "smartclawsHome": "$MASTER_HOME", "network": "$NETWORK" }

Run Shelly bridge in one terminal:
  source "$ENV_FILE"
  SHELLY_HOST="<shelly-ip-or-hostname>" AGENT_LOG_ENABLED=1 dev/setup-local-three-agent-demo.sh run-shelly

Run thermal simulator in another terminal:
  source "$ENV_FILE"
  AGENT_LOG_ENABLED=1 dev/setup-local-three-agent-demo.sh run-thermal

Run tariff simulator in another terminal:
  source "$ENV_FILE"
  dev/setup-local-three-agent-demo.sh run-tariff

Set AGENT_LOG_CYCLES=1 too if you want every bridge tick logged to the bridge
agent outgoing channel. Leave it at 0 to log only command results and failures.
EOF
}

command_run_shelly() {
  load_env
  if [[ -z "${SHELLY_HOST:-}" ]]; then
    echo "Set SHELLY_HOST first, e.g. SHELLY_HOST=192.168.1.125 $0 run-shelly" >&2
    exit 1
  fi
  cd "$ROOT_DIR"
  SMARTCLAWS_HOME="$SHELLY_HOME" \
    DEVICE_NAME="$SHELLY_DEVICE_NAME" \
    SHELLY_HOST="$SHELLY_HOST" \
    INCOMING_CHANNEL="$SHELLY_INCOMING_CHANNEL" \
    AGENT_NAME="$SHELLY_AGENT_NAME" \
    AGENT_LOG_ENABLED="$AGENT_LOG_ENABLED" \
    AGENT_LOG_CYCLES="$AGENT_LOG_CYCLES" \
    POLL_SECONDS="$POLL_SECONDS" \
    SMARTCLAWS_BIN="$SMARTCLAWS_BIN" \
    python3 dev/shelly-bridge.py
}

command_run_thermal() {
  load_env
  cd "$ROOT_DIR"
  SMARTCLAWS_HOME="$THERMAL_HOME" \
    DEVICE_NAME="$THERMAL_DEVICE_NAME" \
    SHELLY_OUTGOING_CHANNEL="$SHELLY_OUTGOING_CHANNEL" \
    AGENT_NAME="$THERMAL_AGENT_NAME" \
    AGENT_LOG_ENABLED="$AGENT_LOG_ENABLED" \
    AGENT_LOG_CYCLES="$AGENT_LOG_CYCLES" \
    POLL_SECONDS="$POLL_SECONDS" \
    SMARTCLAWS_BIN="$SMARTCLAWS_BIN" \
    python3 dev/thermal-sim.py
}

command_run_tariff() {
  load_env
  cd "$ROOT_DIR"
  mkdir -p "$(dirname "$TARIFF_FILE")"
  TARIFF_FILE="$TARIFF_FILE" \
    python3 dev/tariff-sim.py
}

case "${1:-}" in
  wallets) command_wallets ;;
  register) command_register ;;
  print) command_print ;;
  run-shelly) command_run_shelly ;;
  run-thermal) command_run_thermal ;;
  run-tariff) command_run_tariff ;;
  ""|-h|--help|help) usage ;;
  *)
    usage >&2
    exit 1
    ;;
esac
