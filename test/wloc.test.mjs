// dist/wloc.js 的端到端测试: 在模拟的各代理平台环境里真跑脚本, 检查它吐回去的
// 字节里坐标确实被换成了目标值。

import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import { readScript, buildBody, readLocations, runScript, PLATFORMS } from "./helpers/wloc-fixture.mjs";

const SCRIPT = readScript("wloc.js");

const REAL = { lat: 31.230416, lon: 121.473701 }; // 上海人民广场, 冒充「设备真实位置」
const TARGET = { lat: 22.284774, lon: 114.159437 }; // 香港 ifc mall

function baseBody() {
  return buildBody({
    wifis: [
      { mac: "aa:bb:cc:dd:ee:01", lat: REAL.lat, lon: REAL.lon, acc: 40 },
      { mac: "aa:bb:cc:dd:ee:02", lat: REAL.lat + 0.001, lon: REAL.lon + 0.001, acc: 55 },
    ],
    cells: [{ lat: REAL.lat, lon: REAL.lon, acc: 900 }],
  });
}

function makeResponse(bodyBytes) {
  return {
    status: 200,
    headers: { "Content-Type": "application/x-protobuf" },
    bodyBytes: new Uint8Array(bodyBytes),
    body: new Uint8Array(bodyBytes),
  };
}

/** 取出 $done payload 里的 response —— 各平台包装不同, 这里一并抹平。 */
function unwrap(payload) {
  return payload && payload.response ? payload.response : payload;
}

function argOf(lat, lon, extra = "") {
  return `longitude=${lon}&latitude=${lat}&accuracy=25&randomRadius=0&logLevel=off${extra}`;
}

// ---------------------------------------------------------------------------

for (const platform of PLATFORMS) {
  test(`${platform}: 按模块参数改写坐标`, async () => {
    const { done } = runScript(SCRIPT, {
      platform,
      argument: argOf(TARGET.lat, TARGET.lon),
      request: { url: "https://gs-loc.apple.com/clls/wloc", method: "POST", headers: {} },
      response: makeResponse(baseBody()),
    });
    const resp = unwrap(await done);
    const locs = readLocations(resp.body);

    assert.ok(locs.length >= 3, `应改写全部 3 个点位, 实际 ${locs.length}`);
    for (const l of locs) {
      assert.equal(l.lat.toFixed(6), TARGET.lat.toFixed(6));
      assert.equal(l.lon.toFixed(6), TARGET.lon.toFixed(6));
      assert.equal(l.acc, 25);
    }
  });
}

test("Quantumult X: $done 收到的是顶层 response, 且不带 Content-Length", async () => {
  const { done } = runScript(SCRIPT, {
    platform: "Quantumult X",
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(baseBody()),
    store: { wloc_settings: JSON.stringify({ longitude: TARGET.lon, latitude: TARGET.lat, accuracy: 25 }) },
  });
  const payload = await done;
  assert.equal(Object.hasOwn(payload, "response"), false, "QX 不接受 {response} 包装");
  assert.equal(payload.status, 200);
  assert.equal(payload.headers["Content-Length"], undefined);
  assert.equal(payload.headers["Transfer-Encoding"], undefined);
});

test("Stash: http-response 脚本要顶层字段, 不能包 {response}", async () => {
  const { done } = runScript(SCRIPT, {
    platform: "Stash",
    argument: argOf(TARGET.lat, TARGET.lon),
    request: { url: "https://gs-loc-cn.apple.com/clls/wloc", headers: {} },
    response: makeResponse(baseBody()),
  });
  const payload = await done;
  assert.equal(Object.hasOwn(payload, "response"), false);
  assert.equal(payload.status, 200);
  assert.equal(payload.headers["Content-Type"], "application/x-protobuf");
});

for (const platform of ["Surge", "Shadowrocket", "Loon", "Egern"]) {
  test(`${platform}: $done 必须包成 {response}`, async () => {
    const { done } = runScript(SCRIPT, {
      platform,
      argument: argOf(TARGET.lat, TARGET.lon),
      request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
      response: makeResponse(baseBody()),
    });
    const payload = await done;
    assert.ok(payload.response, `${platform} 需要 {response} 包装`);
    assert.equal(payload.response.status, 200);
  });
}

