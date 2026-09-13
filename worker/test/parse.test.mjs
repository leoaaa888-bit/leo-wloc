// 链接解析测试。全部离线 —— 只测「从一段字符串里认坐标」这一层, 不发任何网络请求。
//
// 这里大部分用例针对的是「认错了」而不是「没认出来」。没认出来用户会看到提示,
// 认错了会把设备定位悄悄挪到别处, 后者危险得多。

import test from "node:test";
import assert from "node:assert/strict";

import { extractFromString, extractBaiduFromBody, safeDecode } from "../src/parse.js";
import { toWgs84 } from "../src/geo.js";

function distance(a, b) {
  const R = 6378137;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function near(hit, expect, tol = 1e-6) {
  assert.ok(hit, "未解析出坐标");
  assert.ok(Math.abs(hit.lat - expect.lat) < tol, `纬度 ${hit.lat} != ${expect.lat}`);
  assert.ok(Math.abs(hit.lon - expect.lon) < tol, `经度 ${hit.lon} != ${expect.lon}`);
  if (expect.src) assert.equal(hit.src, expect.src);
}

// ---------------------------------------------------------------------------
// 苹果地图
// ---------------------------------------------------------------------------

test("苹果地图: coordinate= / ll= / sll=", () => {
  near(extractFromString("https://maps.apple.com/?ll=39.908823,116.39747&q=%E5%A4%A9%E5%AE%89%E9%97%A8"), {
    lat: 39.908823,
    lon: 116.39747,
    src: "apple",
  });
  near(extractFromString("https://maps.apple.com/?coordinate=22.284774,114.159437&name=ifc%20mall"), {
    lat: 22.284774,
    lon: 114.159437,
    src: "apple",
  });
  assert.equal(
    extractFromString("https://maps.apple.com/?coordinate=22.284774,114.159437&name=ifc%20mall").name,
    "ifc mall"
  );
});

test("ll= 必须有词边界, 否则 scroll= / pull= 都会被当成坐标", () => {
  // 这类参数在真实页面里很常见, 少了 (?:^|[?&]) 锚定就会命中
  assert.equal(extractFromString("https://example.com/?scroll=1.5000,2.5000", { allowBare: false }), null);
  assert.equal(extractFromString("https://example.com/?pull=12.3456,65.4321", { allowBare: false }), null);
  // 真正的 ll= 仍要认得
  near(extractFromString("https://x.com/a?foo=1&ll=31.2304,121.4737"), { lat: 31.2304, lon: 121.4737 });
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

test("Google: 取地点针脚 !3d!4d, 不取相机视口 @", () => {
  const u =
    "https://www.google.com/maps/place/Apple+Park/@37.3316851,-122.0round,17z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d37.3346888!4d-122.0089961";
  near(extractFromString(u), { lat: 37.3346888, lon: -122.0089961, src: "google" });
  assert.equal(extractFromString(u).name, "Apple Park");
});

test("Google: 没有针脚时才退回视口 @", () => {
  near(extractFromString("https://www.google.com/maps/@37.4391234,-122.0515788,11z"), {
    lat: 37.4391234,
    lon: -122.0515788,
    src: "google",
  });
});

// ---------------------------------------------------------------------------
// 高德
// ---------------------------------------------------------------------------

test("高德: ?p= 与 ?q= 两种分享形式", () => {
  near(extractFromString("https://uri.amap.com/marker?p=B0FFH1YQ9X,31.2304,121.4737,外滩,上海市"), {
    lat: 31.2304,
    lon: 121.4737,
    src: "amap",
  });
  assert.equal(extractFromString("https://uri.amap.com/marker?p=B0X,31.2304,121.4737,外滩,上海市").name, "外滩");
  near(extractFromString("https://surl.amap.com/x?q=22.544577,113.94114,深圳湾"), {
    lat: 22.544577,
    lon: 113.94114,
    src: "amap",
  });
});

test("高德 URI: lnglat= / position= 是「经度,纬度」序", () => {
  // 与其它所有规则相反 —— 解颠倒了会把深圳送到南极圈外
  near(extractFromString("https://uri.amap.com/marker?position=113.94114,22.544577&name=深圳湾"), {
    lat: 22.544577,
    lon: 113.94114,
    src: "amap",
  });
  near(extractFromString("https://uri.amap.com/navigation?lnglat=116.39747,39.908823"), {
    lat: 39.908823,
    lon: 116.39747,
  });
});

test("不得顺手支持 location= / center= —— 高德是 lon,lat 而百度是 lat,lng", () => {
  // 同名不同序, 一条规则必然解颠倒一家。宁可不认。
  assert.equal(extractFromString("https://api.map.baidu.com/x?location=22.544577,113.94114", { allowBare: false }), null);
});

// ---------------------------------------------------------------------------
// 百度
// ---------------------------------------------------------------------------

test("百度网页版 URL 里的 BD09MC: /poi/名称/@x,y,19z", () => {
  // 港澳台的百度分享短链在服务端拿不到坐标, 但用户在浏览器打开后地址栏会变成
  // 这个形式 —— 这是那条唯一走得通的路, 必须守住。x/y 为浏览器实测值。
  const cases = [
    ["香港 ifc", "12709535.375,2529761.45", { lat: 22.284774, lon: 114.159437 }, 100],
    ["台北 101", "13533702.855,2862107.79", { lat: 25.033626, lon: 121.564215 }, 100],
    ["澳门 Galaxy", "12642194.145,2513614.06", { lat: 22.148148, lon: 113.555399 }, 300],
  ];
  for (const [name, xy, truth, tol] of cases) {
    const hit = extractFromString(`https://map.baidu.com/poi/Apple/@${xy},19z?uid=abc`);
    assert.ok(hit, `${name} 未解析出坐标`);
    assert.equal(hit.src, "baidu");
    const d = distance(toWgs84(hit.lat, hit.lon, hit.src), truth);
    assert.ok(d < tol, `${name} 偏差 ${d.toFixed(0)}m, 应 < ${tol}m`);
  }
});

test("百度: 地名从路径里取, 并正确解码", () => {
  const hit = extractFromString(
    "https://map.baidu.com/poi/Apple%E5%8F%B0%E5%8C%97101/@13533702.855,2862107.79,19z"
  );
  assert.equal(hit.name, "Apple台北101");
});

test("百度的米制 @ 规则不得吃掉 Google 的经纬度 @", () => {
  // 两者都是 @a,b 形式, 靠位数区分: 墨卡托是 6~9 位整数, 经纬度是 1~3 位
  near(extractFromString("https://www.google.com/maps/@37.4391234,-122.0515788,11z"), {
    lat: 37.4391234,
    lon: -122.0515788,
    src: "google",
  });
  // 非百度域名的大数字 @ 不该被当成 BD09MC
  assert.equal(extractFromString("https://example.com/x/@12709535.375,2529761.45,19z", { allowBare: false }), null);
});

test("正文扫描必须关掉裸坐标兜底", () => {
  // 百度页面里真实存在的字段, 开着兜底就会静默返回一个错误坐标
  const body = '{"view_dir":"-0.8477,0.0000","zoom":19}';
  assert.equal(extractFromString(body, { allowBare: false }), null);
  // 同一段文本在允许兜底时会命中 —— 这正是为什么扫描正文必须关掉它
  assert.ok(extractFromString('{"a":"22.5445,113.9411"}'));
});

test("extractBaiduFromBody: 量级校验挡掉像素坐标", () => {
  assert.equal(extractBaiduFromBody('"x":"320","y":"480"'), null);
  const hit = extractBaiduFromBody('"x":"12686385.66","y":"2560876.53"');
  assert.ok(hit);
  assert.equal(hit.src, "baidu");
});

// ---------------------------------------------------------------------------
// 裸坐标与值域
// ---------------------------------------------------------------------------

test("裸坐标文本", () => {
  near(extractFromString("22.544577,113.94114"), { lat: 22.544577, lon: 113.94114, src: "text" });
  near(extractFromString("坐标: 31.2304, 121.4737 上海"), { lat: 31.2304, lon: 121.4737, src: "text" });
});

test("裸坐标需要足够的小数位, 避免把版本号之类的东西当坐标", () => {
  assert.equal(extractFromString("v1.23,4.56"), null, "小数位不足不应命中");
});

test("越界坐标一律不返回", () => {
  assert.equal(extractFromString("https://x.com/?ll=95.12345,120.12345"), null, "纬度 > 90");
  assert.equal(extractFromString("https://x.com/?ll=45.12345,200.12345"), null, "经度 > 180");
  assert.equal(extractFromString("999.1234,888.5678"), null);
});

test("空输入不崩", () => {
  assert.equal(extractFromString(""), null);
  assert.equal(extractFromString(null), null);
  assert.equal(extractFromString(undefined), null);
});

test("safeDecode 遇到坏转义不抛错", () => {
  assert.equal(safeDecode("%E4%B8%AD%E6%96%87"), "中文");
  assert.equal(safeDecode("a+b"), "a b");
  assert.equal(safeDecode("%zz"), "%zz", "非法转义应原样返回");
  assert.equal(safeDecode(""), "");
});

test("%2C 形式的逗号与真逗号等价", () => {
  near(extractFromString("https://maps.apple.com/?ll=39.908823%2C116.39747"), { lat: 39.908823, lon: 116.39747 });
});
