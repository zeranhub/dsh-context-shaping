/**
 * dsh-context-shaping — DSH 上下文塑形（host half）。
 *
 * 原理：模型可见的历史（LLM 消息列表）由会话日志的「surface」折叠而来
 * （`Session.deriveMessages()` → `buildRequest`）。日志是 append-only 的事实源，
 * 但 surface 支持**位置替换**：append 一个带
 * `surfaceOp: { op: "replace", start, end }` + `sourceEventSeqs`（覆盖全部被影蔽
 * 节点）的新消息事件，即可把当前 surface 的一段连续节点影蔽掉，换成新节点。
 * compaction 的「压缩总结」用的正是这条缝。
 *
 * 因此本插件可以在任意时刻（包括会话早已开始、模型已看过历史之后）改写模型
 * 视角下的历史：剧情扮演 AI 跑偏（OOC）时，把那条回复「改」成没跑偏的版本，
 * 模型下一轮请求看到的就一直是改后的历史——原始文本仍完整保留在事件日志里
 * （append-only）。
 *
 * 0.2.0 新增：
 *   · 改写审计（journal + 日志还原）—— 每次改写都留痕，重启后仍可从日志复原；
 *   · 还原（undo）—— 把被影蔽的内容放回模型视角，单节点精确还原；
 *   · 配置开关（Config）—— 模型工具、HTTP 写接口、工具节点保护、角色改写权限；
 *   · 工具节点保护 —— 默认拒绝对含工具调用的消息做整条重写/删除。
 *
 * 入口：
 *   · /shape 命令（list / show / edit / think / clear-think / rewrite / delete
 *     / replace / history / undo）
 *   · shape_list / shape_edit / shape_delete / shape_replace /
 *     shape_history / shape_restore 工具
 *   · /api/dsh-context-shaping/* —— 客户端「消息改写」按钮走的 HTTP 路由
 *
 * 风险提示（设计使然）：改写立即改变模型可见历史。若被影蔽的区间包含工具调用，
 * 后续轮次引用这些调用的旧记录可能对不上；本插件默认拒绝这类破坏性操作。
 */
import z from "@deepseek-ai/schemastery";
import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import {
	formatJournalEntry,
	normalizePart,
	parseShapeCommand,
	parseSeq,
	preview,
	textAfter
} from "./core.js";
import {
	deleteNode,
	describeNode,
	editNode,
	eventAt,
	eventRole,
	lastUserNode,
	replaceRange,
	restoreNode,
	rewriteRecords,
	rowsOf,
	surfaceNodes,
	undoableCandidates
} from "./ops.js";

export const name = "dsh-context-shaping";

export const inject = ["commands", "tools", "agents"];

/**
 * 插件配置（可在 DSH 设置的插件页里改，也可以在 profile 的配置层里给）。
 * 全部有默认值，缺省行为与 0.1.x 一致（除了工具节点保护，见 allowToolNodes）。
 */
export const Config = z.object({
	exposeTools: z.boolean().default(true).description("把 context_* 工具交给模型；关闭后模型调用一律被拒绝"),
	allowToolNodes: z.boolean().default(false).description("允许整条重写 / 删除 / 整段替换含工具调用的消息（会隐藏工具记录）"),
	allowRoleChange: z.boolean().default(true).description("允许命令与界面把消息改成另一个角色（需 part=all）"),
	allowModelRoleChange: z.boolean().default(false).description("允许模型工具改变消息角色（默认关闭，防止伪造用户发言）"),
	httpEnabled: z.boolean().default(true).description("启用 /api/dsh-context-shaping 路由"),
	httpWrite: z.boolean().default(true).description("允许 HTTP 改写 / 删除 / 还原（关闭后接口只读）"),
	auditSize: z.number().step(1).min(0).default(200).description("每个会话保留的改写记录条数"),
	maxTextLength: z.number().step(1).min(0).default(200000).description("单次改写文本的字符上限")
});

/** 宿主注入的依赖（保持 ops.js 与 DSH 包解耦，便于单测）。 */
const DEPS = { createUserMessage, createAssistantMessage };

/**
 * 目标代理必须是在运行的顶层会话。
 *
 * 子代理一律拒绝：它们的上下文属于父会话的一次委派，改写它没有任何用户可见的
 * 意义，却可能让父会话看到自相矛盾的历史。
 */
function requireRootAgent(ctx, agent) {
	if (agent === undefined) throw new Error("需要调用方是运行中的 agent");
	if (ctx.agents.get(agent.id) !== agent) throw new Error("agent 不在运行中");
	if (!ctx.agents.roots().includes(agent)) throw new Error("只能改写顶层会话的上下文，子代理不可操作");
}

/** 设置页命名空间。 */
const SETTINGS_NS = typeof settingsNamespace === "function"
	? settingsNamespace("context-shaping")
	: "context-shaping";

/** 配置的当前来源；安装了设置段之后由设置服务接管。 */
function makeConfigSource(config) {
	let current = () => config;
	return {
		get: () => current() ?? config,
		setSource: (source) => {
			current = source;
		}
	};
}

/** 当前配置下的保护规则。 */
function guardsOf(cfg) {
	return { allowToolNodes: cfg.allowToolNodes === true };
}

