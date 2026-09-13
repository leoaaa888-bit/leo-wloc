// dist/wloc-settings.js 的端到端测试: save / query / clear 三条路径, 以及它与
// wloc.js 之间那份持久化数据的交接。

import test from "node:test";
import assert from "node:assert/strict";

import { readScript, runScript, PLATFORMS, buildBody, readLocations } from "./helpers/wloc-fixture.mjs";

const SETTINGS = readScript("wloc-settings.js");
const WLOC = readScript("wloc.js");
const KEY = "wloc_settings";

function call(query, { platform = "Shadowrocket", store = {} } = {}) {
  return runScript(SETTINGS, {
    platform,
    request: { url: "https://gs-loc.apple.com/wloc-settings/save" + query, method: "GET", headers: {} },
    store,
  });
}

function unwrap(payload) {
  return payload && payload.response ? payload.response : payload;
}

// ---------------------------------------------------------------------------

test("save: 写入坐标并返回 success", async () => {
  const store = {};
  const { done } = call("?lon=114.159437&lat=22.284774&acc=25", { store });
  const body = JSON.parse(unwrap(await done).body);

  assert.equal(body.success, true);
  assert.equal(body.longitude, 114.159437);
  assert.equal(body.latitude, 22.284774);
  assert.equal(body.accuracy, 25);

  const saved = JSON.parse(store[KEY]);
  assert.equal(saved.longitude, 114.159437);
  assert.equal(saved.latitude, 22.284774);
  assert.ok(saved.updatedAt, "应记录写入时间");
});

test("save: 接受 longitude/latitude 长写法与 randomRadius", async () => {
  const store = {};
  const { done } = call("?longitude=121.4737&latitude=31.2304&accuracy=10&randomRadius=250", { store });
  const body = JSON.parse(unwrap(await done).body);
  assert.equal(body.success, true);
  assert.equal(body.accuracy, 10);
  assert.equal(body.randomRadius, 250);
  assert.equal(JSON.parse(store[KEY]).randomRadius, 250);
});

test("save: 逗号小数点不得被截成整数度", async () => {
  // 德语/法语键盘和部分地图 App 的分享文本会给出 "22,284774"
  const store = {};
  const { done } = call("?lon=114%2C159437&lat=22%2C284774", { store });
  const body = JSON.parse(unwrap(await done).body);
  assert.equal(body.success, true);
  assert.equal(body.latitude, 22.284774, "逗号写法必须完整解析");
  assert.equal(body.longitude, 114.159437);
});

test("save: 越界或缺失坐标必须拒绝, 不能写进存储", async () => {
  for (const q of ["?lon=200&lat=30", "?lon=120&lat=95", "?lon=abc&lat=30", "?acc=25", ""]) {
    const store = {};
    const { done } = call(q, { store });
    const body = JSON.parse(unwrap(await done).body);
    assert.equal(body.success, false, `${q || "(空)"} 应被拒绝`);
    assert.equal(store[KEY], undefined, `${q || "(空)"} 不得落盘`);
  }
});

test("query: 无数据时报 success:false, 有数据时回读一致", async () => {
  const empty = call("?action=query", { store: {} });
  assert.equal(JSON.parse(unwrap(await empty.done).body).success, false);

  const store = { [KEY]: JSON.stringify({ longitude: 139.7671, latitude: 35.6812, accuracy: 15, randomRadius: 30 }) };
  const filled = call("?action=query", { store });
  const body = JSON.parse(unwrap(await filled.done).body);
  assert.equal(body.success, true);
  assert.equal(body.longitude, 139.7671);
  assert.equal(body.accuracy, 15);
  assert.equal(body.randomRadius, 30);
});

test("clear: 清除后 query 报无数据", async () => {
  const store = { [KEY]: JSON.stringify({ longitude: 1, latitude: 2, accuracy: 25 }) };
  const cleared = call("?action=clear", { store });
  assert.equal(JSON.parse(unwrap(await cleared.done).body).success, true);

  const after = call("?action=query", { store });
  assert.equal(JSON.parse(unwrap(await after.done).body).success, false);
});

test("响应必须带 CORS 头, 否则页面拿不到结果", async () => {
  const { done } = call("?action=query", { store: {} });
  const resp = unwrap(await done);
  assert.equal(resp.status, 200);
  assert.equal(resp.headers["Access-Control-Allow-Origin"], "*");
  assert.match(resp.headers["Content-Type"], /application\/json/);
});

// ---------------------------------------------------------------------------
// 平台约定
// ---------------------------------------------------------------------------

for (const platform of PLATFORMS) {
  test(`${platform}: settings 是 http-request 脚本, 包装约定正确`, async () => {
    const { done } = call("?lon=1.5&lat=2.5", { platform, store: {} });
    const payload = await done;
    if (platform === "Quantumult X") {
      assert.equal(Object.hasOwn(payload, "response"), false, "QX 要顶层");
      assert.equal(payload.status, 200);
    } else {
      // Stash 在 request 脚本上与其它平台一致, 要 {response} —— 与 wloc.js 那条
      // response 路径不同, 这正是 finish(kind) 存在的理由。
      assert.ok(payload.response, `${platform} 要 {response} 包装`);
      assert.equal(payload.response.status, 200);
    }
  });
}

// ---------------------------------------------------------------------------
// 两个脚本之间的交接
// ---------------------------------------------------------------------------

test("端到端: settings 写入的坐标, wloc.js 必须照着改", async () => {
  const store = {};
  const target = { lat: 25.033626, lon: 121.564215 }; // 台北 101

  const saved = call(`?lon=${target.lon}&lat=${target.lat}&acc=18`, { store });
  assert.equal(JSON.parse(unwrap(await saved.done).body).success, true);

  const body = buildBody({ wifis: [{ mac: "aa:bb:cc:dd:ee:01", lat: 31.23, lon: 121.47, acc: 40 }] });
  const run = runScript(WLOC, {
    platform: "Shadowrocket",
    argument: "longitude=113.94114&latitude=22.544577&accuracy=25&randomRadius=0&logLevel=off",
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: { status: 200, headers: {}, bodyBytes: new Uint8Array(body), body: new Uint8Array(body) },
    store,
  });
  const locs = readLocations(unwrap(await run.done).body);
  assert.equal(locs[0].lat.toFixed(6), target.lat.toFixed(6));
  assert.equal(locs[0].lon.toFixed(6), target.lon.toFixed(6));
  assert.equal(locs[0].acc, 18, "精度也应来自存储");
});

test("端到端: clear 之后 wloc.js 回到透传", async () => {
  const store = {};
  const saved = call("?lon=121.564215&lat=25.033626", { store });
  await saved.done;

  const cleared = call("?action=clear", { store });
  await cleared.done;

  const body = buildBody({ wifis: [{ mac: "aa:bb:cc:dd:ee:01", lat: 31.23, lon: 121.47, acc: 40 }] });
  const run = runScript(WLOC, {
    platform: "Shadowrocket",
    argument: "longitude=113.94114&latitude=22.544577&accuracy=25&randomRadius=0&logLevel=off",
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: { status: 200, headers: {}, bodyBytes: new Uint8Array(body), body: new Uint8Array(body) },
    store,
  });
  assert.deepEqual(Array.from(unwrap(await run.done).body), body, "清除后必须一字节不改");
});
