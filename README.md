# dsh-context-shaping

Interactive **behavioral shaping** for a running DeepSeek Harness (DSH) session: rewriting its **model-visible conversation history** in place.

Edit a reply and its reasoning chain separately, delete a message, replace a whole exchange — the model's next request reads the shaped history as if it had always been that way, so the conversation continues along the shape you set. Each rewrite shadows the old nodes instead of erasing them, so the original text stays in the append-only event log, every rewrite is recorded in an audit trail, and rewrites can be undone.

> Community plugin — not affiliated with or endorsed by DeepSeek. It is a continuation of `@wasd258/dsh-context-surgery` 0.1.0–0.1.2 (© 2026 WASD258-jpg, MIT); see [License & attribution](#license--attribution).

Version 0.4.0 · MIT · Node.js >= 22.19.0 · requires a DSH web profile

## Requirements

- DSH with the **web profile** (`@deepseek-ai/dsh-web-app`): the browser half injects the per-message buttons.
- Node.js >= 22.19.0.
- A **running top-level session** to rewrite. Subagents are refused for mutating operations.

## Install

### Plugin Manager (recommended)

Open the plugins page in DSH (Plugin Manager) and install this bundle — `plugin_manager`'s `install_bundle` installs the package and selects the bundle for you. The card shows the localized title and description from this package: **Context Shaping** (English, `locale/en.json`) / **上下文塑形** (Chinese, `locale/zh.json`).

### Manual

Run pnpm **inside the profile directory** (the DSH app ships one at `resources/runtime/pnpm/bin/pnpm.cjs` if you have none on `PATH`):

```sh
cd ~/.dsh/profiles/<profile>          # desktop for the desktop app, web for `dsh web`
pnpm add github:zeranhub/dsh-context-shaping
```

That is what `install_bundle` does: the package lands in the **profile's own** `node_modules`, and the profile manifest records it as a dependency:

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {
    "dsh-context-shaping": "github:zeranhub/dsh-context-shaping"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-context-shaping"
      ]
    }
  }
}
```

If `dsh-context-shaping` is not in `dsh.profile.bundles` after the install, add it — that list is what inserts the plugin row.

> **A copy next to the profile is not enough.** Dropping the package into `~/.dsh/profiles/node_modules` (the parent directory) and only editing `dsh.profile.bundles` loads nothing: DSH resolves a bundle row through the profile's own dependency tree, so the package must be in `~/.dsh/profiles/<profile>/node_modules` and declared in that manifest's `dependencies`.

On Windows `~/.dsh` is `%USERPROFILE%\.dsh` (or `$DSH_HOME`).

Restart DSH and reload the page so the client module (`lib/client.js`) is loaded too — see [Notes](#notes).

> A bundle that does not declare `dsh.bundle.patch` is **skipped** by DSH and reported in `skippedBundles` at startup, so the plugin never loads even though it is listed. This package declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; that patch is what inserts the plugin row into the composition.

### Upgrading from 0.1.x

Two renames happened on the way here: 0.2.0 moved the scoped upstream package `@wasd258/dsh-context-surgery` to the unscoped `dsh-context-surgery` and added the `dsh.bundle.patch` declaration that 0.1.x lacked, and **0.4.0 renamed the project again, to `dsh-context-shaping`**. To migrate:

1. remove the old entry from `dsh.profile.bundles` in your profile manifest and delete the old module directory — `@wasd258/dsh-context-surgery` (0.1.x) and/or `dsh-context-surgery` (0.2.0/0.3.0);
2. install this package as above, with `dsh-context-shaping` in the bundle list;
3. restart DSH.

Leaving the old entry in place is harmless but pointless — DSH skips it and prints a line about it at startup. Rewrite records held in memory are per-process; after a restart `/shape history` still lists rewrites recovered from the durable log, without their original timestamps.

## Usage

### Per-message buttons (web GUI)

The plugin registers into the `conversation.chat.assistant-actions` slot (`order: 20`), so each assistant message gets an action row:

| Button | Action |
|---|---|
| ✏️ | Rewrite this reply. Opens an inline text box prefilled with the current reply text; **Save** → "Reply rewritten ✓". The reasoning chain and tool calls are kept. |
| 💡 | Rewrite this reasoning chain. Shown only when the message actually has a reasoning block; saving an empty text removes it. |
| ↩️ | Restore the content this rewrite shadowed. Shown only on rewrite nodes. |
| 🗑️ | Delete this message. Asks for confirmation first; the message disappears from the model's view. |
| badge | `rewritten` marks a node that is itself a rewrite; its original text is still in the event log. |

Button labels and tooltips follow the browser language (`zh*` → Chinese, otherwise English).

The host composes the row as `[clock] copy · extraActions · branch`, and our slot's entry is that `extraActions` — so these buttons sit **immediately to the right of the copy icon**.

### Edit your own message (web GUI)

The AI's buttons are per-message; your own messages have no action row a plugin can extend in this DSH build (see [Notes](#notes)). Instead the plugin adds a small ✏️ **Edit mine** control in the composer's tool row (`conversation.input.left`), which opens a full-width editor above the card (`conversation.input.dock`):

1. click **Edit mine** — it loads your most recent own message (injected `user/message` context is skipped);
2. change the text and press **Save**;
3. the message is rewritten in the model-visible history — **nothing is sent**, no new turn starts, and the next model request reads the edited text.

### `/shape` command

`/shape` on its own (or `/shape list`) prints the current model-visible nodes — the last 10, as `[seq] AI|TOOL|YOU <preview>`, with rewritten nodes marked — followed by the usage list.

| Command | Effect |
|---|---|
| `/shape`, `/shape list`, `ls`, `?` | List the current model-visible nodes (last 10) with `seq`, role badge and a 120-character preview. |
| `/shape show <seq>` | Print one node's full reply and reasoning chain (and whether it carries tool blocks). |
| `/shape edit <seq> <text>` | Rewrite the reply text only; reasoning chain and tool calls are kept. |
| `/shape think <seq> <text>` | Rewrite the reasoning chain only; the reply text is kept. |
| `/shape clear-think <seq>` | Remove the reasoning chain. |
| `/shape rewrite <seq> <user\|assistant> <text>` | Rewrite the whole node as plain text (`part=all`). This is the only command that may change a node's role. |
| `/shape delete <seq>` | Remove the node from the model's view. |
| `/shape replace <start> <end> <user\|assistant> <text>` | Replace the contiguous range `start..end` (inclusive, current surface order) with one message. |
| `/shape history [n]` (alias `log`) | Rewrite audit trail, newest first (default 10, clamped to 1–50). |
| `/shape undo [n]` (alias `restore`) | Restore the n-th most recent rewrite (default 1). |

`<text>` is taken verbatim from the command line, spaces included; `seq` arguments must be integers. Failures are reported as `操作失败：<reason>` and unknown subcommands as `未知子命令：<op>` — command output, error strings and audit lines are in Chinese in 0.2.0.

### Model tools

| Tool | Parameters | Notes |
|---|---|---|
| `shape_list` | `limit?` | List surface nodes in order (or the last N) with `seq`, `role`, `text`. Read-only. |
| `shape_edit` | `seq`, `text`, `part?` (`reply`/`thinking`/`all`), `role?` | `part` defaults to `reply`; `role` is only honored with `part=all`. |
| `shape_delete` | `seq` | Shadow one node with an empty assistant message. |
| `shape_replace` | `start`, `end`, `role`, `text` | Both endpoints inclusive and must be current surface nodes. |
| `shape_history` | `limit?` | Read the rewrite audit trail. Read-only. |
| `shape_restore` | `seq` **or** `index` | Undo the rewrite at `seq`, or the `index`-th most recent rewrite (1 = most recent). |

All six are refused when `exposeTools: false`; the four mutating tools require a running top-level session. Failures come back as `{ "ok": false, "error": "…" }`, successes as `{ "ok": true, "replacementSeq": …, "shadowedSeq": … }` and similar fields.

### HTTP API

Routes are registered under `/api/dsh-context-shaping` (prefix registration). `GET` routes are read-only, `POST` routes rewrite history.

| Method | Path | Parameters |
|---|---|---|
| GET | `/list` (or `/`) | `?sessionId=<id>&limit=<n>` — `limit` = last N rows; omitted or 0 = all. |
| GET | `/last-user` | `?sessionId=<id>` — the most recent message you sent, for the composer's *Edit mine* control: `{ ok, found, seq?, messageId?, text?, isRewritten?, sourceKind? }`. Skips injected `user/message` context. Reading only; no top-level check needed. |
| GET | `/message` | `?sessionId=<id>&messageId=<seq-or-message-id>` — one node split into reply / reasoning. |
| GET | `/history` | `?sessionId=<id>` — audit trail: in-process journal plus records recovered from the log. |
| POST | `/edit` | `{ sessionId, seq \| messageId, part?, role?, text }` |
| POST | `/delete` | `{ sessionId, seq \| messageId }` |
| POST | `/replace` | `{ sessionId, start, end, role, text }` |
| POST | `/restore` | `{ sessionId, seq \| messageId }` |

```jsonc
// GET /api/dsh-context-shaping/list?sessionId=abc&limit=2
{ "ok": true, "sessionId": "abc", "total": 12, "rows": [
  { "seq": 10, "type": "user/message", "role": "user", "text": "…", "isRewritten": false },
  { "seq": 11, "type": "assistant/message", "role": "assistant", "text": "…", "messageId": "msg_…", "isRewritten": true }
] }

