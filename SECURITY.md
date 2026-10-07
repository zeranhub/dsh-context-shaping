# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x (this repository) | yes |
| 0.1.x (`@wasd258/dsh-context-surgery`) | no — upstream, not maintained here |

## Reporting a vulnerability

- Non-sensitive reports: open a GitHub issue.
- Anything exploitable: use this repository's private advisory form (Security → *Report a vulnerability*), so a fix can ship before the details are public.

Please include the affected version, the DSH version or commit, a minimal reproduction, and what an attacker gains. No bug bounty is offered; reports are handled on a best-effort basis. Please do not disclose an unpatched vulnerability publicly first.

## Threat model

This plugin deliberately hands out the ability to change what a model believes the conversation contains. Its security posture rests on four assumptions.

### 1. The HTTP API has no authentication

`/api/dsh-context-shaping` serves loopback clients only, requires a loopback `Host` header on the current port (DNS-rebinding defence), rejects cross-origin `POST`s, insists on `Content-Type: application/json`, and caps request bodies at 256 KiB. None of that **authenticates** the caller:

- **Any local process can read the session** — including reasoning chains — and drive rewrites through `POST /edit`, `/delete`, `/replace` and `/restore`.
- A local reverse proxy or tunnel makes remote callers look like `127.0.0.1`; the plugin cannot tell the difference.
- `httpWrite: false` makes the API read-only. `httpEnabled: false` removes the routes entirely.

The web GUI's per-message buttons use this API, so both settings disable those buttons too; `/shape` and the model tools keep working.

### 2. The model tools let a prompt-injected model hide its own history

`exposeTools: true` (default) registers `shape_list`, `shape_edit`, `shape_delete`, `shape_replace`, `shape_history` and `shape_restore` for the model. A model steered by untrusted input can rewrite or delete messages — including the records of its own tool calls — and, with `part=all`, turn a message into a user-role turn that renders as a user message.

The defaults are on the safe side: `allowToolNodes: false` refuses destructive operations on messages that carry tool calls, and `allowModelRoleChange: false` stops the model from changing a message's role at all. `exposeTools: false` removes the tools entirely.

### 3. Rewrites are auditable, not invisible

Rewrites shadow nodes rather than erasing them:

- The original text stays in the append-only event log, and the plugin never modifies the log in place.
- Every rewrite is recorded in the audit trail (`/shape history`, `shape_history`, `GET /history`) with who did it (`command`, `tool`, `http`, or `recovered` from the log), which nodes were shadowed, and the replacement node's id.
- Rewrites can be restored (`/shape undo`, `shape_restore`, `POST /restore`, ↩️).

Audit and describe responses include short previews of the shadowed originals; the full originals live only in the log. None of this protects against someone who can already read the DSH home directory.

### 4. Network, credentials and dependencies

The plugin makes no outbound network requests and has no telemetry. It does not read credentials, environment variables, browser storage or files outside the session mechanism, spawns no processes, evaluates no remote code, and has no third-party dependencies and no install-time lifecycle scripts. It uses only the host services it injects: `commands`, `tools`, `agents`, and `webServer` when present. Sessions and the client module are the only interfaces it touches.

### Scope

The plugin operates on sessions of the DSH instance it is loaded into, through that instance's own session and web-server services. Mutating operations require a running top-level session (`requireRootAgent`); a session that is not running is reported as 404. It does not defend against an attacker who already controls the host user account, the DSH process, or the session log files.

## Hardening checklist

- Keep DSH's HTTP server bound to loopback (the default) and do not put it behind a proxy or tunnel.
- Set `httpWrite: false` (read-only API) or `httpEnabled: false` (no API) if you do not need the GUI buttons or programmatic access.
- Set `exposeTools: false` if the model must not rewrite its own history.
- Leave `allowToolNodes` and `allowModelRoleChange` at their defaults unless you have a specific reason.
- Treat the DSH home directory as sensitive: session logs contain the original text of every rewrite, and the audit trail shows what was changed.
