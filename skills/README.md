# SmartClaws Skills Framework

This directory contains the reusable SmartClaws skill framework for OpenClaw.
The executable integration lives in the `smartclaws-openclaw-plugin`; skills do
not install or build the CLI.

## Structure

- `operational/smartclaws-master-agent/` - role skill for controller/orchestrator agents.
- `operational/smartclaws-bridge-agent/` - role skill for hardware/API bridge agents.
- `devices/<device>/` - device contract skills: topics, payloads, protocol notes, and safety rules.

## Setup Contract

`skills/SMARTCLAWS.md` is an intentionally empty framework placeholder. Real
OpenClaw deployments should create their own workspace-root `SMARTCLAWS.md`
from the contract described in the operational skills. That deployment file binds
reusable skills to actual channels, devices, policy files, and authority rules.