// ---------------------------------------------------------------------------
// 优先级与透传
// ---------------------------------------------------------------------------

test("持久化存储优先于模块参数", async () => {
  const saved = { longitude: 139.7671, latitude: 35.6812, accuracy: 10 }; // 东京站
  const { done } = runScript(SCRIPT, {
    platform: "Shadowrocket",
    argument: argOf(TARGET.lat, TARGET.lon),
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(baseBody()),
    store: { wloc_settings: JSON.stringify(saved) },
  });
  const locs = readLocations(unwrap(await done).body);
  assert.equal(locs[0].lat.toFixed(6), saved.latitude.toFixed(6));
  assert.equal(locs[0].lon.toFixed(6), saved.longitude.toFixed(6));
  assert.equal(locs[0].acc, 10);
});

test("透传: 无持久化数据且参数为出厂哨兵值时, body 一字节不动", async () => {
  const body = baseBody();
  const { done } = runScript(SCRIPT, {
    platform: "Shadowrocket",
    argument: "longitude=113.94114&latitude=22.544577&accuracy=25&randomRadius=0&logLevel=off",
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(body),
  });
  const resp = unwrap(await done);
  assert.deepEqual(Array.from(resp.body), body, "透传时不得改写任何字节");
  const locs = readLocations(resp.body);
  assert.equal(locs[0].lat.toFixed(6), REAL.lat.toFixed(6), "真实坐标必须原样保留");
});

test("透传: 清除数据后 (存储为 null) 仍按哨兵规则透传", async () => {
  const body = baseBody();
  const { done } = runScript(SCRIPT, {
    platform: "Surge",
    argument: "longitude=113.94114&latitude=22.544577&accuracy=25&randomRadius=0&logLevel=off",
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(body),
    store: { wloc_settings: "null" },
  });
  assert.deepEqual(Array.from(unwrap(await done).body), body);
});

test("用户自填了模块参数时, 清除数据不会退回透传", async () => {
  const body = baseBody();
  const { done } = runScript(SCRIPT, {
    platform: "Surge",
    argument: argOf(TARGET.lat, TARGET.lon),
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(body),
    store: { wloc_settings: "null" },
  });
  const locs = readLocations(unwrap(await done).body);
  assert.equal(locs[0].lat.toFixed(6), TARGET.lat.toFixed(6));
});

test("Quantumult X 没有模块参数, 无存储时必须透传而不是跑到哨兵坐标", async () => {
  const body = baseBody();
  const { done } = runScript(SCRIPT, {
    platform: "Quantumult X",
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(body),
  });
  assert.deepEqual(Array.from(unwrap(await done).body), body);
});

// ---------------------------------------------------------------------------
// 边界情况
// ---------------------------------------------------------------------------

test("南半球 / 西半球: 负坐标必须按 int64 补码编码", async () => {
  const target = { lat: -33.856159, lon: 151.215256 }; // 悉尼歌剧院
  const target2 = { lat: 37.819929, lon: -122.478255 }; // 金门大桥
  for (const t of [target, target2, { lat: -22.951916, lon: -43.21054 }]) {
    const { done } = runScript(SCRIPT, {
      platform: "Shadowrocket",
      argument: argOf(t.lat, t.lon),
      request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
      response: makeResponse(baseBody()),
    });
    const locs = readLocations(unwrap(await done).body);
    assert.equal(locs[0].lat.toFixed(6), t.lat.toFixed(6), `纬度 ${t.lat}`);
    assert.equal(locs[0].lon.toFixed(6), t.lon.toFixed(6), `经度 ${t.lon}`);
  }
});