/** 文本长度上限。 */
function assertTextLength(cfg, text) {
	const value = String(text ?? "");
	const max = cfg.maxTextLength;
	if (Number.isSafeInteger(max) && max >= 0 && value.length > max) {
		throw new Error(`文本长度 ${value.length} 超过上限 ${max}（配置项 maxTextLength）`);
	}
	return value;
}

/** 角色改写权限：模型工具默认不允许把消息改成另一个角色。 */
function assertRolePolicy({ session, seq, role, cfg, who }) {
	if (role === undefined) return;
	const original = eventRole(eventAt(session, seq));
	if (original === undefined || role === original) return;
	const allowed = who === "model" ? cfg.allowModelRoleChange === true : cfg.allowRoleChange === true;
	if (!allowed) {
		throw new Error(
			who === "model"
				? "配置不允许模型改变消息角色（allowModelRoleChange=false）"
				: "配置不允许改变消息角色（allowRoleChange=false）"
		);
	}
}

// ── 改写审计（journal）──────────────────────────────────────────────────────
/** agentId → 改写记录（新→旧）。 */
const journals = new Map();
let entryCounter = 0;

function journalFor(agent, limit) {
	let list = journals.get(agent.id);
	if (list === undefined) {
		list = [];
		journals.set(agent.id, list);
	}
	if (Number.isSafeInteger(limit) && limit > 0 && list.length > limit) {
		list.splice(0, list.length - limit);
	}
	return list;
}

function recordEntry(agent, limit, entry) {
	const list = journalFor(agent, limit);
	const full = {
		id: ++entryCounter,
		at: new Date().toISOString().replace("T", " ").slice(0, 19),
		...entry
	};
	list.push(full);
	return full;
}

function entryForReplacement(agent, replacementSeq) {
	return journalFor(agent).find((entry) => entry.replacementSeq === replacementSeq);
}

/**
 * 可还原的改写候选（新→旧）。选择规则在 ops.js（`undoableCandidates`），
 * 这里只负责把该会话的 journal 喂给它。
 */
function undoable(agent, cfg) {
	return undoableCandidates(agent.session, journalFor(agent, cfg.auditSize));
}

/** 还原第 index 近的一次改写（1 = 最近）。 */
function undoRewrite(agent, cfg, source, index = 1) {
	const candidates = undoable(agent, cfg);
	const pick = candidates[index - 1];
	if (pick === undefined) {
		throw new Error(candidates.length === 0 ? "没有可还原的改写" : `只有 ${candidates.length} 个可还原的改写`);
	}
	const result = restoreNode({
		session: agent.session,
		deps: DEPS,
		replacementSeq: pick.replacementSeq,
		shadowedSeqs: pick.shadowedSeqs
	});
	if (pick.entry !== undefined) pick.entry.undone = true;
	recordEntry(agent, cfg.auditSize, {
		source,
		op: "restore",
		shadowedSeqs: [pick.replacementSeq],
		replacementSeq: result.replacementSeq,
		role: result.role,
		lossy: result.lossy,
		before: preview(pick.entry?.after ?? ""),
		after: preview(pick.entry?.before ?? "")
	});
	return { ...result, undoneSeq: pick.replacementSeq, recovered: pick.recovered === true };
}

/** 会改写历史的子命令（只允许顶层会话调用）。 */
const MUTATING_OPS = new Set(["edit", "think", "clear-think", "rewrite", "delete", "replace", "undo", "restore"]);

/** 审计视图：journal 记录 + 从日志复原的记录。 */
function historyView(agent, cfg) {
	const list = journalFor(agent, cfg.auditSize);
	const known = new Set(list.map((entry) => entry.replacementSeq));
	const nodes = new Set(surfaceNodes(agent.session));
	const derived = rewriteRecords(agent.session)
		.filter((record) => !known.has(record.replacementSeq))
		.map((record) => ({
			id: `log:${record.replacementSeq}`,
			at: "-",
			op: "edit",
			source: "recovered",
			shadowedSeqs: record.shadowedSeqs,
			replacementSeq: record.replacementSeq,
			role: record.role,
			preview: record.preview,
			undone: !record.inSurface,
			inSurface: nodes.has(record.replacementSeq)
		}));
	return { journal: list, derived, total: list.length + derived.length };
}

// ── /shape 命令 ───────────────────────────────────────────────────────────
function listText(agent) {
	const rows = rowsOf(agent.session);
	const last = rows.slice(-10);
	const lines = last.map((row) => {
		const badge = row.role === "assistant" ? "AI" : row.role === "tool" ? "TOOL" : "YOU";
		const mark = row.isRewritten ? " *改写" : "";
		return `  [${row.seq}] ${badge} ${preview(row.text)}${mark}`;
	});
	return `模型可见上下文共 ${rows.length} 条（显示最后 ${last.length} 条）：\n${lines.join("\n")}\n\n`
		+ "用法：\n"
		+ "  /shape edit <seq> <新文本>         —— 只改回复正文（保留思考链）\n"
		+ "  /shape think <seq> <新文本>        —— 只改思考链（保留回复正文）\n"
		+ "  /shape clear-think <seq>           —— 移除思考链\n"
		+ "  /shape rewrite <seq> <user|assistant> <新文本> —— 整条重写\n"
		+ "  /shape delete <seq>               —— 删除一条（AI 视角消失）\n"
		+ "  /shape replace <start> <end> <user|assistant> <新文本> —— 整段替换\n"
		+ "  /shape show <seq>                 —— 查看某节点的完整回复与思考链\n"
		+ "  /shape history [n]                —— 改写审计（默认最近 10 条）\n"
		+ "  /shape undo [n]                   —— 还原第 n 近的一次改写（默认最近一次）";
}

