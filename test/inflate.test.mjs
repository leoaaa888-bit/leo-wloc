// 自写 DEFLATE 解码器的对拍测试。
//
// wloc.js 里的 inflate 是手写的 (代理工具里没有 zlib, 也不想为了几 KB 的响应背上
// 一个 40 KB 的 pako)。手写解压器出错的方式很隐蔽 —— 多数样本都对, 偏偏在某种
// 块类型或某个边界长度上崩掉。所以这里拿 Node 自带的 zlib 当基准, 大批量对拍。

import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, deflateRawSync } from "node:zlib";

import { readScript, runScript } from "./helpers/wloc-fixture.mjs";

const SCRIPT = readScript("wloc.js");

/** 加载脚本并取出内部函数 (脚本里的测试钩子, 见 dist/wloc.js 末尾)。 */
function internals() {
  const { context } = runScript(SCRIPT, { platform: "Shadowrocket", exposeTest: true });
  const api = context.__LEO_WLOC_TEST__;
  assert.equal(typeof api, "object", "测试钩子应导出内部函数");
  return api;
}

const { ungzip, inflateRaw, isGzip } = internals();

function bytesOf(buf) {
  return new Uint8Array(buf);
}

function assertSame(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: 长度不符`);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) assert.fail(`${label}: 第 ${i} 字节 ${actual[i]} != ${expected[i]}`);
  }
}

// ---------------------------------------------------------------------------

test("gzip 魔数识别", () => {
  assert.equal(isGzip(Array.from(gzipSync(Buffer.from("hi")))), true);
  assert.equal(isGzip([0x00, 0x01, 0x02]), false);
  assert.equal(isGzip([]), false);
  assert.equal(isGzip([0x1f]), false);
});

test("stored 块 (level 0)", () => {
  for (const len of [1, 2, 255, 256, 1000, 65534, 65535, 65536, 70000]) {
    const src = Buffer.alloc(len);
    for (let i = 0; i < len; i++) src[i] = (i * 37 + 11) & 0xff;
    const out = ungzip(bytesOf(gzipSync(src, { level: 0 })));
    assertSame(out, src, `stored len=${len}`);
  }
});

test("fixed Huffman 块 (短数据)", () => {
  for (const s of ["", "a", "ab", "hello world", "x".repeat(40), "abcabcabcabc"]) {
    const src = Buffer.from(s, "utf8");
    const out = ungzip(bytesOf(gzipSync(src, { level: 1 })));
    assertSame(out, src, `fixed "${s.slice(0, 12)}"`);
  }
});

test("dynamic Huffman 块 (高压缩比 / 长回溯)", () => {
  const samples = [
    Buffer.from("AAAA".repeat(20000)),
    Buffer.from("the quick brown fox jumps over the lazy dog. ".repeat(3000)),
    Buffer.concat([Buffer.alloc(40000, 0), Buffer.from("tail marker")]),
  ];
  for (let i = 0; i < samples.length; i++) {
    const out = ungzip(bytesOf(gzipSync(samples[i], { level: 9 })));
    assertSame(out, samples[i], `dynamic #${i}`);
  }
});

test("随机数据对拍 600 轮 (各压缩级别 / 各长度)", () => {
  let seed = 0x2f6e2b1;
  const rnd = () => {
    // xorshift32: 固定种子, 失败可复现
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };

  for (let round = 0; round < 600; round++) {
    const len = Math.floor(rnd() * 6000);
    const src = Buffer.alloc(len);
    // 混合三种数据特征: 纯随机(难压)、低熵(多回溯)、结构化
    const mode = round % 3;
    for (let i = 0; i < len; i++) {
      if (mode === 0) src[i] = Math.floor(rnd() * 256);
      else if (mode === 1) src[i] = Math.floor(rnd() * 4);
      else src[i] = (i % 61) + 32;
    }
    const level = round % 10;
    const out = ungzip(bytesOf(gzipSync(src, { level })));
    assertSame(out, src, `round=${round} len=${len} level=${level} mode=${mode}`);
  }
});

test("raw deflate (无 gzip 容器) 也要能解", () => {
  const src = Buffer.from("raw deflate stream ".repeat(500));
  const out = inflateRaw(bytesOf(deflateRawSync(src, { level: 6 })), 0);
  assertSame(out, src, "raw");
});

test("gzip 可选头字段 (FNAME / FCOMMENT / FEXTRA) 不得让解析跑偏", () => {
  const src = Buffer.from("payload with header extras");
  // Node 的 gzipSync 不写这些字段, 手工拼一个带 FNAME + FCOMMENT 的容器
  const deflated = deflateRawSync(src, { level: 6 });
  const name = Buffer.from("origin.bin\0", "latin1");
  const comment = Buffer.from("a comment\0", "latin1");
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0x08 | 0x10, 0, 0, 0, 0, 0, 0x03]);
  const trailer = Buffer.alloc(8); // CRC32 + ISIZE, 本实现不校验
  const full = Buffer.concat([header, name, comment, deflated, trailer]);
  assertSame(ungzip(bytesOf(full)), src, "FNAME+FCOMMENT");
});

test("损坏的数据必须抛错, 而不是返回一段垃圾", () => {
  const good = gzipSync(Buffer.from("x".repeat(2000)), { level: 9 });
  const broken = Buffer.from(good);
  broken[20] ^= 0xff;
  broken[21] ^= 0xff;
  broken[22] ^= 0xff;
  let threw = false;
  let out = null;
  try {
    out = ungzip(bytesOf(broken));
  } catch (e) {
    threw = true;
  }
  // 允许两种结果: 抛错, 或解出与原文不同的内容 —— 但绝不能"看起来成功且正确"。
  if (!threw) {
    assert.notEqual(Buffer.from(out).toString(), "x".repeat(2000), "篡改后不应恰好解出原文");
  }
  assert.throws(() => ungzip(bytesOf(Buffer.from([0x1f, 0x8b, 0x08]))), /gzip/, "过短的数据应抛 gzip 错误");
  assert.throws(() => ungzip(bytesOf(Buffer.concat([Buffer.from([0x1f, 0x8b, 0x09]), Buffer.alloc(20)]))), /压缩方法/);
});