test("gzip 响应体: 三种 DEFLATE 块类型都要能解开并改写", async () => {
  // level 0 -> stored 块; 小数据 -> fixed Huffman; 大量重复数据 -> dynamic Huffman
  const cases = [
    { name: "stored", body: baseBody(), level: 0 },
    { name: "fixed", body: baseBody(), level: 6 },
    {
      name: "dynamic",
      body: buildBody({
        wifis: Array.from({ length: 60 }, (_, i) => ({
          mac: `aa:bb:cc:dd:ee:${(i % 100).toString(16).padStart(2, "0")}`,
          lat: REAL.lat,
          lon: REAL.lon,
          acc: 40,
        })),
      }),
      level: 9,
    },
  ];
  for (const c of cases) {
    const gz = Array.from(gzipSync(Buffer.from(c.body), { level: c.level }));
    assert.equal(gz[0], 0x1f, "夹具本身必须是 gzip");
    const { done } = runScript(SCRIPT, {
      platform: "Shadowrocket",
      argument: argOf(TARGET.lat, TARGET.lon),
      request: { url: "https://gs-loc.apple.com/clls/wloc", headers: { "Content-Encoding": "gzip" } },
      response: makeResponse(gz),
    });
    const resp = unwrap(await done);
    const locs = readLocations(resp.body);
    assert.ok(locs.length > 0, `${c.name}: 应解压并改写`);
    assert.equal(locs[0].lat.toFixed(6), TARGET.lat.toFixed(6), c.name);
    assert.equal(resp.headers["Content-Encoding"], undefined, `${c.name}: 必须去掉 Content-Encoding`);
    assert.equal(resp.headers["Content-Length"], String(resp.body.length), `${c.name}: 长度必须重算`);
  }
});

test("扰动半径: 落点必须在圆内, 且每次不同", async () => {
  const radius = 300;
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const { done } = runScript(SCRIPT, {
      platform: "Shadowrocket",
      argument: argOf(TARGET.lat, TARGET.lon).replace("randomRadius=0", `randomRadius=${radius}`),
      request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
      response: makeResponse(baseBody()),
    });
    const l = readLocations(unwrap(await done).body)[0];
    seen.add(`${l.lat},${l.lon}`);
    // 球面距离
    const R = 6378137;
    const dLat = ((l.lat - TARGET.lat) * Math.PI) / 180;
    const dLon = ((l.lon - TARGET.lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((TARGET.lat * Math.PI) / 180) * Math.cos((l.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    assert.ok(d <= radius + 1, `偏移 ${d.toFixed(1)}m 超出半径 ${radius}m`);
  }
  assert.ok(seen.size > 20, `25 次应产生不同落点, 实际 ${seen.size} 个`);
});

test("无法识别的 body: 原样放行而不是返回半成品", async () => {
  const junk = Array.from({ length: 400 }, (_, i) => (i * 31 + 7) & 0xff);
  const { done } = runScript(SCRIPT, {
    platform: "Shadowrocket",
    argument: argOf(TARGET.lat, TARGET.lon),
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(junk),
  });
  const resp = unwrap(await done);
  assert.deepEqual(Array.from(resp.body), junk, "改写失败时必须原样返回");
});

test("空 body: 不崩, 原样返回", async () => {
  const { done } = runScript(SCRIPT, {
    platform: "Stash",
    argument: argOf(TARGET.lat, TARGET.lon),
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: { status: 200, headers: {}, body: new Uint8Array() },
  });
  const payload = await done;
  assert.equal(payload.status, 200);
  assert.equal(payload.body.length, 0);
});

test("只有基站没有 WiFi 的响应也要能改", async () => {
  const body = buildBody({ cells: [{ lat: REAL.lat, lon: REAL.lon, acc: 1200 }] });
  const { done } = runScript(SCRIPT, {
    platform: "Shadowrocket",
    argument: argOf(TARGET.lat, TARGET.lon),
    request: { url: "https://gsp-ssl.ls.apple.com/clls/wloc", headers: {} },
    response: makeResponse(body),
  });
  const locs = readLocations(unwrap(await done).body);
  assert.ok(locs.length >= 1);
  assert.equal(locs[0].lon.toFixed(6), TARGET.lon.toFixed(6));
});

test("MAC 不合法的条目不当作 WiFi 改写", async () => {
  // field 1 是普通字符串而非 MAC —— 这类子消息在真实响应里很多, 不能误伤
  const notWifi = buildBody({ wifis: [{ mac: "hello-world", lat: REAL.lat, lon: REAL.lon, acc: 40 }] });
  const { done } = runScript(SCRIPT, {
    platform: "Shadowrocket",
    argument: argOf(TARGET.lat, TARGET.lon),
    request: { url: "https://gs-loc.apple.com/clls/wloc", headers: {} },
    response: makeResponse(notWifi),
  });
  const resp = unwrap(await done);
  assert.deepEqual(Array.from(resp.body), notWifi, "非 WiFi 条目不得被改写");
});