function historyText(agent, cfg, limit = 10) {
	const view = historyView(agent, cfg);
	const lines = [];
	const journal = view.journal.slice(-limit).reverse();
	const derived = view.derived.slice(-limit).reverse();
	let index = 0;
	for (const entry of journal) lines.push(formatJournalEntry(entry, ++index));
	for (const entry of derived) lines.push(formatJournalEntry(entry, ++index));
	if (lines.length === 0) return "本会话还没有改写记录。";
	return `改写记录共 ${view.total} 条（显示最近 ${lines.length} 条，* 表示仍在模型可见上下文中）：\n`
		+ `${lines.join("\n")}\n\n`
		+ "用 /shape undo [n] 还原第 n 近的一次改写；原始文本永远保留在事件日志里。";
}

function warningsText(warnings) {
	return Array.isArray(warnings) && warnings.length > 0 ? `\n注意：${warnings.join(" ")}` : "";
}

function registerCommand(ctx, config) {
	const handler = async (invocation) => {
		const agent = invocation.agent;
		const raw = String(invocation.rawInput ?? "").trim();
		try {
			if (agent?.session === undefined) return { kind: "error", text: "没有可用的会话上下文" };
			const cfg = config.get();
			const { op, args } = parseShapeCommand(raw);

			// 只允许顶层会话：子代理的上下文不可改写。
			if (MUTATING_OPS.has(op)) requireRootAgent(ctx, agent);

			if (op === "" || op === "list" || op === "ls" || op === "?") {
				return { kind: "success", text: listText(agent) };
			}

			if (op === "show") {
				if (args.length < 2) return { kind: "error", text: "用法：/shape show <seq>" };
				const node = describeNode(agent.session, parseSeq(args[1]));
				const head = `[${node.seq}] ${node.role} · ${node.type}`
					+ (node.isRewritten ? ` · 改写节点（影蔽 ${node.shadowedSeqs.join(",")}）` : "");
				const parts = [head, `回复：\n${node.reply || "（空）"}`];
				if (node.hasReasoning) parts.push(`思考链：\n${node.reasoning || "（空）"}`);
				if (node.hasToolBlocks) parts.push("（含工具调用块）");
				return { kind: "success", text: parts.join("\n\n") };
			}

			if (op === "edit") {
				if (args.length < 3) return { kind: "error", text: "用法：/shape edit <seq> <新文本>（只改回复正文，保留思考链）" };
				const seq = parseSeq(args[1]);
				const text = assertTextLength(cfg, textAfter(raw, 2));
				const before = preview(describeNode(agent.session, seq).reply);
				const result = editNode({
					session: agent.session,
					deps: DEPS,
					guards: guardsOf(cfg),
					seq,
					text,
					part: "reply"
				});
				recordEntry(agent, cfg.auditSize, {
					source: "command",
					op: "edit",
					shadowedSeqs: [seq],
					replacementSeq: result.replacementSeq,
					role: result.role,
					part: "reply",
					before,
					after: preview(text)
				});
				return { kind: "success", text: `已改写 [${result.shadowedSeq}] 的回复正文（思考链保留）：下一轮模型请求将看到新文本。${warningsText(result.warnings)}` };
			}

			if (op === "think") {
				if (args.length < 3) return { kind: "error", text: "用法：/shape think <seq> <新思考链文本>" };
				const seq = parseSeq(args[1]);
				const text = assertTextLength(cfg, textAfter(raw, 2));
				const result = editNode({
					session: agent.session,
					deps: DEPS,
					guards: guardsOf(cfg),
					seq,
					text,
					part: "thinking"
				});
				recordEntry(agent, cfg.auditSize, {
					source: "command",
					op: "thinking",
					shadowedSeqs: [seq],
					replacementSeq: result.replacementSeq,
					role: result.role,
					part: "thinking",
					after: preview(text)
				});
				return { kind: "success", text: `已改写 [${result.shadowedSeq}] 的思考链（回复正文保留）。` };
			}

			if (op === "clear-think") {
				if (args.length < 2) return { kind: "error", text: "用法：/shape clear-think <seq>" };
				const seq = parseSeq(args[1]);
				const result = editNode({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), seq, text: "", part: "thinking" });
				recordEntry(agent, cfg.auditSize, {
					source: "command",
					op: "clear-think",
					shadowedSeqs: [seq],
					replacementSeq: result.replacementSeq,
					role: result.role,
					part: "thinking"
				});
				return { kind: "success", text: `已移除 [${result.shadowedSeq}] 的思考链。` };
			}

			if (op === "rewrite") {
				if (args.length < 4) return { kind: "error", text: "用法：/shape rewrite <seq> <user|assistant> <新文本>（整条重写）" };
				const seq = parseSeq(args[1]);
				const role = args[2];
				const text = assertTextLength(cfg, textAfter(raw, 3));
				assertRolePolicy({ session: agent.session, seq, role, cfg, who: "human" });
				const before = preview(describeNode(agent.session, seq).reply);
				const result = editNode({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), seq, role, text, part: "all" });
				recordEntry(agent, cfg.auditSize, {
					source: "command",
					op: "rewrite",
					shadowedSeqs: [seq],
					replacementSeq: result.replacementSeq,
					role: result.role,
					part: "all",
					before,
					after: preview(text)
				});
				return { kind: "success", text: `已整条重写 [${result.shadowedSeq}] 为 ${result.role} 消息：下一轮模型请求将看到新文本。${warningsText(result.warnings)}` };
			}

			if (op === "delete") {
				if (args.length < 2) return { kind: "error", text: "用法：/shape delete <seq>" };
				const seq = parseSeq(args[1]);
				const before = preview(describeNode(agent.session, seq).reply);
				const result = deleteNode({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), seq });
				recordEntry(agent, cfg.auditSize, {
					source: "command",
					op: "delete",
					shadowedSeqs: [seq],
					replacementSeq: result.replacementSeq,
					role: eventRole(eventAt(agent.session, seq)),
					before
				});
				return { kind: "success", text: `已删除 [${result.shadowedSeq}]（${result.shadowedType ?? "?"}）：从模型视角消失。用 /shape undo 可还原。` };
			}

			if (op === "replace") {
				if (args.length < 5) return { kind: "error", text: "用法：/shape replace <start> <end> <user|assistant> <新文本>" };
				const start = parseSeq(args[1], "start");
				const end = parseSeq(args[2], "end");
				const role = args[3];
				const text = assertTextLength(cfg, textAfter(raw, 4));
				const result = replaceRange({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), start, end, role, text });
				recordEntry(agent, cfg.auditSize, {
					source: "command",
					op: "replace",
					shadowedSeqs: result.shadowedSeqs,
					replacementSeq: result.replacementSeq,
					role: result.role,
					after: preview(text)
				});
				return { kind: "success", text: `已整段替换 [${result.shadowedSeqs.join(",")}] 为一条 ${result.role} 消息。${warningsText(result.warnings)}` };
			}

			if (op === "history" || op === "log") {
				const limit = args.length >= 2 ? parseSeq(args[1], "n") : 10;
				return { kind: "success", text: historyText(agent, cfg, Math.max(1, Math.min(50, limit))) };
			}

			if (op === "undo" || op === "restore") {
				const index = args.length >= 2 ? parseSeq(args[1], "n") : 1;
				const result = undoRewrite(agent, cfg, "command", Math.max(1, index));
				const note = result.lossy ? "（整段替换只能合并还原，分段不再是独立消息）" : "";
				return {
					kind: "success",
					text: `已还原 [${result.undoneSeq}] 的影蔽内容（${result.mode === "exact" ? "逐字还原" : "合并还原"}）${note}`
						+ `${result.recovered ? "（记录来自日志复原）" : ""}。`
				};
			}

			return { kind: "error", text: `未知子命令：${op}\n/shape 查看用法` };
		} catch (error) {
			return { kind: "error", text: `操作失败：${String((error && error.message) || error)}` };
		}
	};
	ctx.effect(function* () {
		yield ctx.commands.register({
			name: "shape",
			description: "查看 / 改写 / 还原当前会话的模型可见历史（上下文塑形）",
			handler
		});
	}, "dsh-context-shaping: /shape command");
}

