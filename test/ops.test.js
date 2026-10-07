import assert from "node:assert/strict";
import { test } from "node:test";
import {
	deleteNode,
	describeNode,
	editNode,
	eventAt,
	replaceRange,
	restoreNode,
	rewriteRecords,
	rowsOf,
	undoableCandidates
} from "../lib/ops.js";
import { deps, FakeSession } from "./helpers.js";

/** 造一个最小的场景：user → assistant(带工具调用) → tool/result。 */
function scenarioWithTools() {
	const session = new FakeSession();
	const user = session.addUser("你好");
	const assistant = session.addAssistant([
		{ type: "text", text: "回复正文" },
		{ type: "tool-call", id: "call_1" }
	]);
	const result = session.addToolResult("call_1", "工具结果");
	return { session, user, assistant, result };
}

test("rowsOf 列出当前模型可见节点", () => {
	const { session } = scenarioWithTools();
	const rows = rowsOf(session);
	assert.deepEqual(rows.map((row) => row.role), ["user", "assistant", "tool"]);
	assert.equal(rows[1].text.includes("[tool-call call_1]"), true);
	assert.equal(rows.every((row) => row.isRewritten === false), true);
});

test("editNode(part=reply) 保留思考链与工具调用并给出提示", () => {
	const { session, assistant } = scenarioWithTools();
	session.events[assistant.seq].data.message.content.unshift({ type: "reasoning", text: "思考" });
	const result = editNode({ session, deps, seq: assistant.seq, text: "新正文", part: "reply" });
	assert.equal(result.ok, true);
	assert.equal(result.shadowedSeq, assistant.seq);
	assert.equal(result.role, "assistant");
	assert.equal(result.warnings.length, 1);
	const content = eventAt(session, result.replacementSeq).data.message.content;
	assert.deepEqual(content.map((block) => block.type), ["reasoning", "text", "tool-call"]);
	assert.equal(content[1].text, "新正文");
	assert.deepEqual(session.surface.nodes, [0, result.replacementSeq, 2]);
});

test("回归：删除含工具调用的消息默认被拒绝，配置放开后可用", () => {
	const { session, assistant } = scenarioWithTools();
	assert.throws(
		() => deleteNode({ session, deps, seq: assistant.seq }),
		/包含工具调用/
	);
	const result = deleteNode({ session, deps, guards: { allowToolNodes: true }, seq: assistant.seq });
	assert.equal(result.deleted, true);
});

test("回归：part=all 整条重写含工具调用的消息默认被拒绝", () => {
	const { session, assistant } = scenarioWithTools();
	assert.throws(
		() => editNode({ session, deps, seq: assistant.seq, text: "整条重写", part: "all" }),
		/包含工具调用/
	);
	const result = editNode({
		session,
		deps,
		guards: { allowToolNodes: true },
		seq: assistant.seq,
		text: "整条重写",
		part: "all"
	});
	assert.equal(eventAt(session, result.replacementSeq).data.message.content.length, 1);
});

test("tool/result 节点不能被改写或删除", () => {
	const { session, result } = scenarioWithTools();
	assert.throws(() => editNode({ session, deps, seq: result.seq, text: "x", part: "reply" }), /工具结果节点/);
	assert.throws(() => deleteNode({ session, deps, seq: result.seq }), /工具结果节点/);
});

test("删除固定用空内容的 assistant 消息影蔽（宿主只丢弃这一种空消息）", () => {
	const session = new FakeSession();
	const user = session.addUser("要删掉的话");
	const result = deleteNode({ session, deps, seq: user.seq });
	const event = eventAt(session, result.replacementSeq);
	assert.equal(event.type, "assistant/message");
	assert.deepEqual(event.data.message.content, []);
	assert.deepEqual(event.sourceEventSeqs, [user.seq]);
	assert.equal(event.surfaceOp.op, "replace");
	assert.deepEqual(session.surface.nodes, [result.replacementSeq]);
});

