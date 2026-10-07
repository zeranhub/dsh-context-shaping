/**
 * dsh-context-surgery — 会话层操作（ops）。
 *
 * 这里只依赖 `core.js` 与调用方注入的 `deps`（`createUserMessage` /
 * `createAssistantMessage`），**不 import 任何 DSH 包**，因此可以用一个假的
 * session 对象在 `node --test` 下完整覆盖：改写、删除、整段替换、还原、审计。
 *
 * 会话模型（由宿主提供）：
 *   session.surface.nodes  —— 当前模型可见节点的 seq 顺序数组
 *   session.events         —— 事件日志（按 seq 可直接索引，允许存在偏移）
 *   session.append(type, data, { surfaceOp, sourceEventSeqs }) —— 追加事件，返回新事件
 */
import {
	blockText,
	contentBlocks,
	hasToolBlocks,
	messageText,
	normalizePart,
	normalizeRole,
	preview,
	transformBlocks
} from "./core.js";

/** 能在 surface 上出现的三种事件类型。 */
const SURFACE_TYPES = new Set(["user/message", "assistant/message", "tool/result"]);

// ── 会话读取 ────────────────────────────────────────────────────────────────
/** 当前 surface 的节点 seq 数组。 */
export function surfaceNodes(session) {
	const nodes = session?.surface?.nodes;
	if (!Array.isArray(nodes)) {
		throw new Error("当前 DSH 版本未暴露 session.surface.nodes，dsh-context-surgery 无法工作");
	}
	return nodes;
}

/** 按 seq 取事件（容忍 events 数组存在 baseSeq 偏移或空洞）。 */
export function eventAt(session, seq) {
	const events = session?.events;
	if (!Array.isArray(events)) return undefined;
	const direct = events[seq];
	if (direct !== undefined && direct.seq === seq) return direct;
	return events.find((event) => event?.seq === seq);
}

/** 节点在 surface 中的下标，不在 surface 上则抛错。 */
export function surfaceIndex(session, seq) {
	const index = surfaceNodes(session).indexOf(seq);
	if (index === -1) {
		throw new Error(`seq ${seq} 不在当前模型可见上下文（可能已被替换或影蔽）`);
	}
	return index;
}

/** 事件投影出的消息对象。 */
export function eventMessage(event) {
	switch (event?.type) {
		case "user/message": return event.data;
		case "assistant/message": return event.data?.message;
		case "tool/result": return event.data?.message;
		default: return undefined;
	}
}

/** 事件在模型视角下的角色。 */
export function eventRole(event) {
	switch (event?.type) {
		case "user/message": return "user";
		case "assistant/message": return "assistant";
		case "tool/result": return "tool";
		default: return undefined;
	}
}

/** 事件是否是一次 surface 位置替换（而非 append）。 */
export function isReplacement(event) {
	const op = event?.surfaceOp;
	return typeof op === "object" && op !== null && op.op === "replace";
}

/** 事件所影蔽的 seq 列表。 */
export function shadowedSeqsOf(event) {
	const seqs = event?.sourceEventSeqs;
	return Array.isArray(seqs) ? seqs.filter((seq) => Number.isSafeInteger(seq)) : [];
}

/**
 * 当前 surface 的全部节点行（模型可见顺序）。
 * @param session - 会话。
 * @returns `{ seq, type, role, text, messageId?, isRewritten, shadowedSeqs }` 数组。
 */
export function rowsOf(session) {
	const rows = [];
	for (const seq of surfaceNodes(session)) {
		const event = eventAt(session, seq);
		if (!event) continue;
		const role = eventRole(event);
		if (role === undefined) continue;
		const message = eventMessage(event);
		const messageId = event.type === "assistant/message" ? event.data?.message?.id : event.data?.id;
		rows.push({
			seq,
			type: event.type,
			role,
			text: messageText(message),
			...messageId === undefined ? {} : { messageId },
			isRewritten: isReplacement(event),
			...isReplacement(event) ? { shadowedSeqs: shadowedSeqsOf(event) } : {}
		});
	}
	return rows;
}

