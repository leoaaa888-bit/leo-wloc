// 测试夹具: 用一套独立于被测代码的编解码器拼出 WLOC 响应体。
//
// 刻意不复用 dist/wloc.js 里的 encodeVarint —— 拿被测实现去生成被测输入, 两边
// 一起错的时候测试反而是绿的。这里的实现按 protobuf 规范另写一遍。

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function readScript(name) {
  return readFileSync(resolve(ROOT, "dist", name), "utf8");
}

// ---- protobuf 编码 (独立实现) ----

export function varint(n) {
  let v = Math.floor(n);
  const out = [];
  if (v < 0) {
    // int64 补码: 用 BigInt 走一条与被测代码完全不同的路径
    let b = BigInt.asUintN(64, BigInt(v));
    for (let i = 0; i < 10; i++) {
      const byte = Number(b & 0x7fn);
      b >>= 7n;
      out.push(i === 9 ? byte : byte | 0x80);
    }
    return out;
  }
  do {
    const byte = v % 128;
    v = Math.floor(v / 128);
    out.push(v > 0 ? byte | 0x80 : byte);
  } while (v > 0);
  return out;
}

export function field(no, wire, payload) {
  const key = varint(no * 8 + wire);
  if (wire === 0) return [...key, ...varint(payload)];
  if (wire === 2) return [...key, ...varint(payload.length), ...payload];
  throw new Error("fixture: 未实现的 wire type " + wire);
}

const SCALE = 1e8;

/** 位置子消息: field1=纬度*1e8, field2=经度*1e8, field3=精度 */
export function location(lat, lon, acc = 65) {
  return [...field(1, 0, Math.round(lat * SCALE)), ...field(2, 0, Math.round(lon * SCALE)), ...field(3, 0, acc)];
}

export function wifiEntry(mac, lat, lon, acc) {
  const macBytes = [...mac].map((c) => c.charCodeAt(0));
  return [...field(1, 2, macBytes), ...field(2, 2, location(lat, lon, acc))];
}

export function cellEntry(lat, lon, acc) {
  return [...field(1, 0, 460), ...field(5, 2, location(lat, lon, acc))];
}

/**
 * 完整响应体。
 * 结构: [prefix 字节][8 字节][2 字节大端载荷长度][protobuf 载荷][suffix]
 * prefixLen 指的是 2 字节长度字段之前、除去那 8 字节的头部长度。
 */
export function buildBody({ wifis = [], cells = [], prefixLen = 2, suffix = [] } = {}) {
  const payload = [];
  for (const w of wifis) payload.push(...field(2, 2, wifiEntry(w.mac, w.lat, w.lon, w.acc)));
  for (const c of cells) payload.push(...field(22, 2, cellEntry(c.lat, c.lon, c.acc)));
  const head = new Array(prefixLen + 8).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
  return [...head, (payload.length >> 8) & 0xff, payload.length & 0xff, ...payload, ...suffix];
}

// ---- protobuf 解码 (只够读回坐标) ----

function readVarint(b, p) {
  let v = 0n;
  let shift = 0n;
  for (;;) {
    const byte = b[p++];
    v |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7n;
    if (shift > 70n) throw new Error("fixture: varint 过长");
  }
  return [BigInt.asIntN(64, v), p];
}

function scan(bytes) {
  const out = [];
  let p = 0;
  while (p < bytes.length) {
    const [key, afterKey] = readVarint(bytes, p);
    p = afterKey;
    const no = Number(key) >> 3;
    const wire = Number(key) & 7;
    if (wire === 0) {
      const [v, next] = readVarint(bytes, p);
      out.push({ no, wire, v });
      p = next;
    } else if (wire === 2) {
      const [len, next] = readVarint(bytes, p);
      p = next;
      out.push({ no, wire, v: bytes.slice(p, p + Number(len)) });
      p += Number(len);
    } else {
      throw new Error("fixture: 未实现的 wire type " + wire);
    }
  }
  return out;
}

