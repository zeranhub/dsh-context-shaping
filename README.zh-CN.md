# dsh-context-shaping

对**运行中的 DSH（DeepSeek Harness）会话**做交互式**行为塑形**：就地在**模型可见历史**上改写。

回复正文与思考链分开编辑、删除单条消息、整段替换一场对话——模型下一轮请求读到的就是塑形后的历史，仿佛从未变过，后续对话便沿着你设定的形状继续。每次改写只是**影蔽**旧节点而不是抹掉它们：原始文本仍留在 append-only 的事件日志里，每次改写都进入审计记录，而且可以还原。

> 社区插件——非 DeepSeek 官方组件，不代表 DeepSeek 背书。它是 `@wasd258/dsh-context-surgery` 0.1.0–0.1.2（© 2026 WASD258-jpg，MIT）的延续，见[许可与署名](#许可与署名)。

版本 0.4.0 · MIT · Node.js >= 22.19.0 · 需要 DSH web profile

## 环境要求

- 带 **web profile**（`@deepseek-ai/dsh-web-app`）的 DSH：浏览器端负责注入每条消息的操作按钮。
- Node.js >= 22.19.0。
- 一个**运行中的顶层会话**。子代理不可做改写操作。

## 安装

### Plugin Manager（推荐）

在 DSH 里打开插件页（Plugin Manager）安装本 bundle——`plugin_manager` 的 `install_bundle` 会替你完成包安装与 bundle 选择。卡片上显示本包自带的本地化标题与描述：**Context Shaping**（英文，`locale/en.json`）/ **上下文塑形**（中文，`locale/zh.json`）。

### 手动安装

```sh
cd ~/.dsh/profiles
npm install --no-save github:zeranhub/dsh-context-shaping
```

`--no-save` 不能省：profiles 根目录本身没有 `package.json`，不加它 npm 会在这里自己生成一份 `package.json`（把依赖写进去）和 `package-lock.json`；加上 `--no-save` 就只写入 `node_modules/dsh-context-shaping`，目录保持干净。

也可以直接把仓库克隆进模块目录：`git clone https://github.com/zeranhub/dsh-context-shaping ~/.dsh/profiles/node_modules/dsh-context-shaping`。

然后把包名加进 profile 的 `dsh.profile.bundles`（文件：`~/.dsh/profiles/<profile>/package.json`，`<profile>` 桌面应用是 `desktop`，`dsh web` 是 `web`）：

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {},
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

Windows 上 `~/.dsh` 即 `%USERPROFILE%\.dsh`（或 `$DSH_HOME`）。

装好后重启 DSH 并刷新页面，浏览器端模块（`lib/client.js`）才会加载——见[说明](#说明)。

> 没有声明 `dsh.bundle.patch` 的 bundle 会被 DSH **跳过**，并在启动时列进 `skippedBundles`：即使写进了 bundles 列表，插件也不会加载。本包声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，正是这个 patch 把插件行插入组合。

### 从 0.1.x 升级

路上改过两次名：0.2.0 把带作用域的上游包 `@wasd258/dsh-context-surgery` 改成不带作用域的 `dsh-context-surgery`，并补上 0.1.x 缺失的 `dsh.bundle.patch` 声明；**0.4.0 又把项目改名为 `dsh-context-shaping`**。迁移步骤：

1. 从 profile 清单的 `dsh.profile.bundles` 里删掉旧条目，并删除旧的模块目录——`@wasd258/dsh-context-surgery`（0.1.x）和/或 `dsh-context-surgery`（0.2.0/0.3.0）；
2. 按上面的方式安装本包，bundle 列表里写 `dsh-context-shaping`；
3. 重启 DSH。

旧条目留着无害但没用——DSH 会跳过它并在启动时打一行提示。内存里的改写记录是按进程保存的；重启后 `/shape history` 仍会列出从持久日志里复原的改写，只是没有它们最初的时间戳。

## 使用

### 每条消息的操作按钮（Web GUI）

插件注册进 `conversation.chat.assistant-actions` 插槽（`order: 20`），每条 AI 消息因此多出一行操作：

| 按钮 | 作用 |
|---|---|
| ✏️ | 改写这条回复。展开内联文本框并预填当前回复正文；点**保存** →「回复已改写 ✓」。思考链与工具调用保留。 |
| 💡 | 改写这条消息的思考链。仅在消息确实带 reasoning 块时出现；留空保存 = 移除。 |
| ↩️ | 还原这次改写所影蔽的内容。仅在改写节点上出现。 |
| 🗑️ | 删除这条消息。先弹确认；确认后从模型视角消失。 |
| 徽标 | `rewritten`（已改写）标记该节点本身是一次改写；它的原文仍在事件日志里。 |

按钮文案与提示跟随浏览器语言（`zh*` → 中文，否则英文）。

宿主把这一行拼成 `[时钟] 复制 · extraActions · 分支`，我们的插槽内容正是其中的 `extraActions`——所以这些按钮就出现在**复制图标正右边**。

### 编辑我自己发的消息（Web GUI）

AI 消息的按钮是「每条消息一个」；而你自己的消息，在这个 DSH 构建里没有任何可供插件扩展的动作行（见[说明](#说明)）。因此插件改为在输入卡片的工具行（`conversation.input.left`）放一个小按钮 ✏️ **改我的消息**，点开后在卡片上方（`conversation.input.dock`）展开整行编辑器：

1. 点「改我的消息」——载入你最近一条自己发的消息（注入的 `user/message` 上下文会被跳过）；
2. 改完点**保存**；
3. 该消息在模型可见历史里被改写——**不会发送**、不会开启新回合，下一轮模型请求读到的就是改后的文本。

### `/shape` 命令

单独输入 `/shape`（或 `/shape list`）会列出当前模型可见节点——最后 10 条，格式 `[seq] AI|TOOL|YOU <预览>`，改写节点带标记——并附上用法列表。

| 命令 | 作用 |
|---|---|
| `/shape`、`/shape list`、`ls`、`?` | 列出当前模型可见节点（最后 10 条），含 `seq`、角色标签与 120 字符预览。 |
| `/shape show <seq>` | 查看某节点的完整回复与思考链（以及是否含工具块）。 |
| `/shape edit <seq> <文本>` | 只改回复正文；思考链与工具调用保留。 |
| `/shape think <seq> <文本>` | 只改思考链；回复正文保留。 |
| `/shape clear-think <seq>` | 移除思考链。 |
| `/shape rewrite <seq> <user\|assistant> <文本>` | 整条重写为纯文本（`part=all`）。这是唯一能改变节点角色的命令。 |
| `/shape delete <seq>` | 把该节点从模型视角移除。 |
| `/shape replace <start> <end> <user\|assistant> <文本>` | 把 `start..end`（含端点，按当前 surface 顺序）这段连续节点替换为一条消息。 |
| `/shape history [n]`（别名 `log`） | 改写审计，新的在前（默认 10 条，限制在 1–50）。 |
| `/shape undo [n]`（别名 `restore`） | 还原第 n 近的一次改写（默认最近一次）。 |

`<文本>` 按命令行原文整段取用（含空格）；`seq` 参数必须是整数。失败返回 `操作失败：<原因>`，未知子命令返回 `未知子命令：<op>`——0.2.0 的命令输出、错误文案与审计行都是中文。

### 模型工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `shape_list` | `limit?` | 按顺序列出 surface 节点（或最后 N 条），含 `seq`、`role`、`text`。只读。 |
| `shape_edit` | `seq`、`text`、`part?`（`reply`/`thinking`/`all`）、`role?` | `part` 默认 `reply`；`role` 仅在 `part=all` 时生效。 |
| `shape_delete` | `seq` | 以空 assistant 消息影蔽一条节点。 |
| `shape_replace` | `start`、`end`、`role`、`text` | 两端含端点，且都必须是当前 surface 节点。 |
| `shape_history` | `limit?` | 读取改写审计。只读。 |
| `shape_restore` | `seq` **或** `index` | 还原 `seq` 处的那次改写，或第 `index` 近的一次（1 = 最近）。 |

`exposeTools: false` 时六个工具一律被拒；四个改写类工具要求运行中的顶层会话。失败返回 `{ "ok": false, "error": "…" }`，成功返回 `{ "ok": true, "replacementSeq": … , "shadowedSeq": … }` 等字段。

### HTTP API

路由统一挂在 `/api/dsh-context-shaping` 下（prefix 注册）。`GET` 只读，`POST` 会改写历史。

| 方法 | 路径 | 参数 |
|---|---|---|
| GET | `/list`（或 `/`） | `?sessionId=<id>&limit=<n>`——`limit` = 最后 N 条；省略或 0 = 全部。 |
| GET | `/last-user` | `?sessionId=<id>`——你最近一条自己发的消息，供输入框的「改我的消息」使用：`{ ok, found, seq?, messageId?, text?, isRewritten?, sourceKind? }`。会跳过注入的 `user/message` 上下文。只读，不做顶层会话校验。 |
| GET | `/message` | `?sessionId=<id>&messageId=<seq 或消息 id>`——单条节点，拆成 reply / reasoning。 |
| GET | `/history` | `?sessionId=<id>`——审计：进程内 journal + 从日志复原的记录。 |
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

| 状态码 | 条件 |
|---|---|
| 403 | 来源不是回环地址（`context-shaping API is loopback-only`）。 |
| 403 | `Host` 头不是当前端口上的回环主机名（`invalid host header`）——防 DNS rebinding，GET/POST 一视同仁。 |
| 403 | 跨源页面发来的 `POST`（`cross-origin request rejected`）。 |
| 403 | `httpEnabled: false`，或 `httpWrite: false` 时的 `POST`。 |
| 415 | `POST` 未带 `Content-Type: application/json`。 |
| 400 | 请求体不是有效 JSON（超过 256 KiB 的请求体同样被拒）。 |
| 404 | 会话不在运行（`会话 <id> 不在运行中`）、`messageId` 不在 surface、未知路由。 |
| 200 + `ok: false` | 操作级失败：seq 已被影蔽、`tool/result` 节点、对用户消息用 `thinking`、子代理等。 |
| 500 | 服务器内部错误。 |

## 配置

可在 DSH 设置页里改（插件注册了一个设置段，命名空间 `context-shaping`），也可以在 profile 的配置层里给。每一项都有默认值，不配置即可用；设置服务不可用时也无害（保持默认）。

| 配置项 | 默认值 | 作用 |
|---|---|---|
| `exposeTools` | `true` | 把 `shape_*` 工具交给模型；`false` 时模型调用一律被拒。 |
| `allowToolNodes` | `false` | 允许对含工具调用的消息做整条重写、删除、整段替换（会把工具记录从模型视角隐藏）。 |
| `allowRoleChange` | `true` | 允许命令与界面改变消息角色（需 `part=all`）。 |
| `allowModelRoleChange` | `false` | 允许**模型**改变消息角色（默认关闭，防止伪造用户发言）。 |
| `httpEnabled` | `true` | 启用 `/api/dsh-context-shaping` 路由。 |
| `httpWrite` | `true` | 允许 HTTP 改写 / 删除 / 还原；`false` 时接口只读。 |
| `auditSize` | `200` | 每个会话保留的改写记录条数。 |
| `maxTextLength` | `200000` | 单次改写文本的字符上限。 |

## 工作原理

- 模型的消息列表由会话日志的 **surface** 折叠而来（`Session.deriveMessages()` → 请求组装）。日志是 append-only，但 surface 支持**位置替换**：追加一个带 `surfaceOp: { op: "replace", start, end }` 与 `sourceEventSeqs`（覆盖全部被影蔽节点）的消息事件，就能把这段连续节点替换成新节点——compaction 压缩总结用的正是同一条缝。
- 所以每次改写都是一次追加：模型下一轮请求读到改后的历史，GUI 重新折叠对话视图，而原始文本仍完整留在事件日志里。日志本身从不被就地修改。
- `lib/index.js` 是 host 端：`/shape` 命令、六个 `shape_*` 工具、HTTP 路由与设置段。`lib/client.js` 是浏览器端：注册三处插槽——每条消息的操作行（`conversation.chat.assistant-actions`）、「改我的消息」按钮（`conversation.input.left`）与它的编辑器（`conversation.input.dock`）。`lib/ops.js` 针对会话对象实现各个操作，`lib/core.js` 放纯函数（预览、块变换、命令解析）——两者都不 import 任何 DSH 包，因此 `node --test` 无需 DSH 运行时即可覆盖。

## `part` 语义

| `part` | text 块 | reasoning 块 | 其他块（工具调用等） | 适用 |
|---|---|---|---|---|
| `reply`（默认） | 替换 | 保留 | 保留 | user、assistant |
| `thinking` | 保留 | 替换；留空 = 全部移除 | 保留 | 仅 assistant（用户消息没有思考链，会被拒绝） |
| `all` | 整条变成单一 text 块 | 丢弃 | 丢弃 | user、assistant |

`reply` 下多个 text 块会折叠成**一个** text 块，位置取第一个 text 块处（0.2.0 修复）。角色变更只能在 `part=all` 下进行。

## 已知限制

- **仅限运行中的顶层会话。** 改写类操作都要过 `requireRootAgent`：子代理一律拒绝，未在运行的会话在 HTTP API 里返回 404。只读视图（`list`、`show`、`history`）不受此限制。
- **`tool/result` 节点不能被改写、删除或还原。**
- **默认拒绝对含工具调用的消息做破坏性操作。** 删除或整条重写这类消息会让它的工具结果在上下文里变成孤儿；确实需要时打开 `allowToolNodes`。
- **改变角色必须用 `part=all`**，即整条重写为纯文本——思考链与工具块会被丢弃。模型默认完全不能改角色，除非打开 `allowModelRoleChange`。
- **整段还原是合并且有损的。** surface 替换是「一段换一条」，因此还原被替换的区间只能把原节点合并成一条消息（`lossy: true`）：内容不丢（用 `\n\n---\n\n` 连接，并带 `[seq role]` 前缀），但分段不再是独立消息。单节点改写（edit / delete）可以逐字还原。
- **链式改写只能逐次回退。** 还原一次「对改写结果的改写」，回到的是上一版，而不一定是最初的原文。
- **GUI 对话视图是给人看的历史记录。** 模型看到的是改写后的历史；某些视图可能仍会渲染追加来源的文本。
- **只改写会话，不改写日志。** 每次改写的原文仍可在事件日志里读到——任何能访问 DSH home 目录的人都能看到。
- **删除用空 assistant 消息影蔽节点**，而不是空 user 消息。这是有意为之：宿主投影只会丢弃空内容的 assistant 消息，空 user 消息仍会进入请求。已核实，不是 bug。

## 安全

HTTP API 只服务本机回环、带 `Host`/`Origin` 校验，但**没有鉴权**：本机任何进程都能读取会话内容（含思考链）并驱动改写。模型工具则把「改写自身历史」的能力交给了模型——被 prompt injection 诱导的模型可以隐藏自己的一部分历史，这也是 `allowToolNodes` 与 `allowModelRoleChange` 默认取安全值的原因。本插件不发起任何外部网络请求、没有第三方依赖、不读取凭据。

完整威胁模型与加固清单见 [SECURITY.md](SECURITY.md)。

## 开发

```sh
npm run check   # 对每个 lib/*.js 跑 node --check
npm test        # node --test
```

没有依赖，测试也不需要 DSH 运行时：`lib/core.js` 与 `lib/ops.js` 用一个假的 session 对象即可完整覆盖。CI（`.github/workflows/ci.yml`）在 Node 22 与 24 上跑这两步。

## 说明

- **必须自带 bundle patch。** 在这个 DSH 版本里，`dsh.profile.bundles` 的每一项都必须是声明了 `dsh.bundle.patch` 的包；没有它的 bundle 会被跳过并出现在 `skippedBundles` 里。本包带 `cordis.patch.yml`，负责插入插件行（`id: context-shaping`）。
- **客户端工厂 id。** 浏览器端模块的 id 必须等于包名（`dsh-context-shaping`）；`lib/client.js` 以该 id 注册自身并 `return { inject, apply }`。
- **故意不声明 `peerDependencies`。** DSH 在导入插件前会校验 `peerDependencies` 里 `@deepseek-ai/dsh*` 的版本范围，范围写窄了会把安装卡住。因此本包不声明，只依赖注入进来的宿主服务（`commands`、`tools`、`agents`，以及存在时的 `webServer`）。
- **HMR 与重启。** 安装新 bundle 可能经 HMR 生效；**替换已安装的同名包则需要重启**，新的 JS 模块才会被加载。
- **为什么你自己的消息下面没有编辑按钮。** 这个 DSH 构建只暴露四个 `conversation.chat.*` 插槽：`node`、`commandview`、`turnTail`、`assistant-actions`。AI 那一行会把我们的插槽当作 `extraActions` 渲染，所以按钮正好落在复制图标右边；而用户消息那一行（`UserMessageNodeView`）调用 `MessageIconActions` 时**没有**传 `extraActions`，气泡内也不渲染任何插槽，插件无法在那里加控件。按插槽契约，可点击控件属于输入卡片工具行（`conversation.input.left`），更高的内容属于 `conversation.input.dock`——本插件的「改我的消息」按钮与编辑器就在这两处。要在命令行改写用户消息，仍可用 `/shape edit <seq> <文本>`。
- **headless 组合。** Web 路由是单独注入的（`ctx.inject(["webServer"], …)`），因此没有 web server 时命令与工具照常工作，只是没有按钮与 HTTP API。
- 本插件依赖的 surface 替换缝来自 DeepSeek Harness；实现所参照的提交记录在 [NOTICE](NOTICE) 里。
- 历史改写依赖宿主暴露 `session.surface.nodes`；若将来的 DSH 版本不再暴露，插件会直接报错，而不是靠猜。

## 许可与署名

MIT。

本仓库**不是原创作品**。它延续社区插件 `@wasd258/dsh-context-surgery`（0.1.0–0.1.2，© 2026 WASD258-jpg，MIT），该插件的 GitHub 仓库已不可访问（404）。原作的署名与 MIT 声明完整保留在 [NOTICE](NOTICE) 中，许可证文本同时适用于原作与本延续版本。

由 [zeranhub](https://github.com/zeranhub) 维护。DeepSeek 与 DeepSeek Harness 是其各自所有者的名称；本项目与 DeepSeek 无隶属关系，也未获其背书。