/** 单节点的详细信息（`/message` 与 `/context show` 用）。 */
export function describeNode(session, seq) {
	const event = eventAt(session, seq);
	if (!event) throw new Error(`seq ${seq} 不存在于事件日志`);
	const message = eventMessage(event);
	const role = eventRole(event);
	return {
		seq,
		type: event.type,
		role,
		reply: blockText(message, "text"),
		reasoning: blockText(message, "reasoning"),
		hasReasoning: contentBlocks(message?.content).some((block) => block?.type === "reasoning"),
		hasToolBlocks: hasToolBlocks(message?.content),
		isRewritten: isReplacement(event),
		shadowedSeqs: shadowedSeqsOf(event),
		shadowedPreviews: shadowedSeqsOf(event).map((shadowed) => ({
			seq: shadowed,
			preview: preview(messageText(eventMessage(eventAt(session, shadowed))), 160)
		}))
	};
}

/**
 * 从事件日志还原改写记录（进程重启后仍可用的审计来源）。
 *
 * 只统计三种 surface 事件上的 replace：compaction 之类的总结事件不属于这三类，
 * 因此不会被误算成本插件的改写。
 * @param session - 会话。
 * @returns 记录数组（按日志顺序）。
 */
export function rewriteRecords(session) {
	const events = Array.isArray(session?.events) ? session.events : [];
	const nodes = new Set(surfaceNodes(session));
	const records = [];
	for (const event of events) {
		if (!event || !SURFACE_TYPES.has(event.type) || !isReplacement(event)) continue;
		records.push({
			replacementSeq: event.seq,
			type: event.type,
			role: eventRole(event),
			shadowedSeqs: shadowedSeqsOf(event),
			inSurface: nodes.has(event.seq),
			preview: preview(messageText(eventMessage(event)), 120)
		});
	}
	return records;
}

// ── 保护规则 ────────────────────────────────────────────────────────────────
/**
 * 目标节点是否允许被“破坏性”改写（part=all / delete / replace）。
 *
 * 含工具调用的消息被整条抹掉后，它的 `tool/result` 可能仍留在 surface 上，
 * 下一轮请求就会出现“没有对应调用的工具结果”。默认拒绝，可用配置放开。
 */
export function assertTargetAllowed(event, options = {}) {
	const { op = "edit", part = "reply", allowToolNodes = false, seq } = options;
	if (!event) throw new Error(`seq ${seq} 不在当前模型可见上下文（可能已被替换或影蔽）`);
	if (event.type === "tool/result") {
		throw new Error("工具结果节点不能改写；请改用户消息或 AI 回复");
	}
	if (!SURFACE_TYPES.has(event.type)) {
		throw new Error(`事件类型 ${event.type} 不是模型可见的消息节点`);
	}
	const destructive = op === "delete" || op === "replace" || part === "all";
	if (destructive && !allowToolNodes && hasToolBlocks(eventMessage(event)?.content)) {
		throw new Error(
			"这条消息包含工具调用：整条重写或删除会把它从模型视角抹掉，而对应的工具结果可能仍在上下文里。"
			+ "确认要这样做，请打开 allowToolNodes 配置。"
		);
	}
}

/** 非破坏性改写工具节点时的提示。 */
function toolWarning(event, part) {
	if (part === "all") return [];
	if (!hasToolBlocks(eventMessage(event)?.content)) return [];
	return ["该消息含工具调用：工具调用与工具结果块保持不变。"];
}

// ── 构造替换消息 ────────────────────────────────────────────────────────────
function buildUser(content, deps) {
	return { type: "user/message", data: deps.createUserMessage({ content, source: { kind: "user" } }) };
}

function buildAssistant(content, source, deps) {
	return {
		type: "assistant/message",
		data: { message: deps.createAssistantMessage({ content, source }) }
	};
}