// ── 工具 ────────────────────────────────────────────────────────────────────
const TOOL_OUTPUT = {
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			ok: { type: "boolean", required: true },
			error: { type: "string" },
			replacementSeq: { type: "integer" },
			shadowedSeq: { type: "integer" },
			shadowedSeqs: { type: "array", items: { type: "integer" } },
			restoredSeqs: { type: "array", items: { type: "integer" } },
			shadowedType: { type: "string" },
			undoneSeq: { type: "integer" },
			mode: { type: "string" },
			lossy: { type: "boolean" },
			deleted: { type: "boolean" },
			recovered: { type: "boolean" },
			role: { type: "string" },
			part: { type: "string" },
			text: { type: "string" },
			total: { type: "integer" },
			warnings: { type: "array", items: { type: "string" } },
			rows: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						seq: { type: "integer", required: true },
						type: { type: "string", required: true },
						role: { type: "string", required: true },
						text: { type: "string", required: true },
						isRewritten: { type: "boolean" }
					}
				}
			},
			entries: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						id: { type: "string", required: true },
						at: { type: "string", required: true },
						op: { type: "string", required: true },
						source: { type: "string", required: true },
						replacementSeq: { type: "integer", required: true },
						shadowedSeqs: { type: "array", items: { type: "integer" }, required: true },
						role: { type: "string" },
						lossy: { type: "boolean" },
						undone: { type: "boolean" },
						inSurface: { type: "boolean" },
						preview: { type: "string" }
					}
				}
			}
		}
	},
	render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
};

