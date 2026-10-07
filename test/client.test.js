import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const clientSource = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** 在受控环境里加载浏览器产物，返回它交给 ModuleLoader 的那一项。 */
function loadClientEntry(language = "zh-CN") {
	let captured;
	const fakeWindow = {
		__ModuleLoader__: {
			load(entry) {
				captured = entry;
			}
		}
	};
	// 产物是给浏览器的普通脚本：只依赖 window 与 navigator。
	const run = new Function("window", "navigator", clientSource);
	run(fakeWindow, { language });
	assert.ok(captured, "client.js 必须调用 window.__ModuleLoader__.load");
	return captured;
}

const fakeReact = { createElement: (type, props, ...children) => ({ type, props, children }) };

test("客户端工厂的 id 必须等于包名（DSH 的加载约定）", () => {
	const entry = loadClientEntry();
	assert.equal(entry.id, packageJson.name);
	assert.equal(typeof entry.factory, "function");
});

test("客户端工厂返回 { inject, apply } 并注册到三个宿主插槽", () => {
	const entry = loadClientEntry();
	const mod = entry.factory((name) => {
		if (name === "react") return fakeReact;
		throw new Error(`未预期的 require：${name}`);
	});
	assert.deepEqual(mod.inject, ["slots"]);
	assert.equal(typeof mod.apply, "function");

	const registered = [];
	const owners = [];
	const slots = {
		inject(owner, callback) {
			owners.push(owner);
			callback();
		},
		register(meta, component) {
			registered.push({ meta, component });
			return () => {};
		}
	};
	mod.apply({ slots });

	assert.deepEqual(owners, [
		"conversation.chat.assistant-actions",
		"conversation.input.left",
		"conversation.input.dock"
	]);
	assert.deepEqual(
		registered.map((item) => [item.meta.name, item.meta.id]),
		[
			["conversation.chat.assistant-actions", "context-shaping-message"],
			["conversation.input.left", "context-shaping-edit-last"],
			["conversation.input.dock", "context-shaping-editor"]
		]
	);
	for (const item of registered) {
		assert.equal(typeof item.component, "function");
	}
});

test("输入区按钮通过注册项的 inject 拿 sessionId", () => {
	const entry = loadClientEntry();
	const mod = entry.factory(() => fakeReact);
	const registered = [];
	mod.apply({
		slots: {
			inject: (_owner, callback) => callback(),
			register: (meta, component) => {
				registered.push({ meta, component });
				return () => {};
			}
		}
	});
	const button = registered.find((item) => item.meta.id === "context-shaping-edit-last");
	assert.equal(typeof button.meta.inject, "function");
	assert.deepEqual(button.meta.inject("session-abc"), { sessionId: "session-abc" });
});

test("缺少 slots 服务时不抛错（避免整块插槽被拖垮）", () => {
	const entry = loadClientEntry();
	const mod = entry.factory(() => fakeReact);
	assert.doesNotThrow(() => mod.apply({}));
});

test("客户端只调用本插件自己的接口前缀", () => {
	const paths = [...clientSource.matchAll(/["'`](\/api\/[^"'`?]*)/g)].map((match) => match[1]);
	const prefix = "/api/dsh-context-shaping";
	assert.ok(paths.length > 0, "应当存在 API 调用");
	for (const path of paths) {
		assert.ok(path === prefix || path.startsWith(prefix + "/"), `越界的接口前缀：${path}`);
	}
});

test("客户端不引入非基线运行时依赖", () => {
	const required = [...clientSource.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
	assert.deepEqual([...new Set(required)], ["react"]);
});