/** 整条替换为纯文本消息。 */
export function buildPlainReplacement(role, text, deps) {
	const content = text === "" ? [] : [{ type: "text", text: String(text) }];
	if (role === "user") return buildUser(content, deps);
	return buildAssistant(content, { kind: "model" }, deps);
}

/**
 * 依据原事件构造 part 级替换消息。
 *
 * 角色变更只在 `part=all` 时允许：part=reply/thinking 会保留工具调用等块，
 * 把 assistant 的块搬进 user 消息不是合法消息形状。
 */
export function buildEditReplacement(event, { part, role, text }, deps) {
	const message = eventMessage(event);
	const originalRole = eventRole(event);
	const targetRole = role ?? originalRole;
	if (targetRole !== "user" && targetRole !== "assistant") {
		throw new Error(`role 必须是 user 或 assistant（收到 ${String(targetRole)}）`);
	}
	if (originalRole === "user" && part === "thinking") {
		throw new Error("用户消息没有思考链，只能用 reply 或 all");
	}
	if (role !== undefined && role !== originalRole && part !== "all") {
		throw new Error("改变角色必须用 part=all（整条重写），否则会把工具调用等块搬进另一角色");
	}
	const content = transformBlocks(message?.content, part, String(text ?? ""));
	if (targetRole === "user") return buildUser(content, deps);
	const source = message?.source && typeof message.source === "object"
		? { kind: "model", ...message.source }
		: { kind: "model" };
	return buildAssistant(content, source, deps);
}

/**
 * 删除节点的替换事件：**空内容的 assistant 消息**。
 *
 * 这不是随意选择：宿主投影规则里只有「空 content 的 assistant/message」会被
 * 丢掉（`deriveEventMessage` 返回 null），空内容的 user/message 仍会投影成一条
 * 空用户消息进入请求。因此删除必须换角色成 assistant，才能真正从模型视角消失。
 */
export function buildDeleteReplacement(deps) {
	return buildAssistant([], { kind: "model" }, deps);
}

/**
 * 还原被影蔽的原节点。
 * @param originals - 被影蔽的事件数组（按原顺序）。
 * @param options - `{ role, deps }`；`role` 仅用于合并还原。
 * @returns `{ replacement, mode, lossy, role }`。
 */
export function buildRestoreReplacement(originals, { role, deps }) {
	if (originals.length === 0) throw new Error("没有可还原的原始节点");
	if (originals.some((event) => event === undefined)) {
		throw new Error("原始节点已不在事件日志中，无法还原");
	}
	if (originals.some((event) => event.type === "tool/result")) {
		throw new Error("工具结果节点不能通过追加事件还原（它必须落在开启的 step 内）");
	}
	if (originals.length === 1) {
		const original = originals[0];
		const message = eventMessage(original);
		const content = contentBlocks(message?.content).map((block) => ({ ...block }));
		if (original.type === "user/message") {
			return { replacement: buildUser(content, deps), mode: "exact", lossy: false, role: "user" };
		}
		const source = message?.source && typeof message.source === "object"
			? { kind: "model", ...message.source }
			: { kind: "model" };
		return { replacement: buildAssistant(content, source, deps), mode: "exact", lossy: false, role: "assistant" };
	}
	// 整段替换只留下一个 surface 节点，而 surface 替换是「一段换一条」，
	// 因此多节点还原只能合并成一条消息：内容不丢，但分段不再是独立消息。
	const targetRole = role ?? eventRole(originals[0]) ?? "assistant";
	const merged = originals
		.map((event) => `[${event.seq} ${eventRole(event)}] ${messageText(eventMessage(event))}`)
		.join("\n\n---\n\n");
	return {
		replacement: buildPlainReplacement(targetRole, merged, deps),
		mode: "merged",
		lossy: true,
		role: targetRole
	};
}

// ── 追加替换 ────────────────────────────────────────────────────────────────
function appendReplace(session, replacement, { start, end, shadowedSeqs }) {
	return session.append(replacement.type, replacement.data, {
		surfaceOp: { op: "replace", start, end },
		sourceEventSeqs: shadowedSeqs
	});
}

