/**
 * dsh-context-shaping — 纯函数层（pure core）。
 *
 * 本文件**不 import 任何 DSH 包**，因此可以在没有 DSH 运行时的环境里直接被
 * `node --test` 覆盖：文本预览、消息块变换、命令解析、改写记录的格式化都在这里。
 * 所有与宿主（session / tools / commands / webServer）交互的部分在 `ops.js` 与
 * `index.js`。
 */

/** 可编辑的 part 取值。 */
export const PARTS = Object.freeze(["reply", "thinking", "all"]);
/** 可用的消息角色。 */
export const ROLES = Object.freeze(["user", "assistant"]);

/** 把任意值转成 content 块数组。 */
export function contentBlocks(content) {
	return Array.isArray(content) ? content : [];
}

/** 从消息块提取可读文本（预览用）。 */
export function messageText(message) {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content
		.map((block) => {
			switch (block?.type) {
				case "text": return block.text ?? "";
				case "tool-call": return `[tool-call ${block.id ?? ""}]`;
				case "tool-result": {
					try {
						return `[tool-result] ${JSON.stringify(block.content ?? null)}`;
					} catch {
						return "[tool-result]";
					}
				}
				case "image": return "[image]";
				case "reasoning": return "[reasoning]";
				default: return "";
			}
		})
		.join("\n");
}