// POST /api/dsh-context-shaping/edit
// { "sessionId": "abc", "seq": 11, "part": "thinking", "text": "…" }
{ "ok": true, "replacementSeq": 15, "shadowedSeq": 11, "role": "assistant", "part": "thinking", "text": "…" }
```

| Status | Condition |
|---|---|
| 403 | Request is not from loopback (`context-shaping API is loopback-only`). |
| 403 | `Host` header is not a loopback hostname on the current port (`invalid host header`) — DNS-rebinding defence, applied to `GET` and `POST` alike. |
| 403 | `POST` from a cross-origin page (`cross-origin request rejected`). |
| 403 | `httpEnabled: false`, or `POST` while `httpWrite: false`. |
| 415 | `POST` without `Content-Type: application/json`. |
| 400 | Body is not valid JSON (a body over 256 KiB is rejected the same way). |
| 404 | Session not running (`会话 <id> 不在运行中`), `messageId` not on the surface, or unknown route. |
| 200 + `ok: false` | Operation-level failure: shadowed `seq`, `tool/result` node, `thinking` on a user message, a subagent, and so on. |
| 500 | Internal error. |

## Configuration

Set these in the DSH settings page — the eight fields are declared `.volatile()` on the plugin's `Config`, so `dsh-settings` generates the form for the `context-shaping` row itself — or in the profile config layer. Everything has a default, so the plugin works unconfigured. Because the Loader hands the plugin live references for volatile fields and `makeConfigSource()` reads them through `get()`, an edit applies **immediately**: the row is not remounted and DSH does not need a restart.

| Key | Default | Effect |
|---|---|---|
| `exposeTools` | `true` | Register the `shape_*` tools for the model. When `false`, model calls are refused. |
| `allowToolNodes` | `false` | Allow whole-message rewrite, delete and range replace on messages carrying tool calls (this hides tool records from the model). |
| `allowRoleChange` | `true` | Allow the command and the GUI to change a message's role (requires `part=all`). |
| `allowModelRoleChange` | `false` | Allow the **model** to change a message's role (off by default, to prevent forged user turns). |
| `httpEnabled` | `true` | Serve the `/api/dsh-context-shaping` routes. |
| `httpWrite` | `true` | Allow HTTP rewrite / delete / restore; `false` makes the API read-only. |
| `auditSize` | `200` | Rewrite records kept per session. |
| `maxTextLength` | `200000` | Character limit for a single rewrite's text. |

## How it works

- The model's message list is folded from the session log's **surface** (`Session.deriveMessages()` → request assembly). The log is append-only, but the surface supports **positional replacement**: appending a message event carrying `surfaceOp: { op: "replace", start, end }` plus `sourceEventSeqs` (covering every shadowed node) replaces that contiguous range with the new node. Compaction summaries use the same seam.
- So a rewrite is always an append: the model's next request reads the edited history, the GUI re-folds the conversation view, and the original text is still in the event log. Nothing in the log is edited in place.
- `lib/index.js` is the host half: the `/shape` command, the six `shape_*` tools, the HTTP routes and the configuration schema (whose `.volatile()` fields drive the auto-generated settings form). `lib/client.js` is the browser half: it registers three slot entries — the per-message action row (`conversation.chat.assistant-actions`), the *Edit mine* control (`conversation.input.left`) and its editor (`conversation.input.dock`). `lib/ops.js` implements the operations against a session object and `lib/core.js` holds the pure helpers (previews, block transforms, command parsing) — both are free of DSH imports, so `node --test` covers them without a DSH runtime.

## `part` semantics

| `part` | text blocks | reasoning blocks | other blocks (tool calls, …) | Applies to |
|---|---|---|---|---|
| `reply` (default) | replaced | kept | kept | user and assistant |
| `thinking` | kept | replaced; empty text removes all of them | kept | assistant only (a user message has no reasoning chain and is refused) |
| `all` | the whole message becomes one text block | dropped | dropped | user and assistant |

With `reply`, several text blocks collapse into **one** text block, placed where the first one was (0.2.0 fix). A role change is only possible with `part=all`.

## Limitations

- **Running top-level sessions only.** Mutating operations go through `requireRootAgent`: subagents are refused, and the HTTP API reports a session that is not running as 404. Read-only views (`list`, `show`, `history`) are not restricted.
- **`tool/result` nodes cannot be rewritten, deleted or restored.**
- **Destructive operations on tool-calling messages are refused by default.** Deleting or whole-rewriting a message that carries tool calls would leave its tool result orphaned in the context; enable `allowToolNodes` if you really want that.
- **A role change requires `part=all`**, i.e. a whole-message rewrite as plain text — the reasoning chain and tool blocks are dropped. The model cannot change roles at all unless `allowModelRoleChange` is turned on.
- **Range restore is merged and lossy.** A surface replacement is "one range → one node", so restoring a replaced range merges the original nodes into a single message (`lossy: true`): the text is preserved (joined with `\n\n---\n\n` and `[seq role]` prefixes), the segmentation is not. Single-node rewrites (edit / delete) restore exactly.
- **Chained rewrites undo one version at a time.** Undoing a rewrite that was itself rewritten returns to the previous version, not necessarily to the original text.
- **The GUI conversation view is a human transcript.** The model's view is the rewritten history; some views may still render the append-origin text.
- **Only the session is rewritten, never the log.** The original text of every rewrite stays readable in the event log by anyone with access to the DSH home directory.
- **Deletion shadows a node with an empty assistant message**, not an empty user message. This is deliberate: the host projection only drops empty-content assistant messages, so an empty user message would still reach the model. Investigated; not a bug.

## Security

The HTTP API is loopback-only with `Host`/`Origin` checks but has **no authentication**, so any local process can read session content (including reasoning chains) and drive rewrites. The model tools let a prompt-injected model hide parts of its own history, which is why `allowToolNodes` and `allowModelRoleChange` default to the safe side. The plugin makes no outbound network requests, has no third-party dependencies, and does not read credentials.

Read [SECURITY.md](SECURITY.md) for the full threat model and a hardening checklist.

## Development

```sh
npm run check   # node --check on every lib/*.js file
npm test        # node --test
```

There are no dependencies, and the tests need no DSH runtime: `lib/core.js` and `lib/ops.js` take a fake session object. CI (`.github/workflows/ci.yml`) runs both on Node 22 and 24.

## Notes

- **Bundle patch required.** In this DSH version every entry of `dsh.profile.bundles` must be a package declaring `dsh.bundle.patch`; bundles without it are skipped and listed in `skippedBundles`. This package ships `cordis.patch.yml`, which inserts the plugin row (`id: context-shaping`).
- **Client factory id.** The browser module's id must equal the package name (`dsh-context-shaping`); `lib/client.js` registers itself under that id and returns `{ inject, apply }`.
- **No `peerDependencies` on purpose.** DSH validates `peerDependencies` ranges for `@deepseek-ai/dsh*` before importing a plugin, and a too-narrow range would block installation. This package therefore declares none and relies on the host services it injects (`commands`, `tools`, `agents`, and `webServer` when present).
- **HMR vs restart.** Installing a new bundle can take effect through HMR; **replacing an already-installed package of the same name requires a restart** so the new JS modules are loaded.
- **Why there is no edit button under *your* messages.** This DSH build exposes four `conversation.chat.*` slots: `node`, `commandview`, `turnTail` and `assistant-actions`. The assistant row passes our slot as `extraActions`, so buttons land right after the copy icon; the user row (`UserMessageNodeView`) renders `MessageIconActions` **without** `extraActions` and renders no slot inside the bubble, so no plugin can add a control there. Per the slot contract, a clickable control belongs in the composer tool row (`conversation.input.left`) and taller content in `conversation.input.dock` — which is where this plugin's *Edit mine* control and its editor live. `/shape edit <seq> <text>` remains the exact way to rewrite a user message from the command line.
- **Headless compositions.** The web routes are injected separately (`ctx.inject(["webServer"], …)`), so the command and the tools still work where no web server exists; only the buttons and the HTTP API are missing.
- The surface-replacement seam this plugin relies on is DeepSeek Harness's; the commit the implementation was written against is recorded in [NOTICE](NOTICE).
- History rewriting depends on the host exposing `session.surface.nodes`; if a future DSH version stops doing so, the plugin reports that instead of guessing.

## License & attribution

MIT.

This repository is **not an original work**. It continues the community plugin `@wasd258/dsh-context-surgery` (versions 0.1.0–0.1.2, © 2026 WASD258-jpg, MIT), whose GitHub repository is no longer available (404). The original attribution and the MIT notice for that work are preserved in [NOTICE](NOTICE), and the license text applies to the original work and to this continuation alike.

Maintained by [zeranhub](https://github.com/zeranhub). DeepSeek and DeepSeek Harness are the names of their respective owner; this project is not affiliated with or endorsed by DeepSeek.
