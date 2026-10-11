# Vault (model-blind browser + HTTP)

Use the MCP server **personal-vault**. The job token is injected into that
process only — you never receive passwords.

## Tools

### vault_list
Returns `{ handles: [{ handle, label, username, origin }] }`.

### vault_fill (browser autofill)
```
vault_fill({
  handle: "vault_…",
  url: "https://example.com/login",
  username_selector?: "#email",
  password_selector?: "#password",
  submit_selector?: "button[type=submit]"
})
```
Opens the URL in a headless browser, checks origin binding, fills fields.
Result: `{ success, filled_fields, origin, url }` — **never the password**.

### vault_http
Authenticated HTTP; secret injected by the control plane; response scrubbed.

## Rules
- Prefer `vault_fill` for website logins.
- Prefer `vault_http` for API keys / bearer tokens.
- On `origin_mismatch`, stop. Do not ask the user for the password in chat.