test("不在 surface 上的 seq 一律拒绝", () => {
	const { session, assistant } = scenarioWithTools();
	editNode({ session, deps, seq: assistant.seq, text: "第一次改写", part: "reply" });
	assert.throws(() => editNode({ session, deps, seq: assistant.seq, text: "x", part: "reply" }), /不在当前模型可见上下文/);
	assert.throws(() => deleteNode({ session, deps, seq: assistant.seq }), /不在当前模型可见上下文/);
});

test("角色改写只在 part=all 下允许", () => {
	const session = new FakeSession();
	const assistant = session.addAssistant("我是 AI");
	assert.throws(
		() => editNode({ session, deps, seq: assistant.seq, role: "user", text: "假装是用户", part: "reply" }),
		/part=all/
	);
	const result = editNode({ session, deps, seq: assistant.seq, role: "user", text: "假装是用户", part: "all" });
	assert.equal(result.role, "user");
	assert.equal(eventAt(session, result.replacementSeq).type, "user/message");
});

test("用户消息不能改思考链", () => {
	const session = new FakeSession();
	const user = session.addUser("hi");
	assert.throws(
		() => editNode({ session, deps, seq: user.seq, text: "x", part: "thinking" }),
		/用户消息没有思考链/
	);
});

test("describeNode 暴露改写来源与预览", () => {
	const session = new FakeSession();
	const assistant = session.addAssistant([{ type: "text", text: "旧" }, { type: "reasoning", text: "想" }]);
	const result = editNode({ session, deps, seq: assistant.seq, text: "新", part: "reply" });
	const node = describeNode(session, result.replacementSeq);
	assert.equal(node.isRewritten, true);
	assert.deepEqual(node.shadowedSeqs, [assistant.seq]);
	assert.equal(node.reply, "新");
	assert.equal(node.reasoning, "想");
	assert.equal(node.hasReasoning, true);
	assert.equal(node.shadowedPreviews[0].preview, "旧 [reasoning]");
});

test("整段替换：区间检查与工具节点保护", () => {
	const session = new FakeSession();
	session.addUser("第一句");
	const assistant = session.addAssistant("第二句");
	const replaced = replaceRange({ session, deps, start: 0, end: assistant.seq, role: "assistant", text: "合并成一句" });
	assert.deepEqual(replaced.shadowedSeqs, [0, assistant.seq]);
	assert.deepEqual(session.surface.nodes, [replaced.replacementSeq]);
	assert.throws(() => replaceRange({ session, deps, start: 0, end: assistant.seq, role: "assistant", text: "x" }), /不在当前模型可见上下文/);

	const withTools = scenarioWithTools();
	assert.throws(
		() => replaceRange({ session: withTools.session, deps, start: withTools.user.seq, end: withTools.result.seq, role: "assistant", text: "x" }),
		/包含工具节点/
	);
});

test("还原：单节点逐字还原", () => {
	const session = new FakeSession();
	const assistant = session.addAssistant("原始回复");
	const edited = editNode({ session, deps, seq: assistant.seq, text: "改过的回复", part: "reply" });
	assert.equal(session.textAt(edited.replacementSeq), "改过的回复");
	const restored = restoreNode({ session, deps, replacementSeq: edited.replacementSeq });
	assert.equal(restored.mode, "exact");
	assert.equal(restored.lossy, false);
	assert.deepEqual(restored.restoredSeqs, [assistant.seq]);
	assert.equal(session.textAt(restored.replacementSeq), "原始回复");
	assert.deepEqual(session.surface.nodes, [restored.replacementSeq]);
});

test("还原：删除后的节点可以救回来", () => {
	const session = new FakeSession();
	const user = session.addUser("别删我");
	const deleted = deleteNode({ session, deps, seq: user.seq });
	assert.equal(session.textAt(deleted.replacementSeq), "");
	const restored = restoreNode({ session, deps, replacementSeq: deleted.replacementSeq });
	assert.equal(session.textAt(restored.replacementSeq), "别删我");
	assert.equal(eventAt(session, restored.replacementSeq).type, "user/message");
});

