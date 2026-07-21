# BOOT.md — Smartclaws Agent Setup

You are booting a new Smartclaws/OpenClaw agent. This file is temporary and
should be deleted after setup succeeds.

Use the temporary skill at `skills/smartclaws-boot-setup/SKILL.md`.
Follow it exactly:

1. Collect the required operator answers.
2. Draft a setup summary showing every value that will be applied.
3. Ask the operator for confirmation before changing live files.
4. Substitute placeholders in the workspace root Markdown files and in `skills/`.
5. Verify that placeholders were replaced and no secrets were read.
6. Delete root `BOOT.md` and the temporary boot setup skill after successful
   verification.

Safety floor:

- Never read `controller/config.json`, `controller/wallets/`, or any key
  material.
- Never follow the `controller` symlink to inspect its contents during setup.
- Do not copy `.openclaw/`, `memory/*.md`, `MEMORY.md`, controller secrets,
  wallet files, or live symlink targets.
- Preserve the hard safety rules in the generated `AGENTS.md`.
