// 路由层测试: 直接调用 handleRequest, 不起 wrangler, 不发网络请求。
// 用例里的链接都自带坐标, parse 在第一步就命中, 不会触发 fetch。

import test from "node:test";
import assert from "node:assert/strict";

import { handleRequest } from "../src/index.js";
import { PROJECT, REPO_URL, SAVE_API } from "../src/config.js";

const call = (path, init) => handleRequest(new Request("https://leo-wloc.pages.dev" + path, init));

// ---------------------------------------------------------------------------

test("GET / 返回选点页面", async () => {
  const r = await call("/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const html = await r.text();
  assert.match(html, /<!DOCTYPE html>/);
  assert.ok(html.includes(PROJECT.name), "页面应带项目名");
  assert.ok(html.includes(SAVE_API), "页面应包含写入端点");
  assert.ok(html.includes("id=\"map\""), "应有地图容器");
});

test("页面必须提供 AGPL 源码入口 (第 13 条)", async () => {
  const html = await (await call("/")).text();
  assert.ok(html.includes(REPO_URL), "页面底部应给出源码地址");
  assert.match(html, /AGPL-3\.0/);
});

test("页面不得出现未闭合的 </script> 导致脚本被提前截断", async () => {
  const html = await (await call("/")).text();
  // 模板里所有内联字符串中的 </script> 都必须写成 <\/script>
  const opens = (html.match(/<script[\s>]/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  assert.equal(opens, closes, `script 标签数量不匹配: ${opens} 开 / ${closes} 闭`);
});

test("页面里所有外链都必须是预期的白名单主机", async () => {
  const html = await (await call("/")).text();
  const hosts = new Set();
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.{}-]+)/gi)) hosts.add(m[1].toLowerCase());
  const allowed = [
    "cdnjs.cloudflare.com", // Leaflet (带 SRI)
    "server.arcgisonline.com", // 卫星 / 街道瓦片
    "{s}.tile.openstreetmap.org", // 标准瓦片
    "{s}.basemaps.cartocdn.com", // 暗色瓦片
    "webst0{s}.is.autonavi.com", // 高德瓦片
    "nominatim.openstreetmap.org", // 地名搜索
    "gs-loc.apple.com", // 写入端点 (被模块就地拦截, 不出设备)
    "github.com", // 源码 / 主页
    "www.w3.org", // SVG namespace
  ];
  for (const h of hosts) {
    assert.ok(allowed.includes(h), `页面出现了未预期的外部主机: ${h}`);
  }
});

test("GET /api/health", async () => {
  const r = await call("/api/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.project, PROJECT.name);
});

test("GET /api/parse: 苹果地图链接 (大陆, 需 GCJ 反算)", async () => {
  const u = encodeURIComponent("https://maps.apple.com/?ll=31.2304,121.4737&name=外滩");
  const r = await call(`/api/parse?format=json&u=${u}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const body = await r.json();
  assert.equal(body.src, "apple");
  // 大陆坐标必须被反算, 不能原样返回
  assert.notEqual(body.lat, 31.2304, "大陆的苹果坐标应做 GCJ->WGS84 反算");
  assert.ok(Math.abs(body.lat - 31.2304) < 0.01, "反算量级应在百米级");
  assert.equal(body.name, "外滩");
});

test("GET /api/parse: 港澳台的苹果链接不做反算", async () => {
  const u = encodeURIComponent("https://maps.apple.com/?ll=22.284774,114.159437");
  const body = await (await call(`/api/parse?format=json&u=${u}`)).json();
  assert.equal(body.lat, 22.284774);
  assert.equal(body.lon, 114.159437);
});

test("GET /api/parse: cs=none 强制不换算", async () => {
  const u = encodeURIComponent("https://maps.apple.com/?ll=31.2304,121.4737");
  const body = await (await call(`/api/parse?format=json&cs=none&u=${u}`)).json();
  assert.equal(body.lat, 31.2304);
  assert.equal(body.lon, 121.4737);
});

test("GET /api/parse: 不带 format 时返回纯文本片段 (给快捷指令用)", async () => {
  const u = encodeURIComponent("22.284774,114.159437");
  const r = await call(`/api/parse?u=${u}`);
  assert.match(r.headers.get("content-type"), /text\/plain/);
  assert.equal(await r.text(), "lat=22.284774&lon=114.159437");
});

test("GET /api/parse: 解析失败返回 422 且带 CORS", async () => {
  const r = await call("/api/parse?format=json&u=" + encodeURIComponent("这里没有坐标"));
  assert.equal(r.status, 422);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.ok((await r.json()).error);
});

test("GET /api/parse: 空参数不崩", async () => {
  const r = await call("/api/parse?format=json");
  assert.equal(r.status, 422);
});

test("GET /source 跳转到仓库 (AGPL 源码提供义务)", async () => {
  const r = await call("/source");
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), REPO_URL);
});

test("OPTIONS 预检", async () => {
  const r = await call("/api/parse", { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("POST 被拒绝", async () => {
  const r = await call("/api/parse", { method: "POST" });
  assert.equal(r.status, 405);
});

test("未知路径 404", async () => {
  const r = await call("/nope");
  assert.equal(r.status, 404);
});

test("robots.txt 禁止收录", async () => {
  const r = await call("/robots.txt");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Disallow: \//);
});
