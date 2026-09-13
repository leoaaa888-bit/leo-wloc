#!/usr/bin/env node
// 独立性与一致性自检。
//
//   node scripts/check.mjs         离线检查
//   node scripts/check.mjs --net   额外实际请求一遍所有对外 URL
//
// 这个脚本要回答的核心问题是:「这个仓库在运行时还依赖别人的东西吗?」
//
// 关键区分 —— 这两件事必须分开看待:
//   * 运行时引用: 任何指向上游或其镜像仓库/部署的 URL。必须为 0。
//   * 署名文字:   注释和 NOTICE 里提到上游作者名。AGPL-3.0 要求保留署名,
//                 这些不能删, 只能限制出现位置。
// 把两者混为一谈, 要么删掉法律上必须保留的署名, 要么放过真正的运行时依赖。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NET = process.argv.includes("--net");

const OWNER = "leoaaa888-bit";
const REPO = "leo-wloc";
const BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const REPO_URL = `https://github.com/${OWNER}/${REPO}`;
const PAGES_URL = "https://leo-wloc.pages.dev";

const SKIP_DIRS = new Set(["node_modules", ".git", ".wrangler", "dist-tmp", ".vscode"]);
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2"]);

// 允许出现上游作者名 / 镜像仓库名的文件 (署名与溯源)。
const PROVENANCE_FILES = new Set([
  "NOTICE.md",
  "README.md",
  "docs/provenance.md",
  "docs/compatibility.md",
  "scripts/check.mjs",
  "dist/wloc.js",
  "dist/wloc-settings.js",
]);

// 上游与各镜像。出现在 URL 里 = 运行时依赖, 一律不允许。
const UPSTREAM_NAMES = [
  "Yu9191",
  "wloc-pages.pages.dev",
  "wloc-spoofer.wloc.workers.dev",
  "1137182119",
  "Cafe2o4",
  "xepes0",
  "tyiag13",
  "samni728",
  "sydixsd",
  "zxishere",
  "proxypin-wloc-spoofer",
  "NSNanoCat",
];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const note = (m) => notes.push(m);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT).map((f) => ({
  abs: f,
  rel: relative(ROOT, f).split(sep).join("/"),
}));

const textFiles = files.filter((f) => {
  const dot = f.rel.lastIndexOf(".");
  return !BINARY_EXT.has(dot === -1 ? "" : f.rel.slice(dot).toLowerCase());
});

for (const f of textFiles) f.text = readFileSync(f.abs, "utf8");

// ---------------------------------------------------------------------------
// 1. 运行时引用: 上游 / 镜像的 URL 必须为 0
// ---------------------------------------------------------------------------

