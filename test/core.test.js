import assert from "node:assert/strict";
import { test } from "node:test";
import {
	blockText,
	formatJournalEntry,
	hasToolBlocks,
	messageText,
	normalizePart,
	normalizeRole,
	parseShapeCommand,
	parseSeq,
	preview,
	textAfter,
	tokenize,
	transformBlocks
} from "../lib/core.js";

test("preview 折叠空白并截断", () => {
	assert.equal(preview("  a\n\n b  "), "a b");
	assert.equal(preview("abcdef", 3), "abc…");
	assert.equal(preview(undefined), "");
});

test("messageText 覆盖各类块", () => {
	const text = messageText({
		content: [
			{ type: "text", text: "hello" },
			{ type: "reasoning", text: "secret" },
			{ type: "tool-call", id: "call_1" },
			{ type: "tool-result", content: { ok: true } },
			{ type: "image" }
		]
	});
	assert.match(text, /hello/);
	assert.match(text, /\[reasoning\]/);
	assert.match(text, /\[tool-call call_1\]/);
	assert.match(text, /\[tool-result\] \{"ok":true\}/);
	assert.match(text, /\[image\]/);
	assert.equal(messageText(undefined), "");
});

test("blockText 只取指定块", () => {
	const message = { content: [{ type: "text", text: "A" }, { type: "reasoning", text: "B" }, { type: "text", text: "C" }] };
	assert.equal(blockText(message, "text"), "A\nC");
	assert.equal(blockText(message, "reasoning"), "B");
});

test("hasToolBlocks 识别工具块", () => {
	assert.equal(hasToolBlocks([{ type: "text", text: "x" }]), false);
	assert.equal(hasToolBlocks([{ type: "tool-call", id: "c" }]), true);
	assert.equal(hasToolBlocks(undefined), false);
});

test("transformBlocks(reply)：保留思考链与工具调用", () => {
	const out = transformBlocks(
		[{ type: "reasoning", text: "think" }, { type: "text", text: "old" }, { type: "tool-call", id: "c1" }],
		"reply",
		"new"
	);
	assert.deepEqual(out, [
		{ type: "reasoning", text: "think" },
		{ type: "text", text: "new" },
		{ type: "tool-call", id: "c1" }
	]);
});

test("回归：transformBlocks(reply) 不再把新文本重复写进每个 text 块", () => {
	const out = transformBlocks(
		[{ type: "text", text: "one" }, { type: "reasoning", text: "r" }, { type: "text", text: "two" }],
		"reply",
		"NEW"
	);
	assert.equal(out.filter((block) => block.type === "text").length, 1);
	assert.deepEqual(out, [{ type: "text", text: "NEW" }, { type: "reasoning", text: "r" }]);
});

test("transformBlocks(reply)：没有 text 块时追加一个", () => {
	const out = transformBlocks([{ type: "reasoning", text: "r" }], "reply", "NEW");
	assert.deepEqual(out, [{ type: "reasoning", text: "r" }, { type: "text", text: "NEW" }]);
});

test("transformBlocks(thinking)：替换、移除、无思考链时报错", () => {
	const replaced = transformBlocks([{ type: "text", text: "t" }, { type: "reasoning", text: "old" }], "thinking", "new");
	assert.deepEqual(replaced, [{ type: "text", text: "t" }, { type: "reasoning", text: "new" }]);
	const removed = transformBlocks([{ type: "text", text: "t" }, { type: "reasoning", text: "old" }], "thinking", "");
	assert.deepEqual(removed, [{ type: "text", text: "t" }]);
	assert.throws(() => transformBlocks([{ type: "text", text: "t" }], "thinking", "x"), /没有思考链/);
});

test("transformBlocks(all)：整条变纯文本", () => {
	const out = transformBlocks([{ type: "reasoning", text: "r" }, { type: "text", text: "t" }, { type: "tool-call", id: "c" }], "all", "NEW");
	assert.deepEqual(out, [{ type: "text", text: "NEW" }]);
});

test("tokenize / textAfter 保留偏移", () => {
	const raw = "rewrite 12 assistant hello   world";
	const tokens = tokenize(raw);
	assert.deepEqual(tokens.map((token) => token.value), ["rewrite", "12", "assistant", "hello", "world"]);
	assert.equal(textAfter(raw, 3), "hello   world");
});

test("回归：文本与 seq 相同时不再截错", () => {
	assert.equal(textAfter("edit 5 5", 2), "5");
	assert.equal(textAfter("edit 7 7 7", 2), "7 7");
	assert.equal(textAfter("think 3 3 思考", 2), "3 思考");
	assert.equal(textAfter("edit 5", 2), "");
});

test("parseShapeCommand 解析子命令", () => {
	assert.deepEqual(parseShapeCommand(""), { op: "", args: [] });
	assert.deepEqual(parseShapeCommand("  list  "), { op: "list", args: ["list"] });
	assert.deepEqual(parseShapeCommand("replace 3 4 user hi"), { op: "replace", args: ["replace", "3", "4", "user", "hi"] });
});

test("校验函数拒绝非法输入", () => {
	assert.equal(parseSeq("12"), 12);
	assert.throws(() => parseSeq("12a"), /必须是整数/);
	assert.equal(normalizePart(undefined), "reply");
	assert.throws(() => normalizePart("replyy"), /part 必须是/);
	assert.equal(normalizeRole(""), undefined);
	assert.throws(() => normalizeRole("system"), /role 必须是/);
});

test("formatJournalEntry 渲染改写记录", () => {
	const line = formatJournalEntry({
		id: 7,
		at: "2026-10-08 10:00:00",
		op: "edit",
		source: "tool",
		shadowedSeqs: [12],
		replacementSeq: 30,
		before: "旧文本",
		after: "新文本"
	}, 1);
	assert.match(line, /\[1\] #7 改回复 \[12\]/);
	assert.match(line, /模型工具/);
	assert.match(line, /旧文本/);
	assert.match(line, /新文本/);
});