// ── 操作 ────────────────────────────────────────────────────────────────────
/**
 * 单条改写。
 * @returns `{ ok, replacementSeq, shadowedSeq, role, part, text, warnings }`。
 */
export function editNode({ session, deps, guards = {}, seq, role, text, part }) {
	const partValue = normalizePart(part);
	const roleValue = normalizeRole(role);
	surfaceIndex(session, seq);
	const original = eventAt(session, seq);
	assertTargetAllowed(original, {
		seq,
		op: "edit",
		part: partValue,
		allowToolNodes: guards.allowToolNodes === true
	});
	const warnings = toolWarning(original, partValue);
	const replacement = buildEditReplacement(original, { part: partValue, role: roleValue, text }, deps);
	const event = appendReplace(session, replacement, { start: seq, end: seq, shadowedSeqs: [seq] });
	return {
		ok: true,
		replacementSeq: event.seq,
		shadowedSeq: seq,
		role: roleValue ?? eventRole(original),
		part: partValue,
		text,
		...(warnings.length > 0 ? { warnings } : {})
	};
}

/** 删除一条节点（空 assistant 影蔽）。 */
export function deleteNode({ session, deps, guards = {}, seq }) {
	surfaceIndex(session, seq);
	const original = eventAt(session, seq);
	assertTargetAllowed(original, { seq, op: "delete", allowToolNodes: guards.allowToolNodes === true });
	const event = appendReplace(session, buildDeleteReplacement(deps), {
		start: seq,
		end: seq,
		shadowedSeqs: [seq]
	});
	return {
		ok: true,
		replacementSeq: event.seq,
		shadowedSeq: seq,
		shadowedType: original?.type ?? null,
		deleted: true
	};
}

/** 整段替换：把 surface 上 [start..end] 连续节点影蔽为一条新消息。 */
export function replaceRange({ session, deps, guards = {}, start, end, role, text }) {
	const roleValue = normalizeRole(role);
	if (roleValue === undefined) throw new Error("整段替换必须指定 role（user 或 assistant）");
	const startIndex = surfaceIndex(session, start);
	const endIndex = surfaceIndex(session, end);
	if (startIndex > endIndex) throw new Error(`start seq ${start} 在 end seq ${end} 之后`);
	const nodes = surfaceNodes(session);
	const shadowed = nodes.slice(startIndex, endIndex + 1);
	const warnings = [];
	for (const seq of shadowed) {
		const event = eventAt(session, seq);
		if (event?.type === "tool/result" || hasToolBlocks(eventMessage(event)?.content)) {
			if (guards.allowToolNodes !== true) {
				throw new Error(
					`区间包含工具节点 [${seq}]：整段替换会把它从模型视角抹掉。确认要这样做，请打开 allowToolNodes 配置。`
				);
			}
			warnings.push(`区间包含工具节点 [${seq}]，其工具调用记录已从模型视角消失。`);
		}
	}
	const replacement = buildPlainReplacement(roleValue, String(text ?? ""), deps);
	const event = appendReplace(session, replacement, { start, end, shadowedSeqs: shadowed });
	return {
		ok: true,
		replacementSeq: event.seq,
		shadowedSeqs: shadowed,
		role: roleValue,
		text,
		...(warnings.length > 0 ? { warnings } : {})
	};
}

/**
 * 可还原的改写候选（新→旧）。
 *
 * journal 是插件进程内的改写记录；进程重启后它为空，此时用日志里可复原的记录
 * 兜底：只接受「影蔽的是原始 append 节点」的记录，避免把还原节点本身当成一次
 * 新的改写（否则 undo 会变成 redo）。
 *
 * @param session - 会话。
 * @param journal - 改写记录数组（可省略）。
 * @returns `{ replacementSeq, shadowedSeqs, entry?, recovered? }` 数组。
 */
