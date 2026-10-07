/**
 * 测试脚手架：一个最小的假 session，复刻宿主的 surface 折叠规则
 * （append 追加到尾部；replace 把 [start..end] 这一段换成一个新节点）。
 */
const SURFACE_TYPES = new Set(["user/message", "assistant/message", "tool/result"]);

let idCounter = 0;

/** 假的消息构造器（对应 @deepseek-ai/dsh-llm 的 create*Message）。 */
export const deps = {
	createUserMessage: ({ content, source }) => ({ id: `u${++idCounter}`, role: "user", content, source }),
	createAssistantMessage: ({ content, source }) => ({ id: `a${++idCounter}`, role: "assistant", content, source })
};

export class FakeSession {
	constructor() {
		this.events = [];
		this.surface = { nodes: [] };
		this.nextSeq = 0;
	}

	append(type, data, opts = {}) {
		const seq = this.nextSeq++;
		const event = { seq, type, data };
		if (opts.surfaceOp !== undefined) event.surfaceOp = opts.surfaceOp;
		if (opts.sourceEventSeqs !== undefined) event.sourceEventSeqs = opts.sourceEventSeqs;
		this.events.push(event);
		const op = opts.surfaceOp;
		if (op === undefined || op === "append") {
			if (SURFACE_TYPES.has(type)) this.surface.nodes.push(seq);
			return event;
		}
		const startIndex = this.surface.nodes.indexOf(op.start);
		const endIndex = this.surface.nodes.indexOf(op.end);
		if (startIndex === -1 || endIndex === -1) {
			throw new Error(`surface replace: range ${op.start}..${op.end} not found in surface`);
		}
		this.surface.nodes.splice(startIndex, endIndex - startIndex + 1, seq);
		return event;
	}

	/** 追加一条 user 消息（append 来源）。 */
	addUser(text) {
		return this.append("user/message", {
			id: `u${++idCounter}`,
			content: [{ type: "text", text }],
			source: { kind: "user" }
		}, { surfaceOp: "append" });
	}

	/** 追加一条 assistant 消息（append 来源）。 */
	addAssistant(content) {
		const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
		return this.append("assistant/message", {
			message: { id: `a${++idCounter}`, role: "assistant", content: blocks, source: { kind: "model" } }
		}, { surfaceOp: "append" });
	}

	/** 追加一条 tool/result（append 来源）。 */
	addToolResult(callId, text) {
		return this.append("tool/result", {
			message: {
				id: `t${++idCounter}`,
				role: "tool",
				content: [{ type: "tool-result", id: callId, content: text }],
				source: { kind: "tool", callId }
			}
		}, { surfaceOp: "append" });
	}

	/** 当前 surface 上的事件列表。 */
	surfaceEvents() {
		return this.surface.nodes.map((seq) => this.events[seq]);
	}

	/** 当前 surface 上某条消息的文本。 */
	textAt(seq) {
		const event = this.events[seq];
		const message = event.type === "user/message" ? event.data : event.data.message;
		return (message?.content ?? [])
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
	}
}