const TOOL_DESCRIPTION_PREFIX = "INTERACTIVE BEHAVIOR SHAPING — rewrites the model-visible conversation history of the CURRENT session by shadowing existing surface nodes with a replacement message (the same mechanism compaction summaries use; the durable append-only log keeps the original text). The model's NEXT request will read the shaped history as if it had always been that way — use it to steer how the conversation continues, to retcon a scene, or to fix wording at the user's explicit request. Every rewrite is recorded in an audit trail (shape_history) and can be undone (shape_restore). ";

/** 模型工具的统一入口：配置检查 + 错误折叠。 */
function toolCall(cfg, run) {
	try {
		if (cfg.exposeTools === false) {
			return { ok: false, error: "context_* 工具已被配置关闭（exposeTools=false）" };
		}
		return run();
	} catch (error) {
		return { ok: false, error: String((error && error.message) || error) };
	}
}

function registerTools(ctx, config) {
	ctx.tools.register(defineTool({
		name: "shape_list",
		description: "List the current model-visible conversation history of this session: every surface node in order with its seq, role (user/assistant/tool), text preview, and whether the node is itself a rewrite. Seq numbers feed shape_edit / shape_delete / shape_replace / shape_restore.",
		parameters: {
			limit: { type: "integer", description: "Optional: only the last N rows." }
		},
		output: TOOL_OUTPUT,
		presentCall: () => ({ card: "generic", title: "查看上下文历史", kind: "read" }),
		execute: (args, exec) => toolCall(config.get(), () => {
			const agent = exec.agent;
			if (agent === undefined) return { ok: false, error: "shape_list 需要调用方是运行中的 agent" };
			const rows = rowsOf(agent.session);
			const limited = args.limit === undefined ? rows : rows.slice(-args.limit);
			return { ok: true, rows: limited };
		})
	}));

	ctx.tools.register(defineTool({
		name: "shape_edit",
		description: TOOL_DESCRIPTION_PREFIX + "Rewrite ONE message node (by its seq from shape_list). part=reply (default) rewrites only the visible reply text and KEEPS the reasoning chain and tool calls; part=thinking rewrites only the reasoning chain (empty text removes it); part=all rewrites the whole message as plain text. Changing the role is only possible with part=all, and is refused unless the host allows it.",
		parameters: {
			seq: { type: "integer", required: true, description: "Seq of the surface node to rewrite (from shape_list)." },
			text: { type: "string", required: true, description: "The new text for the selected part." },
			role: { type: "string", enum: ["user", "assistant"], description: "Optional explicit role (only honored with part=all)." },
			part: { type: "string", enum: ["reply", "thinking", "all"], description: "Which part to rewrite. Defaults to reply." }
		},
		output: TOOL_OUTPUT,
		presentCall: (args) => ({ card: "generic", title: "改写上下文", kind: "other", rawInput: `[${args.seq}] ${args.part ?? "reply"}: ${String(args.text).slice(0, 60)}` }),
		execute: (args, exec) => toolCall(config.get(), () => {
			const cfg = config.get();
			const agent = exec.agent;
			if (agent === undefined) return { ok: false, error: "shape_edit 需要调用方是运行中的 agent" };
			requireRootAgent(ctx, agent);
			const part = normalizePart(args.part);
			assertRolePolicy({ session: agent.session, seq: args.seq, role: args.role, cfg, who: "model" });
			const text = assertTextLength(cfg, args.text);
			const before = preview(describeNode(agent.session, args.seq).reply);
			const result = editNode({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), seq: args.seq, role: args.role, text, part });
			recordEntry(agent, cfg.auditSize, {
				source: "tool",
				op: part === "reply" ? "edit" : part === "thinking" ? "thinking" : "rewrite",
				shadowedSeqs: [args.seq],
				replacementSeq: result.replacementSeq,
				role: result.role,
				part,
				before,
				after: preview(text)
			});
			return result;
		})
	}));

	ctx.tools.register(defineTool({
		name: "shape_delete",
		description: TOOL_DESCRIPTION_PREFIX + "Delete ONE message node from the model-visible history (by seq from shape_list): the node is shadowed by an empty assistant message, so it produces no message in the model's view. Refused for nodes carrying tool calls unless the host allows it. The original text remains in the durable log and shape_restore can bring it back.",
		parameters: {
			seq: { type: "integer", required: true, description: "Seq of the surface node to delete (from shape_list)." }
		},
		output: TOOL_OUTPUT,
		presentCall: (args) => ({ card: "generic", title: "删除上下文", kind: "other", rawInput: `[${args.seq}]` }),
		execute: (args, exec) => toolCall(config.get(), () => {
			const cfg = config.get();
			const agent = exec.agent;
			if (agent === undefined) return { ok: false, error: "shape_delete 需要调用方是运行中的 agent" };
			requireRootAgent(ctx, agent);
			const before = preview(describeNode(agent.session, args.seq).reply);
			const result = deleteNode({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), seq: args.seq });
			recordEntry(agent, cfg.auditSize, {
				source: "tool",
				op: "delete",
				shadowedSeqs: [args.seq],
				replacementSeq: result.replacementSeq,
				role: eventRole(eventAt(agent.session, args.seq)),
				before
			});
			return result;
		})
	}));

	ctx.tools.register(defineTool({
		name: "shape_replace",
		description: TOOL_DESCRIPTION_PREFIX + "Replace a CONTIGUOUS RANGE of surface nodes (start..end seqs from shape_list, both inclusive, in current model-visible order) with ONE new message of the given role. Use for rewriting a whole exchange. A range containing tool nodes is refused unless the host allows it.",
		parameters: {
			start: { type: "integer", required: true, description: "First seq of the range (must be a current surface node)." },
			end: { type: "integer", required: true, description: "Last seq of the range (must be a current surface node, not before start)." },
			role: { type: "string", required: true, enum: ["user", "assistant"], description: "Role of the single replacement message." },
			text: { type: "string", required: true, description: "The new message text." }
		},
		output: TOOL_OUTPUT,
		presentCall: (args) => ({ card: "generic", title: "整段替换上下文", kind: "other", rawInput: `[${args.start}..${args.end}] ${String(args.text).slice(0, 60)}` }),
		execute: (args, exec) => toolCall(config.get(), () => {
			const cfg = config.get();
			const agent = exec.agent;
			if (agent === undefined) return { ok: false, error: "shape_replace 需要调用方是运行中的 agent" };
			requireRootAgent(ctx, agent);
			const text = assertTextLength(cfg, args.text);
			const result = replaceRange({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), start: args.start, end: args.end, role: args.role, text });
			recordEntry(agent, cfg.auditSize, {
				source: "tool",
				op: "replace",
				shadowedSeqs: result.shadowedSeqs,
				replacementSeq: result.replacementSeq,
				role: result.role,
				after: preview(text)
			});
			return result;
		})
	}));

	ctx.tools.register(defineTool({
		name: "shape_history",
		description: "Read the rewrite audit trail of the CURRENT session: every shaping rewrite (who did it, which nodes were shadowed, what the replacement node is) plus rewrites recovered from the durable log. Read-only; use it before claiming what the conversation history contains.",
		parameters: {
			limit: { type: "integer", description: "Optional: only the last N entries." }
		},
		output: TOOL_OUTPUT,
		presentCall: () => ({ card: "generic", title: "查看改写审计", kind: "read" }),
		execute: (args, exec) => toolCall(config.get(), () => {
			const cfg = config.get();
			const agent = exec.agent;
			if (agent === undefined) return { ok: false, error: "shape_history 需要调用方是运行中的 agent" };
			const view = historyView(agent, cfg);
			const all = [...view.journal, ...view.derived];
			const kept = args.limit === undefined ? all : all.slice(-args.limit);
			return {
				ok: true,
				total: view.total,
				entries: kept.map((entry) => ({
					id: String(entry.id),
					at: entry.at ?? "-",
					op: entry.op,
					source: entry.source,
					replacementSeq: entry.replacementSeq,
					shadowedSeqs: entry.shadowedSeqs,
					...(entry.role === undefined ? {} : { role: entry.role }),
					...(entry.lossy === undefined ? {} : { lossy: entry.lossy }),
					undone: entry.undone === true,
					inSurface: entry.inSurface !== false,
					preview: entry.preview ?? entry.after ?? ""
				}))
			};
		})
	}));

	ctx.tools.register(defineTool({
		name: "shape_restore",
		description: "Undo a shaping rewrite: replace the rewrite node (its seq, or from shape_history) with the content it shadowed, so the original text returns to the model-visible history. Exact for single-message rewrites; a range replacement can only be restored merged into one message. Also accepts the index of the rewrite to undo (1 = most recent).",
		parameters: {
			seq: { type: "integer", description: "Seq of the rewrite node to restore (from shape_list: rows marked isRewritten)." },
			index: { type: "integer", description: "Alternative: undo the Nth most recent rewrite (1 = most recent)." }
		},
		output: TOOL_OUTPUT,
		presentCall: (args) => ({ card: "generic", title: "还原改写", kind: "other", rawInput: args.seq === undefined ? `undo #${args.index ?? 1}` : `[${args.seq}]` }),
		execute: (args, exec) => toolCall(config.get(), () => {
			const cfg = config.get();
			const agent = exec.agent;
			if (agent === undefined) return { ok: false, error: "shape_restore 需要调用方是运行中的 agent" };
			requireRootAgent(ctx, agent);
			if (args.seq === undefined) return undoRewrite(agent, cfg, "tool", Math.max(1, args.index ?? 1));
			const node = describeNode(agent.session, args.seq);
			if (!node.isRewritten) return { ok: false, error: `seq ${args.seq} 不是改写节点，无法还原` };
			const result = restoreNode({ session: agent.session, deps: DEPS, replacementSeq: args.seq, shadowedSeqs: node.shadowedSeqs });
			recordEntry(agent, cfg.auditSize, {
				source: "tool",
				op: "restore",
				shadowedSeqs: [args.seq],
				replacementSeq: result.replacementSeq,
				role: result.role,
				lossy: result.lossy
			});
			return result;
		})
	}));
}