test("还原：整段替换只能合并还原（内容不丢，分段不保留）", () => {
	const session = new FakeSession();
	session.addUser("用户那一句");
	const assistant = session.addAssistant("AI 那一句");
	const replaced = replaceRange({ session, deps, start: 0, end: assistant.seq, role: "assistant", text: "替换文本" });
	const restored = restoreNode({ session, deps, replacementSeq: replaced.replacementSeq });
	assert.equal(restored.mode, "merged");
	assert.equal(restored.lossy, true);
	const text = session.textAt(restored.replacementSeq);
	assert.match(text, /用户那一句/);
	assert.match(text, /AI 那一句/);
	assert.match(text, /---/);
});

test("还原：非改写节点报错", () => {
	const session = new FakeSession();
	const user = session.addUser("原始消息");
	assert.throws(() => restoreNode({ session, deps, replacementSeq: user.seq }), /不是改写节点/);
});

test("审计：rewriteRecords 从日志复原改写历史", () => {
	const session = new FakeSession();
	const assistant = session.addAssistant("v1");
	const first = editNode({ session, deps, seq: assistant.seq, text: "v2", part: "reply" });
	const second = editNode({ session, deps, seq: first.replacementSeq, text: "v3", part: "reply" });
	let records = rewriteRecords(session);
	assert.equal(records.length, 2);
	assert.equal(records[0].replacementSeq, first.replacementSeq);
	assert.equal(records[0].inSurface, false);
	assert.equal(records[1].replacementSeq, second.replacementSeq);
	assert.equal(records[1].inSurface, true);
	assert.equal(records[1].preview, "v3");
	const restored = restoreNode({ session, deps, replacementSeq: second.replacementSeq });
	records = rewriteRecords(session);
	assert.equal(records.length, 3);
	assert.equal(records[2].replacementSeq, restored.replacementSeq);
	assert.deepEqual(records[2].shadowedSeqs, [second.replacementSeq]);
});

test("undo 候选：最近一次改写优先，且不会把还原节点当成新改写", () => {
	const session = new FakeSession();
	const assistant = session.addAssistant("原始");
	const journal = [];
	const edited = editNode({ session, deps, seq: assistant.seq, text: "改写一", part: "reply" });
	journal.push({ id: 1, op: "edit", shadowedSeqs: [assistant.seq], replacementSeq: edited.replacementSeq });

	let candidates = undoableCandidates(session, journal);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].replacementSeq, edited.replacementSeq);
	assert.equal(candidates[0].entry.id, 1);

	// 还原之后：被还原的改写节点已离开 surface，还原节点本身不算候选
	const restored = restoreNode({ session, deps, replacementSeq: edited.replacementSeq });
	journal[0].undone = true;
	journal.push({ id: 2, op: "restore", shadowedSeqs: [edited.replacementSeq], replacementSeq: restored.replacementSeq });
	candidates = undoableCandidates(session, journal);
	assert.deepEqual(candidates, []);
});

test("undo 候选：进程重启后从日志兜底", () => {
	const session = new FakeSession();
	const assistant = session.addAssistant("原始");
	const edited = editNode({ session, deps, seq: assistant.seq, text: "改写", part: "reply" });
	const candidates = undoableCandidates(session, []);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].replacementSeq, edited.replacementSeq);
	assert.equal(candidates[0].recovered, true);
	assert.deepEqual(candidates[0].shadowedSeqs, [assistant.seq]);
});

test("undo 候选：多次改写按新→旧排序", () => {
	const session = new FakeSession();
	const a = session.addAssistant("A");
	const b = session.addAssistant("B");
	const first = editNode({ session, deps, seq: a.seq, text: "A2", part: "reply" });
	const second = editNode({ session, deps, seq: b.seq, text: "B2", part: "reply" });
	const candidates = undoableCandidates(session, []);
	assert.deepEqual(candidates.map((candidate) => candidate.replacementSeq), [second.replacementSeq, first.replacementSeq]);
});
