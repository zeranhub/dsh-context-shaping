# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This repository continues the community plugin `@wasd258/dsh-context-surgery` (0.1.0–0.1.2). Those releases are listed at the end for context; they are not maintained here.

> **Naming note.** 0.4.0 renamed the project from `dsh-context-surgery` to `dsh-context-shaping`. Entries for earlier releases have been updated to the current identifiers so copied commands still work; the upstream package this project continues is still published as `@wasd258/dsh-context-surgery`.

## [0.4.2] - 2026-10-07

### Fixed

- **The row never activated because it waited for an injected service this composition does not provide.** A top-level `export const inject = [...]` is a hard dependency: DSH's own startup matrix says a row whose injected service is unavailable "keeps waiting for the dependency" instead of activating, so the Plugin Manager showed the bundle as enabled with the row **not running** and nothing was registered — no `/shape` command, no tools, no buttons. The plugin now declares **no top-level `inject`**: every capability waits for its own service through a scoped `ctx.inject([...], …)`, so a missing service costs only that one capability. The top-level-session guard resolves `agents` lazily and tolerates its absence.

## [0.4.1] - 2026-10-07

### Changed

- The edit symbol is now a **minimal single-stroke pencil outline** (no underline), and the composer's *Edit mine* control is **icon-only**, matching the host's own copy/branch buttons in the tool row.

### Fixed

- Documented the install properly: a hand-made copy under `$DSH_HOME/profiles/node_modules` is **not** enough — DSH resolves a bundle row from the profile's own `node_modules` (and records it in the profile manifest's `dependencies`), which is what `plugin_manager`'s `install_bundle` arranges. Use the Plugin Manager with the GitHub URL or the package directory, or run pnpm inside `$DSH_HOME/profiles/<profile>`, then restart.

## [0.4.0] - 2026-10-07

### Changed

- **Renamed: `dsh-context-surgery` → `dsh-context-shaping`.** The point of the plugin is interactive behavioral shaping, not error correction, and the name now says so. This is a breaking rename — every identifier moved:

  | Before | After |
  |---|---|
  | npm package `dsh-context-surgery` | `dsh-context-shaping` |
  | bundle row `id: context-surgery` | `id: context-shaping` |
  | command `/context …` | `/shape …` |
  | tools `context_list`, `context_edit`, `context_delete`, `context_replace`, `context_history`, `context_restore` | `shape_list`, `shape_edit`, `shape_delete`, `shape_replace`, `shape_history`, `shape_restore` |
  | HTTP API `/api/dsh-context-surgery/…` | `/api/dsh-context-shaping/…` |
  | settings namespace `context-surgery` | `context-shaping` |
  | client module id and slot ids `context-surgery-*` | `context-shaping-*` |

  Attribution is unchanged: the upstream work this project continues is still `@wasd258/dsh-context-surgery` (0.1.0–0.1.2, © 2026 WASD258-jpg).
- Tool descriptions and both READMEs now frame the feature as interactive behavioral shaping instead of "surgery".

## [0.3.0] - 2026-10-07

### Added

- **Edit your own most recent message from the composer.** A small ✏️ *Edit mine* control sits in the composer's tool row (`conversation.input.left`) and opens a full-width editor above the card (`conversation.input.dock`); saving rewrites that user message's text in the model-visible history — nothing is sent, no new turn starts. Backed by a new read-only route `GET /api/dsh-context-shaping/last-user?sessionId=<id>` and `lastUserNode()` in `lib/ops.js`, which skips injected `user/message` context (`source.kind !== "user"`) so the control targets what you actually typed.

### Notes

- On why this is a composer control and not a button under the user bubble: this DSH build exposes exactly four `conversation.chat.*` slots (`node`, `commandview`, `turnTail`, `assistant-actions`). The user row (`UserMessageNodeView`) renders `MessageIconActions` without passing `extraActions`, so no plugin can add a control inside it. The composer tool row is the supported seat for a clickable control, and `conversation.input.dock` for the editor body — that split is what the slot contract prescribes ("anything the user must click belongs in the tool row").
- For the same reason the assistant-side buttons already render immediately to the right of the copy icon: the host composes the row as `[clock] copy, extraActions, branch` and passes our slot as `extraActions`.