// ── HTTP 路由（客户端按钮）─────────────────────────────────────────────────
const json = (res, status, data) => {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store"
	});
	res.end(JSON.stringify(data));
};

const readBody = (req) =>
	new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
			if (data.length > 262144) {
				reject(new Error("body too large"));
				req.destroy();
			}
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOSTNAMES = /^(127\.0\.0\.1|localhost|\[::1\])$/;

function isLoopbackRequest(req) {
	const remote = String((req.socket && req.socket.remoteAddress) || "");
	return LOOPBACK_ADDRESSES.has(remote) || LOOPBACK_ADDRESSES.has(remote.replace(/^::ffff:/, ""));
}

/**
 * Host 头必须是回环主机名 + 当前端口（DNS rebinding 防护，GET/POST 一视同仁）。
 * 0.2.0 起要求 Host 必须存在：真实 HTTP/1.1 客户端都会发送它，缺省视为可疑。
 */
function isAllowedHost(req, currentPort) {
	const host = String(req.headers.host || "");
	if (host === "") return false;
	try {
		const parsed = new URL("http://" + host);
		return (
			LOOPBACK_HOSTNAMES.test(parsed.hostname) &&
			(parsed.port === "" || parsed.port === String(currentPort))
		);
	} catch {
		return false;
	}
}

