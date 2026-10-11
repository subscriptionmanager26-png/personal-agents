# Personal agent workspace

This repository belongs to **one person**. Skills they install live under `.cursor/skills/`.

## Rules

- Treat memory as private to the owner.
- **Model-blind vault (Hermes style):** use MCP server `personal-vault`.
  - `vault_list` — opaque handles only
  - `vault_fill` — browser autofill; result is `{filled_fields, origin, success}` only
  - `vault_http` — authenticated HTTP via control-plane proxy
- Never ask for passwords in chat. Never print vault tokens or secrets.
- Follow enabled skill `SKILL.md` files for domain workflows.
- Put long deliverables in both `artifacts/` and `/opt/cursor/artifacts/`.