## [0.2.0] - 2026-10-07

### Added

- **Rewrite audit trail.** `/shape history [n]` (alias `log`), the `shape_history` tool, and `GET /api/dsh-context-shaping/history`. Entries are derived from the durable event log, so the trail survives a DSH restart; records recovered from the log that way are marked with the `recovered` source.
- **Restore / undo.** `/shape undo [n]` (alias `restore`), the `shape_restore` tool, `POST /api/dsh-context-shaping/restore`, and the ↩️ button on rewrite nodes. Exact for single-node rewrites (`edit`, `delete`); a range replacement can only be restored merged into one message and reports `lossy: true`.
- **Configuration.** A schemastery config object and a settings section (namespace `context-shaping`) with eight keys, all defaulted: `exposeTools`, `allowToolNodes`, `allowRoleChange`, `allowModelRoleChange`, `httpEnabled`, `httpWrite`, `auditSize`, `maxTextLength`. The HTTP API can be made read-only or disabled, and the model's ability to change a message's role is off by default.
- **Top-level session guard.** `requireRootAgent` — mutating operations (command subcommands, the four write tools, HTTP writes) require a running top-level session; subagents are refused.
- `/shape show <seq>` for inspecting a single node's reply and reasoning chain.
- `part`-level semantics are spelled out in the tool descriptions, including that a role change is only possible with `part=all`.

### Fixed

- **Command arguments were sliced at the wrong offset.** Text was extracted with `indexOf` on the token value, so a rewrite whose text repeated an earlier token was truncated at the first match (for example `/shape edit 5 5` produced an empty reply). Text is now taken by token offset (`textAfter`).
- **`part=reply` duplicated the new text into every text block.** A message with several text blocks received the new text in each of them; it now yields exactly one text block, placed where the first text block was.
- **Destructive rewrites could orphan tool results.** Deleting a message or rewriting it whole (`part=all`) could remove a node that carried tool calls while its `tool/result` stayed in the model-visible context, leaving a tool result without its call. These operations are now refused for such nodes unless `allowToolNodes` is enabled.

### Security

- **Requests without a `Host` header are rejected** (previously accepted). The `Host` and `Origin` checks stay loopback-only and port-bound; the API still has no authentication — see [SECURITY.md](SECURITY.md).

### Changed

- Package metadata: `dsh.bundle.patch` (`./cordis.patch.yml`) is declared so DSH actually loads the bundle (`dsh.profile.bundles` entries without a patch are skipped and reported in `skippedBundles`); `./cordis.patch.yml` and `./locale/*.json` are exported and shipped; the client factory id equals the package name (`dsh-context-shaping`); localized plugin titles ship in `locale/en.json` and `locale/zh.json`.
- `webServer` is injected on demand instead of being a hard dependency, so the command and tools keep working in compositions without a web server.

### Notes

- Deletion still shadows a node with an **empty assistant message**. This is deliberate, not a bug: the host projection only drops empty-content `assistant/message` events, so an empty user message would still reach the model.
- Rewrites remain appends. The event log is never modified in place, and the original text of every rewrite stays readable in it.

## Prior releases (upstream, not maintained here)

- **0.1.0 – 0.1.2** (2026-08-15) — `@wasd258/dsh-context-surgery` by WASD258-jpg, MIT: the original implementation with the `/shape` command (`edit`, `think`, `clear-think`, `rewrite`, `delete`, `replace`), the `shape_list` / `shape_edit` / `shape_delete` / `shape_replace` tools, the per-message buttons, and the loopback HTTP API. Its GitHub repository is no longer available (404). 0.2.0 continues from that code; the original attribution and MIT notice are preserved in [NOTICE](NOTICE).