function isAllowedOrigin(req, currentPort) {
	const origin = req.headers.origin;
	if (!origin) return true;
	try {
		const parsed = new URL(origin);
		return (
			LOOPBACK_HOSTNAMES.test(parsed.hostname) &&
			(parsed.port === "" || parsed.port === String(currentPort))
		);
	} catch {
		return false;
	}
}

/** 按 seq / messageId 定位 surface 节点。 */
function resolveSeq(agent, value) {
	const seq = Number(value);
	if (Number.isSafeInteger(seq)) return seq;
	const messageId = String(value ?? "");
	const nodes = surfaceNodes(agent.session);
	for (const node of nodes) {
		const event = eventAt(agent.session, node);
		if (event?.type === "assistant/message" && event.data?.message?.id === messageId) return node;
		if (event?.type === "user/message" && event.data?.id === messageId) return node;
	}
	throw new Error(`seq/消息 id 无效或不在当前模型可见上下文：${messageId}`);
}

function applyRoutes(ctx, config) {
	const webServer = ctx.webServer;
	if (!webServer) return;
	const dispose = webServer.register({
		kind: "prefix",
		path: "/api/dsh-context-shaping",
		handler: async (req, res) => {
			try {
				const cfg = config.get();
				const url = new URL(req.url, "http://127.0.0.1");
				const route = url.pathname.slice("/api/dsh-context-shaping".length);

				// 隐私边界：只服务本机回环连接；Host 校验封 DNS rebinding（GET 含思考链等敏感数据）。
				if (!isLoopbackRequest(req)) {
					json(res, 403, { ok: false, error: "context-shaping API is loopback-only" });
					return;
				}
				if (!isAllowedHost(req, webServer.port)) {
					json(res, 403, { ok: false, error: "invalid host header" });
					return;
				}
				if (cfg.httpEnabled === false) {
					json(res, 403, { ok: false, error: "context-shaping API disabled (httpEnabled=false)" });
					return;
				}

				const isWrite = req.method === "POST";
				if (isWrite && cfg.httpWrite === false) {
					json(res, 403, { ok: false, error: "context-shaping API is read-only (httpWrite=false)" });
					return;
				}

				const agentOf = (sessionId) => (sessionId ? ctx.agents.get(sessionId) : undefined);

				if (req.method === "GET" && (route === "/list" || route === "/")) {
					const sessionId = url.searchParams.get("sessionId") || "";
					const agent = agentOf(sessionId);
					if (!agent) {
						json(res, 404, { ok: false, error: `会话 ${sessionId} 不在运行中` });
						return;
					}
					const limitRaw = Number(url.searchParams.get("limit") ?? "0");
					const limit = Number.isSafeInteger(limitRaw) && limitRaw > 0 ? limitRaw : 0;
					const rows = rowsOf(agent.session);
					json(res, 200, {
						ok: true,
						sessionId,
						total: rows.length,
						rows: limit > 0 ? rows.slice(-limit) : rows
					});
					return;
				}

				if (req.method === "GET" && route === "/message") {
					const sessionId = url.searchParams.get("sessionId") || "";
					const messageId = url.searchParams.get("messageId") || "";
					const agent = agentOf(sessionId);
					if (!agent) {
						json(res, 404, { ok: false, error: `会话 ${sessionId} 不在运行中` });
						return;
					}
					let seq;
					try {
						seq = resolveSeq(agent, messageId);
					} catch (error) {
						json(res, 404, { ok: false, error: String((error && error.message) || error) });
						return;
					}
					const node = describeNode(agent.session, seq);
					json(res, 200, { ok: true, sessionId, messageId, ...node });
					return;
				}

				if (req.method === "GET" && route === "/last-user") {
					const sessionId = url.searchParams.get("sessionId") || "";
					const agent = agentOf(sessionId);
					if (!agent) {
						json(res, 404, { ok: false, error: `会话 ${sessionId} 不在运行中` });
						return;
					}
					const node = lastUserNode(agent.session);
					json(res, 200, {
						ok: true,
						sessionId,
						found: node !== undefined,
						...(node ?? {})
					});
					return;
				}

				if (req.method === "GET" && route === "/history") {
					const sessionId = url.searchParams.get("sessionId") || "";
					const agent = agentOf(sessionId);
					if (!agent) {
						json(res, 404, { ok: false, error: `会话 ${sessionId} 不在运行中` });
						return;
					}
					const view = historyView(agent, cfg);
					json(res, 200, {
						ok: true,
						sessionId,
						total: view.total,
						journal: view.journal,
						derived: view.derived
					});
					return;
				}

				if (req.method === "POST" && (route === "/edit" || route === "/delete" || route === "/replace" || route === "/restore")) {
					if (!isAllowedOrigin(req, webServer.port)) {
						json(res, 403, { ok: false, error: "cross-origin request rejected" });
						return;
					}
					const contentType = String(req.headers["content-type"] || "").toLowerCase();
					if (!contentType.startsWith("application/json")) {
						json(res, 415, { ok: false, error: "Content-Type 必须是 application/json" });
						return;
					}
					let body = {};
					try {
						body = JSON.parse((await readBody(req)) || "{}");
					} catch {
						json(res, 400, { ok: false, error: "请求体不是有效 JSON" });
						return;
					}
					const sessionId = String(body.sessionId || "");
					const agent = agentOf(sessionId);
					if (!agent) {
						json(res, 404, { ok: false, error: `会话 ${sessionId} 不在运行中` });
						return;
					}
					try {
						requireRootAgent(ctx, agent);
						if (route === "/edit") {
							const seq = resolveSeq(agent, body.seq ?? body.messageId);
							const part = normalizePart(body.part);
							assertRolePolicy({ session: agent.session, seq, role: body.role, cfg, who: "human" });
							const text = assertTextLength(cfg, String(body.text ?? ""));
							const before = preview(describeNode(agent.session, seq).reply);
							const result = editNode({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), seq, role: body.role, text, part });
							recordEntry(agent, cfg.auditSize, {
								source: "http",
								op: part === "reply" ? "edit" : part === "thinking" ? "thinking" : "rewrite",
								shadowedSeqs: [seq],
								replacementSeq: result.replacementSeq,
								role: result.role,
								part,
								before,
								after: preview(text)
							});
							json(res, 200, result);
							return;
						}
						if (route === "/delete") {
							const seq = resolveSeq(agent, body.seq ?? body.messageId);
							const before = preview(describeNode(agent.session, seq).reply);
							const result = deleteNode({ session: agent.session, deps: DEPS, guards: guardsOf(cfg), seq });
							recordEntry(agent, cfg.auditSize, {
								source: "http",
								op: "delete",
								shadowedSeqs: [seq],
								replacementSeq: result.replacementSeq,
								role: eventRole(eventAt(agent.session, seq)),
								before
							});
							json(res, 200, result);
							return;
						}
						if (route === "/restore") {
							const seq = resolveSeq(agent, body.seq ?? body.messageId);
							const node = describeNode(agent.session, seq);
							if (!node.isRewritten) throw new Error(`seq ${seq} 不是改写节点，无法还原`);
							const result = restoreNode({
								session: agent.session,
								deps: DEPS,
								replacementSeq: seq,
								shadowedSeqs: node.shadowedSeqs
							});
							recordEntry(agent, cfg.auditSize, {
								source: "http",
								op: "restore",
								shadowedSeqs: [seq],
								replacementSeq: result.replacementSeq,
								role: result.role,
								lossy: result.lossy
							});
							json(res, 200, result);
							return;
						}
						const text = assertTextLength(cfg, String(body.text ?? ""));
						const result = replaceRange({
							session: agent.session,
							deps: DEPS,
							guards: guardsOf(cfg),
							start: Number(body.start),
							end: Number(body.end),
							role: body.role,
							text
						});
						recordEntry(agent, cfg.auditSize, {
							source: "http",
							op: "replace",
							shadowedSeqs: result.shadowedSeqs,
							replacementSeq: result.replacementSeq,
							role: result.role,
							after: preview(text)
						});
						json(res, 200, result);
						return;
					} catch (error) {
						json(res, 200, { ok: false, error: String((error && error.message) || error) });
						return;
					}
				}

				json(res, 404, { ok: false, error: "unknown route: " + route });
			} catch (error) {
				json(res, 500, { ok: false, error: String((error && error.message) || error) });
			}
		}
	});
	ctx.effect(() => dispose, "dsh-context-shaping: routes");
}

// ── 入口 ────────────────────────────────────────────────────────────────────
export function apply(ctx, config = {}) {
	const source = makeConfigSource(config);
	registerCommand(ctx, source);
	registerTools(ctx, source);
	// 路由单独注入：没有 webServer 服务时（headless 组合）命令与工具照常工作。
	if (typeof ctx.inject === "function") {
		ctx.inject(["webServer"], (sctx) => applyRoutes(sctx, source));
	} else {
		applyRoutes(ctx, source);
	}

	// 设置页里的插件配置（没有设置服务时 installSettingsSection 是空操作）。
	if (typeof installSettingsSection === "function") {
		try {
			installSettingsSection(ctx, SETTINGS_NS, Config, config ?? {}, {
				setSource: (next) => source.setSource(next),
				onChange: () => {}
			});
		} catch {
			// 设置服务不可用时保持组合配置，不影响插件功能。
		}
	}
}