// 逗号不算 URL 的一部分: 模块文件里 script-path=<url>,argument=... 用逗号分隔字段,
// 不排除的话会把整条参数串吞进 URL 里。本项目没有含逗号的合法 URL。
const URL_RE = /(?:https?:)?\/\/[^\s"'`)<>\\,]+/gi;
const allUrls = [];
for (const f of textFiles) {
  for (const m of f.text.matchAll(URL_RE)) {
    allUrls.push({ file: f.rel, url: m[0], line: f.text.slice(0, m.index).split("\n").length });
  }
}

let upstreamUrlHits = 0;
for (const u of allUrls) {
  for (const name of UPSTREAM_NAMES) {
    if (u.url.toLowerCase().includes(name.toLowerCase())) {
      // check.mjs 自己那张名单不算
      if (u.file === "scripts/check.mjs") continue;
      upstreamUrlHits++;
      fail(`运行时依赖: ${u.file}:${u.line} 指向上游/镜像 -> ${u.url}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 署名文字: 只允许出现在溯源文件里
// ---------------------------------------------------------------------------

let provenanceMentions = 0;
for (const f of textFiles) {
  for (const name of UPSTREAM_NAMES) {
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const hits = f.text.match(re);
    if (!hits) continue;
    if (PROVENANCE_FILES.has(f.rel)) {
      provenanceMentions += hits.length;
      continue;
    }
    fail(`署名文字出现在非溯源文件: ${f.rel} 提到 "${name}" ${hits.length} 次`);
  }
}

// ---------------------------------------------------------------------------
// 3. 模块 script-path 必须全部指向本仓库
// ---------------------------------------------------------------------------

const MODULES = ["wloc.module", "wloc.sgmodule", "wloc.conf", "wloc.lpx", "wloc.stoverride"];
const EXPECTED_SCRIPTS = [`${RAW_BASE}/dist/wloc.js`, `${RAW_BASE}/dist/wloc-settings.js`];

for (const name of MODULES) {
  const f = textFiles.find((x) => x.rel === `modules/${name}`);
  if (!f) {
    fail(`缺少模块文件 modules/${name}`);
    continue;
  }
  const urls = [...f.text.matchAll(URL_RE)].map((m) => m[0]);
  const scriptUrls = urls.filter((u) => u.endsWith(".js"));
  if (scriptUrls.length !== 2) {
    fail(`modules/${name}: 应恰好引用 2 个脚本, 实际 ${scriptUrls.length} 个`);
  }
  for (const u of scriptUrls) {
    if (!EXPECTED_SCRIPTS.includes(u)) fail(`modules/${name}: 脚本地址不是本仓库 -> ${u}`);
  }
  for (const key of ["homepage", "author"]) {
    if (name !== "wloc.stoverride" && !f.text.includes(`#!${key}=`)) fail(`modules/${name}: 缺少 #!${key}=`);
  }
  if (!f.text.includes(REPO_URL)) fail(`modules/${name}: homepage 未指向 ${REPO_URL}`);
  if (name !== "wloc.conf" && !/gs-loc\.apple\.com/.test(f.text)) fail(`modules/${name}: MITM 主机名缺少 gs-loc.apple.com`);
  if (!/wloc-settings\\?\/save/.test(f.text)) fail(`modules/${name}: 缺少 wloc-settings/save 规则`);
  if (!/clls\\?\/wloc/.test(f.text)) fail(`modules/${name}: 缺少 /clls/wloc 规则`);
}

// ---------------------------------------------------------------------------
// 4. 两份脚本的共享运行时必须逐字节一致
// ---------------------------------------------------------------------------

function sharedBlock(rel) {
  const f = textFiles.find((x) => x.rel === rel);
  if (!f) return null;
  const begin = f.text.indexOf("==== SHARED RUNTIME BEGIN");
  const end = f.text.indexOf("==== SHARED RUNTIME END");
  if (begin === -1 || end === -1) return null;
  return f.text.slice(begin, end);
}

const a = sharedBlock("dist/wloc.js");
const b = sharedBlock("dist/wloc-settings.js");
if (!a || !b) fail("dist/*.js 缺少 SHARED RUNTIME 标记");
else if (a !== b) fail("dist/wloc.js 与 dist/wloc-settings.js 的共享运行时块已漂开, 必须保持一致");
else note(`共享运行时块一致 (${a.split("\n").length} 行)`);

// ---------------------------------------------------------------------------
// 5. 引用到的仓库内文件必须真实存在
// ---------------------------------------------------------------------------

const rawRefs = allUrls.filter((u) => u.url.startsWith(RAW_BASE));
for (const r of rawRefs) {
  const path = r.url.slice(RAW_BASE.length + 1);
  if (!existsSync(resolve(ROOT, path))) fail(`${r.file}:${r.line} 引用了仓库里不存在的文件 -> ${path}`);
}
note(`仓库内自引用 ${rawRefs.length} 处, 全部存在`);

// ---------------------------------------------------------------------------
// 6. 外部主机白名单
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com", // 本仓库的脚本与图标
  "github.com", // 本仓库主页
  "codeload.github.com", // 文档里的核对命令
  "pages.dev", // 自己的 Pages (含文档里的占位域名)
  "workers.dev", // 自己的 Workers
  "localhost", // 本地调试
  "cdnjs.cloudflare.com", // Leaflet (带 SRI)
  "server.arcgisonline.com", // 瓦片
  "tile.openstreetmap.org",
  "basemaps.cartocdn.com",
  "is.autonavi.com",
  "nominatim.openstreetmap.org", // 地名搜索
  "gs-loc.apple.com", // 写入端点 (被模块就地拦截)
  "gs-loc-cn.apple.com",
  "gsp-ssl.ls.apple.com",
  "bluedot.is.autonavi.com",
  "www.gnu.org", // 许可证
  "fsf.org",
  "www.fsf.org",
  "www.w3.org", // SVG namespace
  "developers.cloudflare.com", // 文档链接
  "dash.cloudflare.com",
  "nodejs.org",
  "www.icloud.com", // 用户自建快捷指令的分享域名
  "unpkg.com", // 仅出现在文档中作为备选 CDN 说明
  "leafletjs.com",
]);

const seenHosts = new Map();
for (const u of allUrls) {
  if (u.file === "scripts/check.mjs") continue;
  // 测试夹具里全是各家地图的示例链接 (maps.apple.com / map.baidu.com / …)。
  // 它们是被解析的输入数据, 不是本项目会去访问的地址 —— 测试全程离线。
  // 上游引用检查仍然覆盖这些文件, 只是不参与「对外主机」统计。
  if (/(^|\/)test\//.test(u.file)) continue;
  let host;
  try {
    host = new URL(u.url.startsWith("//") ? "https:" + u.url : u.url).hostname.toLowerCase();
  } catch (e) {
    continue; // 模板占位如 {s}.tile... 解析不了, 下面单独处理
  }
  host = host.replace(/^\{s\}\./, "").replace(/^webst0\{s\}\./, "");
  if (!seenHosts.has(host)) seenHosts.set(host, []);
  seenHosts.get(host).push(`${u.file}:${u.line}`);
}
for (const [host, where] of seenHosts) {
  const ok = [...ALLOWED_HOSTS].some((h) => host === h || host.endsWith("." + h));
  if (!ok) fail(`未在白名单中的外部主机: ${host}  (${where.slice(0, 3).join(", ")})`);
}

// ---------------------------------------------------------------------------
// 7. 品牌与许可证
// ---------------------------------------------------------------------------

const license = textFiles.find((f) => f.rel === "LICENSE");
if (!license) fail("缺少 LICENSE");
else if (!license.text.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) fail("LICENSE 不是 AGPL-3.0 全文");
else note("LICENSE = AGPL-3.0 全文");

if (!existsSync(resolve(ROOT, "NOTICE.md"))) fail("缺少 NOTICE.md (来源与修改说明)");
if (!existsSync(resolve(ROOT, "assets/icon.png"))) fail("缺少 assets/icon.png");

for (const f of textFiles) {
  if (f.rel.startsWith("dist/") && !f.text.includes("AGPL-3.0")) fail(`${f.rel}: 文件头缺少许可证声明`);
}

const page = textFiles.find((f) => f.rel === "worker/src/page.js");
if (page && !page.text.includes("SOURCE_OFFER_URL")) fail("选点页面未提供 AGPL 第 13 条要求的源码入口");

// ---------------------------------------------------------------------------
// 8. 可选: 真的请求一遍
// ---------------------------------------------------------------------------

if (NET) {
  // 文档里的占位地址不该去请求: 中文占位符、YOUR-、localhost、空查询值。
  const isPlaceholder = (u) =>
    /[^\x00-\x7F]/.test(u) || /YOUR-/i.test(u) || /localhost/.test(u) || /[?&]\w+=(&|$)/.test(u);

  // 本项目自己的基础设施。仓库还没推、Pages 还没部署时它们必然 404 —— 那是
  // 「还没做」, 不是「坏了」, 不该和第三方链接失效混为一谈。
  const isOurs = (u) =>
    u.includes(`${OWNER}/${REPO}`) || u.includes(PAGES_URL) || u.includes("workers.dev");

  const targets = [
    ...new Set(
      allUrls.filter((u) => !/(^|\/)test\//.test(u.file) && u.file !== "scripts/check.mjs").map((u) => u.url)
    ),
  ]
    // {s} 是瓦片子域占位符; gs-loc / bluedot 是被模块就地拦截的伪造端点, 真去请求
    // 只会打到 Apple 自己的服务器上, 既无意义也不该做。
    .filter((u) => u.startsWith("http") && !u.includes("{") && !u.includes("gs-loc") && !u.includes("bluedot"))
    .filter((u) => !isPlaceholder(u));

  console.log(`\n联网检查 ${targets.length} 个 URL …\n`);
  const pending = [];

  await Promise.all(
    targets.map(async (u) => {
      let status = null;
      let err = null;
      try {
        const r = await fetch(u, {
          method: "GET",
          redirect: "follow",
          headers: { "user-agent": "Mozilla/5.0 (compatible; leo-wloc-check/1.0)" },
          signal: AbortSignal.timeout(25000),
        });
        status = r.status;
      } catch (e) {
        err = e.message;
      }

      if (status && status < 400) return note(`${status} ${u}`);

      const label = err ? `请求失败 (${err})` : `HTTP ${status}`;
      if (isOurs(u)) pending.push(`${label}  ${u}`);
      else if (status === 403 || status === 429) note(`${label} (对方拒绝自动化请求, 视为可达) ${u}`);
      else fail(`第三方 URL 不可达: ${label}  ${u}`);
    })
  );

  if (pending.length) {
    console.log(`\n  ⚠ 本项目自己的地址有 ${pending.length} 个还不可达 —— 推送仓库 / 部署 Pages 之后应全部转为 200:\n`);
    for (const p of pending) console.log("    -", p);
  }
}

// ---------------------------------------------------------------------------

console.log("\n=== Leo WLOC 独立性自检 ===\n");
for (const n of notes) console.log("  ·", n);
console.log(`\n  上游/镜像的运行时 URL 引用: ${upstreamUrlHits}  (必须为 0)`);
console.log(`  溯源文件中的署名文字:       ${provenanceMentions}  (AGPL-3.0 要求保留)`);
console.log(`  扫描文件:                   ${textFiles.length} 个文本文件, ${allUrls.length} 处 URL`);

if (problems.length) {
  console.error(`\n✖ ${problems.length} 项问题:\n`);
  for (const p of problems) console.error("  -", p);
  process.exit(1);
}
console.log("\n✔ 全部通过 — 运行时不依赖上游或任何镜像\n");
