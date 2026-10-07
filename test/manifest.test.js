import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");
const exists = (name) => fs.existsSync(new URL(name, root));

const manifest = JSON.parse(read("package.json"));

test("包声明了 bundle 补丁，且补丁文件存在", () => {
	assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.ok(exists("cordis.patch.yml"), "cordis.patch.yml 必须随包发布");
});

test("补丁把包自身插入组合（id + name 与清单一致）", () => {
	const patch = read("cordis.patch.yml");
	assert.match(patch, /^-\s*insert:/m, "补丁必须是 insert 列表");
	assert.match(patch, /id:\s*context-shaping/);
	assert.ok(
		patch.includes(`name: '${manifest.name}'`) || patch.includes(`name: "${manifest.name}"`),
		"补丁的 name 必须等于包名"
	);
	assert.ok(manifest.files.includes("cordis.patch.yml"), "files 必须包含补丁文件");
});

test("客户端半边可由 DSH 加载（platform + ./client 导出 + 工厂 id）", () => {
	assert.equal(manifest.dsh?.client?.platform, "web");
	assert.equal(manifest.exports["./client"], "./lib/client.js");
	assert.ok(manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-conversation"));
	const client = read("lib/client.js");
	assert.match(client, new RegExp(`id:\\s*["']${manifest.name.replace(/[/\\]/g, "\\$&")}["']`));
});

test("宿主半边导出官网要求的形式，且不声明顶层 inject", () => {
	const index = read("lib/index.js");
	assert.match(index, /export function apply\(ctx, config/);
	assert.match(index, /export const Config = /);
	// 顶层 inject 是硬依赖：宿主缺该服务时整行会停在“等待依赖”而永不激活
	// （DSH 启动失败矩阵原文），因此本插件改为按能力做作用域注入。
	assert.doesNotMatch(index, /export const inject = \[/);
	for (const capability of ["commands", "tools", "webServer"]) {
		assert.match(index, new RegExp(String.raw`each\(\["` + capability + String.raw`"\]`));
	}
});

test("清单字段完整（仓库、许可、Node 版本、测试脚本）", () => {
	assert.equal(manifest.type, "module");
	assert.equal(manifest.main, "lib/index.js");
	assert.equal(manifest.license, "MIT");
	assert.match(manifest.repository.url, /zeranhub\/dsh-context-shaping/);
	assert.match(manifest.engines.node, />=22\.19\.0/);
	assert.equal(manifest.scripts.test, "node --test");
	assert.ok(manifest.keywords.includes("dsh-plugin"));
	for (const file of ["LICENSE", "NOTICE", "README.md", "README.zh-CN.md", "CHANGELOG.md", "SECURITY.md"]) {
		assert.ok(manifest.files.includes(file), `files 必须包含 ${file}`);
		assert.ok(exists(file), `${file} 必须存在`);
	}
});

test("本地化元数据可解析且带标题", () => {
	for (const locale of ["en", "zh"]) {
		const meta = JSON.parse(read(`locale/${locale}.json`));
		assert.equal(typeof meta.meta.title, "string");
		assert.equal(typeof meta.meta.description, "string");
	}
	assert.ok(manifest.files.includes("locale/*.json"), "files 必须包含 locale");
});

test("不声明 DSH peerDependency（错误的版本范围会直接挡住安装）", () => {
	const peers = manifest.peerDependencies ?? {};
	for (const [name, range] of Object.entries(peers)) {
		if (name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-")) {
			assert.fail(`不应声明 ${name}@${range}：DSH 会用它校验运行时版本并可能拒绝安装`);
		}
	}
	assert.deepEqual(manifest.dependencies, undefined, "插件应保持零依赖");
});
