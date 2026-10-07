# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This repository continues the community plugin `@wasd258/dsh-context-surgery` (0.1.0–0.1.2). Those releases are listed at the end for context; they are not maintained here.

## [0.2.0] - 2026-10-07

### Added

- **Rewrite audit trail.** `/context history [n]` (alias `log`), the `context_history` tool, and `GET /api/dsh-context-surgery/history`. Entries are derived from the durable event log, so the trail survives a DSH restart; records recovered from the log that way are marked with the `recovered` source.
- **Restore / undo.** `/context undo [n]` (alias `restore`), the `context_restore` tool, `POST /api/dsh-context-surgery/restore`, and the ↩️ button on rewrite nodes. Exact for single-node rewrites (`edit`, `delete`); a range replacement can only be restored merged into one message and reports `lossy: true`.
- **Configuration.** A schemastery config object and a settings section (namespace `context-surgery`) with eight keys, all defaulted: `exposeTools`, `allowToolNodes`, `allowRoleChange`, `allowModelRoleChange`, `httpEnabled`, `httpWrite`, `auditSize`, `maxTextLength`. The HTTP API can be made read-only or disabled, and the model's ability to change a message's role is off by default.
- **Top-level session guard.** `requireRootAgent` — mutating operations (command subcommands, the four write tools, HTTP writes) require a running top-level session; subagents are refused.
- `/context show <seq>` for inspecting a single node's reply and reasoning chain.
- `part`-level semantics are spelled out in the tool descriptions, including that a role change is only possible with `part=all`.

### Fixed

- **Command arguments were sliced at the wrong offset.** Text was extracted with `indexOf` on the token value, so a rewrite whose text repeated an earlier token was truncated at the first match (for example `/context edit 5 5` produced an empty reply). Text is now taken by token offset (`textAfter`).
- **`part=reply` duplicated the new text into every text block.** A message with several text blocks received the new text in each of them; it now yields exactly one text block, placed where the first text block was.
- **Destructive rewrites could orphan tool results.** Deleting a message or rewriting it whole (`part=all`) could remove a node that carried tool calls while its `tool/result` stayed in the model-visible context, leaving a tool result without its call. These operations are now refused for such nodes unless `allowToolNodes` is enabled.

### Security

- **Requests without a `Host` header are rejected** (previously accepted). The `Host` and `Origin` checks stay loopback-only and port-bound; the API still has no authentication — see [SECURITY.md](SECURITY.md).

### Changed

- Package metadata: `dsh.bundle.patch` (`./cordis.patch.yml`) is declared so DSH actually loads the bundle (`dsh.profile.bundles` entries without a patch are skipped and reported in `skippedBundles`); `./cordis.patch.yml` and `./locale/*.json` are exported and shipped; the client factory id equals the package name (`dsh-context-surgery`); localized plugin titles ship in `locale/en.json` and `locale/zh.json`.
- `webServer` is injected on demand instead of being a hard dependency, so the command and tools keep working in compositions without a web server.

### Notes

- Deletion still shadows a node with an **empty assistant message**. This is deliberate, not a bug: the host projection only drops empty-content `assistant/message` events, so an empty user message would still reach the model.
- Rewrites remain appends. The event log is never modified in place, and the original text of every rewrite stays readable in it.

## Prior releases (upstream, not maintained here)

- **0.1.0 – 0.1.2** (2026-08-15) — `@wasd258/dsh-context-surgery` by WASD258-jpg, MIT: the original implementation with the `/context` command (`edit`, `think`, `clear-think`, `rewrite`, `delete`, `replace`), the `context_list` / `context_edit` / `context_delete` / `context_replace` tools, the per-message buttons, and the loopback HTTP API. Its GitHub repository is no longer available (404). 0.2.0 continues from that code; the original attribution and MIT notice are preserved in [NOTICE](NOTICE).