/** 截断预览文本。 */
export function preview(text, max = 120) {
	const flat = String(text ?? "").replace(/\s+/g, " ").trim();
	return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

/** 提取消息中某类型块的全部文本（reply=text 块，thinking=reasoning 块）。 */
export function blockText(message, blockType) {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content
		.filter((block) => block?.type === blockType && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

/** 消息是否带思考链块。 */
export function hasReasoning(content) {
	return contentBlocks(content).some((block) => block?.type === "reasoning");
}

/**
 * 消息是否带工具调用/工具结果块。
 *
 * 这类节点受到额外保护：整条重写（part=all）或删除会把工具调用从模型视角抹掉，
 * 而它的 `tool/result` 仍留在 surface 上，下一轮请求可能因此对不上。
 */
export function hasToolBlocks(content) {
	return contentBlocks(content).some(
		(block) => block?.type === "tool-call" || block?.type === "tool-result"
	);
}

/**
 * 按 part 变换原消息的 content 块：
 *  - "reply"    只替换 text 块（保留 reasoning / tool-call 等），没有 text 块则追加一个；
 *  - "thinking" 只替换 reasoning 块（保留其余），text 为空表示移除全部 reasoning 块；
 *  - "all"      整条变为单 text 块。
 *
 * 修复（0.2.0）：原实现在消息含**多个** text 块时，会把新文本复制进每一个 text 块；
 * 现在折叠为**一个** text 块，位置取第一个 text 块处，其余 text 块合并进它。
 *
 * @param originalContent - 原消息的 content 块数组。
 * @param part - "reply" | "thinking" | "all"。
 * @param text - 新文本。
 * @returns 新的 content 块数组。
 */
export function transformBlocks(originalContent, part, text) {
	const blocks = contentBlocks(originalContent).map((block) => ({ ...block }));
	const newText = String(text ?? "");

	if (part === "reply") {
		const out = [];
		let placed = false;
		for (const block of blocks) {
			if (block.type === "text") {
				if (!placed) {
					out.push({ type: "text", text: newText });
					placed = true;
				}
				continue; // 后续 text 块并入上面那一个，不重复写入
			}
			out.push(block);
		}
		if (!placed) out.push({ type: "text", text: newText });
		return out;
	}

	if (part === "thinking") {
		if (!blocks.some((block) => block.type === "reasoning")) {
			throw new Error("该消息没有思考链（reasoning 块）");
		}
		if (newText === "") return blocks.filter((block) => block.type !== "reasoning");
		return blocks.map((block) => (block.type === "reasoning" ? { ...block, text: newText } : block));
	}

	return [{ type: "text", text: newText }];
}

/** 校验 part 取值（缺省 reply）。 */
export function normalizePart(part) {
	if (part === undefined || part === null || part === "") return "reply";
	const value = String(part);
	if (!PARTS.includes(value)) throw new Error(`part 必须是 ${PARTS.join(" / ")}（收到 ${value}）`);
	return value;
}

/** 校验角色取值。 */
export function normalizeRole(role) {
	if (role === undefined || role === null || role === "") return undefined;
	const value = String(role);
	if (!ROLES.includes(value)) throw new Error(`role 必须是 user 或 assistant（收到 ${value}）`);
	return value;
}

/** 校验并解析 seq。 */
export function parseSeq(value, label = "seq") {
	const seq = Number(value);
	if (!Number.isSafeInteger(seq)) throw new Error(`${label} 必须是整数：${String(value)}`);
	return seq;
}

// ── 命令解析 ────────────────────────────────────────────────────────────────
/**
 * 按空白切分命令，并保留每个 token 在原串中的偏移。
 * @param raw - 原始命令文本（不含前导 `/`）。
 * @returns `{ value, start, end }` 数组。
 */
export function tokenize(raw) {
	const tokens = [];
	const re = /\S+/g;
	let match;
	while ((match = re.exec(String(raw ?? ""))) !== null) {
		tokens.push({ value: match[0], start: match.index, end: match.index + match[0].length });
	}
	return tokens;
}

/**
 * 取第 `n` 个 token 之后的原文（保留内部原始空白，不含分隔空白）。
 *
 * 修复（0.2.0）：原实现用 `raw.indexOf(token)` 定位文本起点，当文本内容与前面的
 * token 相同时（例如 `/shape edit 5 5`）会定位到 seq 上，文本被错误截取。
 */
export function textAfter(raw, n) {
	const tokens = tokenize(raw);
	if (tokens.length <= n) return "";
	return String(raw).slice(tokens[n].start);
}

/**
 * 解析 `/shape` 子命令。
 * @param raw - 命令原文（可为空串）。
 * @returns `{ op, args }`，`args` 为 token 字符串数组（`args[0]` 是子命令本身）。
 */
export function parseShapeCommand(raw) {
	const tokens = tokenize(raw);
	return { op: tokens[0]?.value ?? "", args: tokens.map((token) => token.value) };
}

// ── 改写记录（journal）格式化 ───────────────────────────────────────────────
/** 操作名 → 中文标签。 */
export const OP_LABELS = Object.freeze({
	edit: "改回复",
	thinking: "改思考链",
	"clear-think": "移除思考链",
	rewrite: "整条重写",
	delete: "删除",
	replace: "整段替换",
	restore: "还原"
});

/** 来源 → 中文标签。 */
export const SOURCE_LABELS = Object.freeze({
	command: "命令",
	tool: "模型工具",
	http: "界面",
	recovered: "日志还原"
});

/**
 * 渲染一条改写记录为单行文本（`/shape history` 用）。
 * @param entry - 改写记录。
 * @param index - 从 1 开始的展示序号。
 * @returns 展示行。
 */
export function formatJournalEntry(entry, index) {
	const label = OP_LABELS[entry.op] ?? entry.op;
	const source = SOURCE_LABELS[entry.source] ?? entry.source;
	const target = Array.isArray(entry.shadowedSeqs) && entry.shadowedSeqs.length > 0
		? entry.shadowedSeqs.join(",")
		: "?";
	const undone = entry.undone ? "（已还原）" : "";
	const lossy = entry.lossy ? "（合并还原不可逆）" : "";
	const before = entry.before ? ` ← ${preview(entry.before, 60)}` : "";
	const after = entry.after ? ` → ${preview(entry.after, 60)}` : "";
	return `  [${index}] #${entry.id} ${label} [${target}]${undone}${lossy} · ${source} · ${entry.at}${before}${after}`;
}
