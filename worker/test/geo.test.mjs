// 坐标换算测试。
//
// 最重要的一条是最后那个「注入页面的实现与服务端逐点一致」—— geo-browser.js 是
// 手工镜像的, 没有这条测试, 两边漂开了也不会有任何征兆, 只会表现为用户在高德
// 底图上选点偏几百米。

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  wgs84ToGcj02,
  gcj02ToWgs84,
  bd09ToGcj02,
  bd09mcToBd09,
  toWgs84,
  usesWgs84Locally,
  round6,
  inRange,
} from "../src/geo.js";
import { GEO_BROWSER_JS } from "../src/geo-browser.js";
import { extractBaiduFromBody } from "../src/parse.js";

// 球面距离 (米)
function distance(aLat, aLon, bLat, bLon) {
  const R = 6378137;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------

test("inRange / round6", () => {
  assert.equal(inRange(22.5, 113.9), true);
  assert.equal(inRange(91, 113.9), false);
  assert.equal(inRange(22.5, 181), false);
  assert.equal(inRange(NaN, 0), false);
  assert.equal(inRange(0, Infinity), false);
  assert.equal(round6(22.5445771234), 22.544577);
  assert.equal(round6(-113.9411449), -113.941145);
});

test("gcj02ToWgs84 是 wgs84ToGcj02 的逆运算, 残差 < 0.1 米", () => {
  const points = [
    [22.544577, 113.94114], // 深圳
    [39.9042, 116.4074], // 北京
    [31.2304, 121.4737], // 上海
    [43.8256, 87.6168], // 乌鲁木齐
    [18.2528, 109.5119], // 三亚
    [45.8038, 126.5349], // 哈尔滨
    [29.6516, 91.1721], // 拉萨
  ];
  for (const [lat, lon] of points) {
    const g = wgs84ToGcj02(lat, lon);
    const back = gcj02ToWgs84(g.lat, g.lon);
    const err = distance(lat, lon, back.lat, back.lon);
    assert.ok(err < 0.1, `(${lat},${lon}) 残差 ${err.toFixed(4)}m 超过 0.1m`);
  }
});

test("GCJ 偏移量量级合理 (大陆几百米)", () => {
  const g = wgs84ToGcj02(22.544577, 113.94114);
  const d = distance(22.544577, 113.94114, g.lat, g.lon);
  assert.ok(d > 100 && d < 1000, `深圳偏移 ${d.toFixed(0)}m 不在预期量级`);
});

test("境外坐标不做 GCJ 换算 (out_of_china)", () => {
  for (const [lat, lon] of [
    [37.7749, -122.4194], // 旧金山
    [35.6812, 139.7671], // 东京
    [-33.8568, 151.2153], // 悉尼
    [51.5074, -0.1278], // 伦敦
  ]) {
    assert.deepEqual(wgs84ToGcj02(lat, lon), { lat, lon });
    assert.deepEqual(gcj02ToWgs84(lat, lon), { lat, lon });
  }
});

test("百度 BD09MC -> BD09 -> WGS84 全链路 (基准: 深圳万象天地)", () => {
  // 百度网页版 URL 里的米制坐标
  const bd = bd09mcToBd09(12686385.66, 2560876.53);
  assert.ok(bd, "应落在系数表覆盖范围内");
  const wgs = toWgs84(bd.lat, bd.lon, "baidu");
  // 实测 GPS 基准。三步换算 (BD09MC -> BD09 -> GCJ02 -> WGS84) 任何一步写错都会
  // 偏出公里级, 30 米的容差只留给百度针脚本身的定位误差。
  const err = distance(wgs.lat, wgs.lon, 22.544865, 113.951072);
  assert.ok(err < 30, `全链路误差 ${err.toFixed(1)}m, 应 < 30m`);
});

test("百度: 标准 Web 墨卡托逆算是错的, 必须走分段多项式", () => {
  const bd = bd09mcToBd09(12686385.66, 2560876.53);
  // 标准 Web 墨卡托的逆算
  const naiveLon = (12686385.66 / 20037508.34) * 180;
  const naiveLat =
    (180 / Math.PI) * (2 * Math.atan(Math.exp(((2560876.53 / 20037508.34) * 180 * Math.PI) / 180)) - Math.PI / 2);
  const gap = distance(bd.lat, bd.lon, naiveLat, naiveLon);
  assert.ok(gap > 3000, `两种算法应明显不同, 实际只差 ${gap.toFixed(0)}m —— 说明用错了公式`);
});

test("百度: bd09mcToBd09 本身不做量级判断, 守卫在调用点", () => {
  // 30.2 米和 0.00027 度在数学上就是同一个东西, 这个函数没有上下文去区分,
  // 所以它照算不误 —— 这是刻意的分工。
  const out = bd09mcToBd09(120.5, 30.2);
  assert.ok(out && Math.abs(out.lat) < 0.01, "小输入会得到近零的度数");
  // 超出系数表覆盖范围 (ay 大于最高一档) 才返回 null
  assert.equal(bd09mcToBd09(1e9, 1e9), null);
});

test("百度: 像素级 x/y 不得被正文扫描当成坐标", () => {
  // 真正的守卫在 extractBaiduFromBody 里 (要求量级 > 1e5), 这里验证它生效
  assert.equal(extractBaiduFromBody('{"x":"320.5","y":"240.25"}'), null);
  assert.ok(extractBaiduFromBody('{"x":"12686385.66","y":"2560876.53"}'), "真实米制坐标应被识别");
});

test("bd09ToGcj02 偏移量在百米量级", () => {
  const g = bd09ToGcj02(22.5404, 113.9312);
  const d = distance(22.5404, 113.9312, g.lat, g.lon);
  assert.ok(d > 50 && d < 2000, `BD->GCJ 偏移 ${d.toFixed(0)}m 不在预期量级`);
});

// ---------------------------------------------------------------------------
// 港澳台: 按「来源 x 地区」分派
// ---------------------------------------------------------------------------

const HK = [22.284774, 114.159437]; // ifc mall
const MO = [22.148148, 113.555399]; // Galaxy Macau
const TW = [25.033626, 121.564215]; // 台北 101

test("港澳台: 苹果 / Google 发的是 WGS84, 不得再做 GCJ 反算", () => {
  for (const [lat, lon] of [HK, MO, TW]) {
    for (const src of ["apple", "google"]) {
      assert.deepEqual(toWgs84(lat, lon, src), { lat, lon }, `${src} @ ${lat},${lon}`);
    }
  }
});

test("港澳台: 高德 / 百度仍是偏移坐标, 必须继续换算", () => {
  for (const [lat, lon] of [HK, MO, TW]) {
    const out = toWgs84(lat, lon, "amap");
    const moved = distance(lat, lon, out.lat, out.lon);
    assert.ok(moved > 100, `高德 @ ${lat},${lon} 应被换算, 实际只动了 ${moved.toFixed(0)}m`);
  }
});

test("香港边界: 深圳一侧必须仍按大陆处理", () => {
  // 深圳南山 / 福田 / 罗湖 —— 任何包住香港的矩形都会误伤这几处
  for (const [lat, lon] of [
    [22.5431, 113.9435], // 南山
    [22.5461, 114.0546], // 福田
    [22.5554, 114.1215], // 罗湖
    [22.6067, 114.0175], // 龙华方向
  ]) {
    assert.equal(usesWgs84Locally(lat, lon, "apple"), false, `${lat},${lon} 应按大陆处理`);
    const out = toWgs84(lat, lon, "apple");
    assert.ok(distance(lat, lon, out.lat, out.lon) > 100, `${lat},${lon} 应做 GCJ 反算`);
  }
});

test("香港边界: 香港一侧必须按 WGS84 处理", () => {
  for (const [lat, lon] of [
    [22.284774, 114.159437], // 中环
    [22.3193, 114.1694], // 旺角
    [22.2793, 114.1628], // 湾仔
    [22.3964, 114.1095], // 沙田
    [22.2088, 113.9446], // 大屿山
  ]) {
    assert.equal(usesWgs84Locally(lat, lon, "apple"), true, `${lat},${lon} 应按 WGS84 处理`);
  }
});

test("港澳台判定不得波及大陆其它城市", () => {
  for (const [lat, lon] of [
    [23.1291, 113.2644], // 广州
    [24.4798, 118.0894], // 厦门
    [25.0389, 102.7183], // 昆明
    [31.2304, 121.4737], // 上海
  ]) {
    assert.equal(usesWgs84Locally(lat, lon, "apple"), false, `${lat},${lon} 不应被当成港澳台`);
  }
});

test("text 源 (用户直接输入的裸坐标) 不做任何换算", () => {
  assert.deepEqual(toWgs84(22.5, 113.9, "text"), { lat: 22.5, lon: 113.9 });
});

// ---------------------------------------------------------------------------
// 服务端 / 浏览器 两份实现必须一致
// ---------------------------------------------------------------------------

test("注入页面的 GCJ 实现与服务端逐点一致", () => {
  const ctx = vm.createContext({ Math });
  vm.runInContext(GEO_BROWSER_JS + "\n;globalThis.__w = wgs84ToGcj02; globalThis.__g = gcj02ToWgs84;", ctx);
  const browserW = ctx.__w;
  const browserG = ctx.__g;

  let checked = 0;
  for (let lat = 18; lat <= 53; lat += 1.7) {
    for (let lon = 73; lon <= 135; lon += 2.3) {
      const a = wgs84ToGcj02(lat, lon);
      const b = browserW(lat, lon);
      assert.equal(b.lat, a.lat, `wgs84ToGcj02 纬度分歧 @ ${lat},${lon}`);
      assert.equal(b.lon, a.lon, `wgs84ToGcj02 经度分歧 @ ${lat},${lon}`);

      const c = gcj02ToWgs84(lat, lon);
      const d = browserG(lat, lon);
      assert.equal(d.lat, c.lat, `gcj02ToWgs84 纬度分歧 @ ${lat},${lon}`);
      assert.equal(d.lon, c.lon, `gcj02ToWgs84 经度分歧 @ ${lat},${lon}`);
      checked++;
    }
  }
  // 境外点也要比 —— out_of_china 的短路分支同样可能写歪。
  // 注意不能用 deepEqual: vm 里造出来的对象来自另一个 realm, 原型不同, 严格深比较
  // 一定失败。这里要比的是数值, 不是对象身份。
  for (const [lat, lon] of [
    [37.7749, -122.4194],
    [35.6812, 139.7671],
    [-33.8568, 151.2153],
  ]) {
    const sw = wgs84ToGcj02(lat, lon);
    const bw = browserW(lat, lon);
    assert.equal(bw.lat, sw.lat);
    assert.equal(bw.lon, sw.lon);
    const sg = gcj02ToWgs84(lat, lon);
    const bg = browserG(lat, lon);
    assert.equal(bg.lat, sg.lat);
    assert.equal(bg.lon, sg.lon);
  }
  assert.ok(checked > 400, `采样点太少 (${checked}), 覆盖不足`);
});