/** 从完整响应体里读回所有位置点, 返回 [{lat, lon, acc}]。 */
export function readLocations(body) {
  const bytes = Array.from(body);
  const prefixLen = bytes.length;
  // 与 buildBody 对称: 找到 2 字节长度字段的位置需要知道 prefix, 但测试里我们
  // 直接暴力试每个偏移, 拿第一个能解出位置点的结果 —— 这与被测代码的定位方式
  // 无关, 它只要求「最终字节里能读出正确坐标」。
  for (let base = 0; base + 10 <= prefixLen; base++) {
    const len = (bytes[base + 8] << 8) | bytes[base + 9];
    if (len <= 0 || base + 10 + len > bytes.length) continue;
    try {
      const found = [];
      for (const f of scan(bytes.slice(base + 10, base + 10 + len))) {
        if (f.wire !== 2) continue;
        for (const inner of scan(f.v)) {
          if (inner.wire !== 2) continue;
          let loc = null;
          try {
            loc = scan(inner.v);
          } catch (e) {
            continue;
          }
          const lat = loc.find((x) => x.no === 1 && x.wire === 0);
          const lon = loc.find((x) => x.no === 2 && x.wire === 0);
          const acc = loc.find((x) => x.no === 3 && x.wire === 0);
          if (lat && lon) {
            found.push({
              lat: Number(lat.v) / SCALE,
              lon: Number(lon.v) / SCALE,
              acc: acc ? Number(acc.v) : null,
            });
          }
        }
      }
      if (found.length) return found;
    } catch (e) {
      /* 这个偏移不是帧起点, 换下一个 */
    }
  }
  return [];
}

// ---- 在各代理平台的模拟环境里跑脚本 ----

const PLATFORM_GLOBALS = {
  Surge: () => ({ $environment: { "surge-version": "5.9.0" }, $httpClient: {} }),
  Shadowrocket: () => ({ $rocket: {}, $environment: { "surge-version": "2.2.30" } }),
  Loon: () => ({ $loon: "Loon 3.2.5" }),
  Stash: () => ({ $environment: { "stash-version": "3.2.5" } }),
  "Quantumult X": () => ({ $task: {} }),
  Egern: () => ({ Egern: {} }),
};

export const PLATFORMS = Object.keys(PLATFORM_GLOBALS);

/**
 * 在模拟平台环境里执行一段脚本, 返回 $done 收到的 payload。
 * store 是一个普通对象, 充当 $persistentStore / $prefs 的后端。
 */
export function runScript(source, { platform, argument, request, response, store = {}, exposeTest = false } = {}) {
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  const persistent = {
    read: (k) => (k in store ? store[k] : null),
    write: (v, k) => {
      store[k] = v;
      return true;
    },
  };
  const prefs = {
    valueForKey: (k) => (k in store ? store[k] : null),
    setValueForKey: (v, k) => {
      store[k] = v;
      return true;
    },
    removeValueForKey: (k) => {
      delete store[k];
      return true;
    },
  };

  const ctx = {
    console: { log() {} },
    setTimeout,
    clearTimeout,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Math,
    JSON,
    Date,
    Map,
    Number,
    String,
    Array,
    Object,
    Error,
    RegExp,
    BigInt,
    decodeURIComponent,
    encodeURIComponent,
    parseFloat,
    parseInt,
    isFinite,
    isNaN,
    Promise,
    $script: { startTime: Date.now() },
    $persistentStore: persistent,
    $prefs: prefs,
    $done: (payload) => resolveDone(payload),
    ...PLATFORM_GLOBALS[platform](),
  };
  if (argument !== undefined) ctx.$argument = argument;
  if (request !== undefined) ctx.$request = request;
  if (response !== undefined) ctx.$response = response;
  if (exposeTest) ctx.__LEO_WLOC_TEST__ = true;

  const context = vm.createContext(ctx);
  vm.runInContext(source, context, { timeout: 5000 });

  return {
    context,
    store,
    done: Promise.race([
      done,
      new Promise((_, reject) => setTimeout(() => reject(new Error("脚本未调用 $done")), 4000)),
    ]),
  };
}