export function undoableCandidates(session, journal = []) {
	const nodes = new Set(surfaceNodes(session));
	const candidates = [];
	for (const entry of journal) {
		if (entry.op === "restore" || entry.undone === true) continue;
		if (!nodes.has(entry.replacementSeq)) continue;
		candidates.push({
			replacementSeq: entry.replacementSeq,
			shadowedSeqs: entry.shadowedSeqs,
			entry
		});
	}
	const known = new Set(journal.map((entry) => entry.replacementSeq));
	for (const record of rewriteRecords(session)) {
		if (!record.inSurface || known.has(record.replacementSeq)) continue;
		const target = eventAt(session, record.shadowedSeqs[0]);
		if (target !== undefined && isReplacement(target)) continue;
		candidates.push({
			replacementSeq: record.replacementSeq,
			shadowedSeqs: record.shadowedSeqs,
			recovered: true
		});
	}
	candidates.sort((a, b) => b.replacementSeq - a.replacementSeq);
	return candidates;
}

/**
 * 最近一条「用户自己发的」消息（供输入框旁的编辑按钮定位目标）。
 *
 * 注入的上下文（agent-instructions 之类）同样落成 `user/message` 事件，但它的
 * `source.kind` 不是 `"user"`，因此默认跳过：用户想改的是自己打的字，不是注入内容。
 * 找不到时返回 `undefined`，由调用方决定怎么提示。
 *
 * @param session - 会话。
 * @param options - `includeInjected: true` 时连注入的 user/message 一起考虑。
 * @returns `{ seq, messageId?, text, isRewritten, sourceKind }` 或 undefined。
 */
export function lastUserNode(session, { includeInjected = false } = {}) {
	const nodes = surfaceNodes(session);
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const event = eventAt(session, nodes[index]);
		if (event?.type !== "user/message") continue;
		const message = eventMessage(event);
		const sourceKind = message?.source?.kind;
		if (!includeInjected && sourceKind !== undefined && sourceKind !== "user") continue;
		return {
			seq: event.seq,
			...(message?.id === undefined ? {} : { messageId: message.id }),
			text: blockText(message, "text"),
			isRewritten: isReplacement(event),
			sourceKind: sourceKind ?? null
		};
	}
	return undefined;
}

/**
 * 还原：把当前 surface 上的改写节点换回被影蔽的内容。
 *
 * 单节点改写（edit / delete）可以逐字还原；整段替换（replace）因为 surface 替换
 * 是「一段换一条」，只能合并成一条消息还原，内容不丢但分段不再独立（lossy）。
 * 链式改写时逐次还原会回到上一版，而不是最初的原始版本。
 *
 * @returns `{ ok, replacementSeq, restoredSeqs, mode, lossy, role }`。
 */
export function restoreNode({ session, deps, replacementSeq, shadowedSeqs, role }) {
	// 还原只会把内容放回去，不会隐藏任何东西，因此不需要工具节点保护。
	surfaceIndex(session, replacementSeq);
	const sourceSeqs = Array.isArray(shadowedSeqs) && shadowedSeqs.length > 0
		? shadowedSeqs
		: shadowedSeqsOf(eventAt(session, replacementSeq));
	if (sourceSeqs.length === 0) {
		throw new Error(`seq ${replacementSeq} 不是改写节点（没有影蔽任何内容），无法还原`);
	}
	const originals = sourceSeqs.map((seq) => eventAt(session, seq));
	if (originals.length === 0) throw new Error("没有可还原的影蔽区间");
	if (originals.some((original) => original === undefined)) {
		throw new Error("影蔽的原始节点已不在事件日志中，无法还原");
	}
	const { replacement, mode, lossy, role: restoredRole } = buildRestoreReplacement(originals, { role, deps });
	const event = appendReplace(session, replacement, {
		start: replacementSeq,
		end: replacementSeq,
		shadowedSeqs: [replacementSeq]
	});
	return {
		ok: true,
		replacementSeq: event.seq,
		restoredSeqs: originals.map((original) => original.seq),
		mode,
		lossy,
		role: restoredRole
	};
}
