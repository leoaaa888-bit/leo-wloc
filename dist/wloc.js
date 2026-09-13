/*!
 * Leo WLOC · dist/wloc.js
 * 修改 Apple 网络定位 (gs-loc /clls/wloc) 响应中的坐标。
 *
 * 项目主页: https://github.com/leoaaa888-bit/leo-wloc
 * 许可证:   AGPL-3.0-or-later (见仓库 LICENSE)
 *
 * 本文件即源码本身 —— 没有构建步骤, 代理工具下载到的和仓库里的是同一份字节。
 * 想改行为直接改这个文件, 提交后模块下次刷新脚本即生效。
 *
 * 上游溯源: 实现思路参考已下线的 Yu9191/wloc (AGPL-3.0) 及其前身
 * proxypin-wloc-spoofer, 代码为独立重写, 详见 NOTICE.md。
 */

/* eslint-disable no-undef */
(() => {
  "use strict";

  const SCRIPT_NAME = "Leo WLOC";
  const SCRIPT_VERSION = "1.0.0";
  const STORE_KEY = "wloc_settings";

  // ==== SHARED RUNTIME BEGIN (与 wloc-settings.js 逐字节一致, 由 scripts/check.mjs 校验) ====

  /**
   * 运行平台探测。
   *
   * 顺序是有讲究的, 不要「整理」:
   *  - Shadowrocket 为兼容 Surge 模块, 自己也提供 $environment["surge-version"],
   *    所以必须先认 $rocket, 否则小火箭会被当成 Surge。
   *  - Stash 同样提供 $environment, 靠 stash-version 与 Surge 区分; 先判 Stash
   *    再判 Surge, 这样即使将来 Stash 补上 surge-version 也不会认错。
   */
  const PLATFORM = (() => {
    const has = (k) => k in globalThis;
    if (has("$task")) return "Quantumult X";
    if (has("$loon")) return "Loon";
    if (has("$rocket")) return "Shadowrocket";
    if (has("Egern")) return "Egern";
    const env = globalThis.$environment || {};
    if (env["stash-version"]) return "Stash";
    if (env["surge-version"]) return "Surge";
    if (typeof globalThis.$httpClient !== "undefined") return "Surge";
    if (globalThis.process && globalThis.process.versions && globalThis.process.versions.node) return "Node.js";
    return "Unknown";
  })();

  const LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4, all: 5 };

  const log = {
    level: LEVELS.info,
    setLevel(name) {
      const v = LEVELS[String(name || "").toLowerCase()];
      log.level = v === undefined ? LEVELS.info : v;
    },
    _emit(min, tag, args) {
      if (log.level < min) return;
      try {
        console.log("[" + SCRIPT_NAME + "]" + tag + " " + args.map((a) => (a && a.stack) || String(a)).join(" "));
      } catch (e) {
        /* 个别平台在 $done 之后写日志会抛, 吞掉即可 */
      }
    },
    error: (...a) => log._emit(LEVELS.error, "[E]", a),
    warn: (...a) => log._emit(LEVELS.warn, "[W]", a),
    info: (...a) => log._emit(LEVELS.info, "", a),
    debug: (...a) => log._emit(LEVELS.debug, "[D]", a),
  };

  /**
   * 持久化存储。
   *
   * 只走「写入 JSON 字符串」这一条路径, 不碰各平台的删除 API:
   * Surge 支持 $persistentStore.write(null, key) 真删除, 但 Loon / Stash /
   * Shadowrocket 不支持, 同一句「清除」在不同平台上行为会不一致。统一写入字符串
   * "null" 再在读取侧归一成 null, 五个平台表现完全相同。
   */
  const Store = {
    read(key) {
      let raw = null;
      try {
        raw = PLATFORM === "Quantumult X" ? $prefs.valueForKey(key) : $persistentStore.read(key);
      } catch (e) {
        log.debug("storage.read 失败: " + (e && e.message));
        return null;
      }
      if (raw === null || raw === undefined || raw === "") return null;
      if (typeof raw !== "string") return raw;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return raw;
      }
      return parsed === null ? null : parsed;
    },
    write(key, value) {
      // value === null 表示清除; 序列化成 "null" 写回去, read() 会归一成 null。
      const raw = typeof value === "string" ? value : JSON.stringify(value === undefined ? null : value);
      try {
        return PLATFORM === "Quantumult X"
          ? Boolean($prefs.setValueForKey(raw, key))
          : Boolean($persistentStore.write(raw, key));
      } catch (e) {
        log.error("storage.write 失败: " + (e && e.message));
        return false;
      }
    },
  };

  /** "a=1&b=2" -> Map。重复键取第一个, 与 URLSearchParams.get 的语义一致。 */
  function parseQuery(search) {
    const out = new Map();
    const body = String(search || "").replace(/^[?]/, "");
    const dec = (s) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch (e) {
        return s;
      }
    };
    for (const pair of body.split("&")) {
      if (!pair) continue;
      const i = pair.indexOf("=");
      const k = dec(i === -1 ? pair : pair.slice(0, i));
      const v = i === -1 ? "" : dec(pair.slice(i + 1));
      if (!out.has(k)) out.set(k, v);
    }
    return out;
  }

  /**
   * $argument 归一化。
   *
   * Surge / Shadowrocket / Stash / Loon 给的是 "k=v&k=v" 字符串, Egern 可能直接
   * 给对象。Quantumult X 的 rewrite_local 脚本不支持参数 —— 那边的坐标只能来自
   * 选点页面写入的持久化存储, 这是 QX 的机制限制, 不是本脚本的缺陷。
   */
  function parseArgument(arg) {
    if (!arg) return {};
    if (typeof arg === "object") return arg;
    const obj = {};
    for (const [k, v] of parseQuery(String(arg))) obj[k] = v;
    return obj;
  }

  /**
   * 把一个 response 对象交还给代理工具。
   *
   * 各家 $done 约定不同, 这是最容易踩坑的地方:
   *  - Quantumult X: 永远顶层 {status, headers, body}
   *  - Stash: http-response 脚本要顶层, http-request 脚本要 {response}
   *  - Surge / Loon / Shadowrocket / Egern: 一律 {response}
   * kind 就是用来区分中间那条的, 不要合并。
   */
  function finish(resp, kind) {
    const done = globalThis.$done || (() => {});
    if (!resp) return done({});
    if (PLATFORM === "Quantumult X") return done(resp);
    if (PLATFORM === "Stash" && kind === "response") return done(resp);
    return done({ response: resp });
  }

  // ==== SHARED RUNTIME END ====

  // ---------------------------------------------------------------------------
  // gzip / DEFLATE 解压
  // ---------------------------------------------------------------------------
  //
  // 为什么要自带解压: 代理工具是否已经替我们解掉 Content-Encoding 并不统一 ——
  // 多数情况下 body 到手已是明文, 但 binary-body-mode 下也见过原样透传 gzip 的。
  // 拿 gzip 字节当 protobuf 解会直接判成「没有可改的载荷」, 表现是脚本一声不吭地
  // 放行, 用户只看到定位没变。所以先按魔数判断, 是 gzip 就地解开。
  //
  // 实现是 RFC 1951 的直译 (zlib puff 那套朴素解码器)。WLOC 响应只有几 KB, 不需要
  // 查表加速; 朴素版胜在短、好读、好验证 —— test/inflate.test.mjs 会用 Node 的
  // zlib.gzipSync 生成上千条随机样本逐一比对。

  function isGzip(bytes) {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  }

  const LENGTH_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577,
  ];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const MAX_CODE_BITS = 15;

  /**
   * 规范 Huffman 表。
   * counts[len] 是该码长的码字个数; symbols 按 (码长, 符号值) 排序后平铺,
   * 解码时用 (码长, 该长度内的序号) 直接索引。
   */
  function buildHuffman(lengths) {
    const counts = new Array(MAX_CODE_BITS + 1).fill(0);
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;
    const offsets = new Array(MAX_CODE_BITS + 2).fill(0);
    for (let len = 1; len <= MAX_CODE_BITS; len++) offsets[len + 1] = offsets[len] + counts[len];
    const symbols = new Array(lengths.length).fill(0);
    for (let sym = 0; sym < lengths.length; sym++) {
      if (lengths[sym]) symbols[offsets[lengths[sym]]++] = sym;
    }
    return { counts, symbols };
  }

  function inflateRaw(src, start) {
    let pos = start;
    let bitBuf = 0;
    let bitCnt = 0;
    let out = new Uint8Array(Math.max(1024, (src.length - start) * 4));
    let outLen = 0;

    const grow = (need) => {
      if (outLen + need <= out.length) return;
      let cap = out.length;
      while (cap < outLen + need) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(out.subarray(0, outLen));
      out = next;
    };

    const bits = (n) => {
      if (n === 0) return 0;
      while (bitCnt < n) {
        if (pos >= src.length) throw new Error("deflate: 读取位串时数据提前结束");
        bitBuf |= src[pos++] << bitCnt;
        bitCnt += 8;
      }
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    };

    const decode = (huff) => {
      let code = 0;
      let first = 0;
      let index = 0;
      for (let len = 1; len <= MAX_CODE_BITS; len++) {
        code |= bits(1);
        const count = huff.counts[len];
        if (code - first < count) return huff.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error("deflate: 无效的 Huffman 码字");
    };

    let fixedLit = null;
    let fixedDist = null;
    const ensureFixed = () => {
      if (fixedLit) return;
      const lit = new Array(288);
      for (let i = 0; i < 144; i++) lit[i] = 8;
      for (let i = 144; i < 256; i++) lit[i] = 9;
      for (let i = 256; i < 280; i++) lit[i] = 7;
      for (let i = 280; i < 288; i++) lit[i] = 8;
      fixedLit = buildHuffman(lit);
      fixedDist = buildHuffman(new Array(30).fill(5));
    };

    for (;;) {
      const last = bits(1);
      const type = bits(2);

      if (type === 0) {
        // 非压缩块: 丢掉当前字节里剩余的位, 再读 LEN / NLEN。
        bitBuf = 0;
        bitCnt = 0;
        if (pos + 4 > src.length) throw new Error("deflate: stored 块头部不完整");
        const len = src[pos] | (src[pos + 1] << 8);
        const nlen = src[pos + 2] | (src[pos + 3] << 8);
        pos += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error("deflate: stored 块 LEN/NLEN 不匹配");
        if (pos + len > src.length) throw new Error("deflate: stored 块数据不完整");
        grow(len);
        out.set(src.subarray(pos, pos + len), outLen);
        outLen += len;
        pos += len;
      } else if (type === 1 || type === 2) {
        let litHuff;
        let distHuff;
        if (type === 1) {
          ensureFixed();
          litHuff = fixedLit;
          distHuff = fixedDist;
        } else {
          const hlit = bits(5) + 257;
          const hdist = bits(5) + 1;
          const hclen = bits(4) + 4;
          const clen = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = bits(3);
          const clenHuff = buildHuffman(clen);
          const lengths = new Array(hlit + hdist).fill(0);
          let i = 0;
          while (i < lengths.length) {
            const sym = decode(clenHuff);
            if (sym < 16) {
              lengths[i++] = sym;
            } else if (sym === 16) {
              if (i === 0) throw new Error("deflate: 重复码长出现在首位");
              const prev = lengths[i - 1];
              let rep = 3 + bits(2);
              while (rep-- > 0 && i < lengths.length) lengths[i++] = prev;
            } else if (sym === 17) {
              let rep = 3 + bits(3);
              while (rep-- > 0 && i < lengths.length) lengths[i++] = 0;
            } else {
              let rep = 11 + bits(7);
              while (rep-- > 0 && i < lengths.length) lengths[i++] = 0;
            }
          }
          litHuff = buildHuffman(lengths.slice(0, hlit));
          distHuff = buildHuffman(lengths.slice(hlit));
        }

        for (;;) {
          const sym = decode(litHuff);
          if (sym < 256) {
            grow(1);
            out[outLen++] = sym;
          } else if (sym === 256) {
            break;
          } else {
            const li = sym - 257;
            if (li >= LENGTH_BASE.length) throw new Error("deflate: 非法的长度码 " + sym);
            const length = LENGTH_BASE[li] + bits(LENGTH_EXTRA[li]);
            const di = decode(distHuff);
            if (di >= DIST_BASE.length) throw new Error("deflate: 非法的距离码 " + di);
            const dist = DIST_BASE[di] + bits(DIST_EXTRA[di]);
            if (dist > outLen) throw new Error("deflate: 回溯距离越过输出起点");
            grow(length);
            let from = outLen - dist;
            for (let n = 0; n < length; n++) out[outLen++] = out[from++];
          }
        }
      } else {
        throw new Error("deflate: 保留的块类型 3");
      }

      if (last) break;
    }

    return out.subarray(0, outLen);
  }

  /** 解开 gzip 容器 (RFC 1952) 后交给 inflateRaw。 */
  function ungzip(bytes) {
    if (bytes.length < 18) throw new Error("gzip: 数据太短");
    if (bytes[2] !== 8) throw new Error("gzip: 不支持的压缩方法 " + bytes[2]);
    const flg = bytes[3];
    let p = 10;
    if (flg & 0x04) {
      const xlen = bytes[p] | (bytes[p + 1] << 8); // FEXTRA
      p += 2 + xlen;
    }
    if (flg & 0x08) while (p < bytes.length && bytes[p++] !== 0); // FNAME
    if (flg & 0x10) while (p < bytes.length && bytes[p++] !== 0); // FCOMMENT
    if (flg & 0x02) p += 2; // FHCRC
    if (p >= bytes.length) throw new Error("gzip: 头部越界");
    return inflateRaw(bytes, p);
  }

  // ---------------------------------------------------------------------------
  // protobuf 最小编解码
  // ---------------------------------------------------------------------------
  //
  // 这里不做「按 .proto 解析成对象再序列化回去」那一套。WLOC 响应里有大量我们
  // 不认识、也没必要认识的字段, 全量重建会把未知字段的原始编码(比如非最短形式的
  // varint)悄悄改掉。所以策略是: 只扫描出字段边界, 命中要改的字段就替换, 其余
  // 一律按 raw 原样拼回去。

  /** 读一个 varint, 返回 [值, 下一个位置]。超过 56 位的部分丢弃 —— 只用于定位边界。 */
  function readVarint(bytes, pos) {
    let value = 0;
    let scale = 1;
    let shift = 0;
    while (pos < bytes.length) {
      const b = bytes[pos++] & 0xff;
      if (shift < 56) value += (b & 0x7f) * scale;
      if (!(b & 0x80)) return [value, pos];
      scale *= 128;
      shift += 7;
      if (shift >= 70) throw new Error("protobuf: varint 过长");
    }
    throw new Error("protobuf: varint 被截断");
  }

  /**
   * 写一个 varint。
   *
   * 负数必须按 int64 的补码展开成固定 10 字节 —— protobuf 对 int64 就是这么编的。
   * 南半球/西半球的坐标乘 1e8 之后就是负数, 少了这段, 整个南美和大洋洲都会写坏。
   * 不用 BigInt 是为了照顾老版本 JavaScriptCore, 手动拼位更稳妥。
   */
  function encodeVarint(num) {
    let n = Math.floor(num);
    if (n >= 0) {
      const out = [];
      while (n >= 128) {
        out.push((n % 128) | 0x80);
        n = Math.floor(n / 128);
      }
      out.push(n);
      return out;
    }
    // |n| 的小端 8 字节
    const le = [0, 0, 0, 0, 0, 0, 0, 0];
    let mag = -n;
    for (let i = 0; i < 8; i++) {
      le[i] = mag & 0xff;
      mag = Math.floor(mag / 256);
    }
    // 取反加一 -> 补码
    let carry = 1;
    for (let i = 0; i < 8; i++) {
      const v = (~le[i] & 0xff) + carry;
      le[i] = v & 0xff;
      carry = v >> 8;
    }
    // 64 位按每 7 位一组切成 10 字节
    const out = [];
    for (let g = 0; g < 10; g++) {
      let byte = 0;
      for (let b = 0; b < 7; b++) {
        const bit = g * 7 + b;
        if (bit < 64) byte |= ((le[bit >> 3] >> (bit & 7)) & 1) << b;
      }
      if (g < 9) byte |= 0x80;
      out.push(byte);
    }
    return out;
  }

  function concatBytes(chunks) {
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      for (let j = 0; j < c.length; j++) out.push(c[j] & 0xff);
    }
    return out;
  }

  function encodeField(fieldNo, wireType, value) {
    const key = encodeVarint(fieldNo * 8 + wireType);
    if (wireType === 0) return concatBytes([key, encodeVarint(value)]);
    if (wireType === 1 || wireType === 5) return concatBytes([key, value]);
    if (wireType === 2) return concatBytes([key, encodeVarint(value.length), value]);
    throw new Error("protobuf: 无法编码 wire type " + wireType);
  }

  /** 扫描出顶层字段。任何结构异常都抛错 —— 调用方拿它当「这段不是 protobuf」的信号。 */
  function scanFields(bytes) {
    const fields = [];
    let pos = 0;
    while (pos < bytes.length) {
      const start = pos;
      const [key, afterKey] = readVarint(bytes, pos);
      pos = afterKey;
      const fieldNo = Math.floor(key / 8);
      const wireType = key & 7;
      if (fieldNo === 0) throw new Error("protobuf: 非法字段号 0 @" + start);
      let value;
      if (wireType === 0) {
        const [v, next] = readVarint(bytes, pos);
        value = v;
        pos = next;
      } else if (wireType === 1) {
        if (pos + 8 > bytes.length) throw new Error("protobuf: fixed64 越界");
        value = bytes.slice(pos, pos + 8);
        pos += 8;
      } else if (wireType === 2) {
        const [len, next] = readVarint(bytes, pos);
        pos = next;
        if (pos + len > bytes.length) throw new Error("protobuf: 长度前缀越界");
        value = bytes.slice(pos, pos + len);
        pos += len;
      } else if (wireType === 5) {
        if (pos + 4 > bytes.length) throw new Error("protobuf: fixed32 越界");
        value = bytes.slice(pos, pos + 4);
        pos += 4;
      } else {
        throw new Error("protobuf: 不支持的 wire type " + wireType);
      }
      fields.push({ fieldNo, wireType, value, raw: bytes.slice(start, pos) });
    }
    return fields;
  }

  // ---------------------------------------------------------------------------
  // WLOC 载荷改写
  // ---------------------------------------------------------------------------
  //
  // 响应体的结构 (逆向所得, 非公开协议):
  //   [若干字节头部][8 字节][2 字节大端载荷长度][protobuf 载荷][尾部]
  // 载荷里:
  //   field 2      -> WiFi 条目, 内含 field 1 = MAC 文本, field 2 = 位置子消息
  //   field 22/24  -> 基站条目, 内含 field 5 = 位置子消息
  //   位置子消息    -> field 1 = 纬度 x 1e8, field 2 = 经度 x 1e8, field 3 = 精度
  //
  // 坐标是「整数 x 1e8」而不是浮点, 这也是为什么负坐标必须走补码 varint。

  const COORD_SCALE = 1e8;

  function newStats() {
    return { wifi: 0, cell: 0, locations: 0, skipped: 0 };
  }
  function snapshotStats(s) {
    return { wifi: s.wifi, cell: s.cell, locations: s.locations, skipped: s.skipped };
  }
  function restoreStats(s, snap) {
    s.wifi = snap.wifi;
    s.cell = snap.cell;
    s.locations = snap.locations;
    s.skipped = snap.skipped;
  }
  function patchedCount(s, snap) {
    return s.locations - snap.locations + (s.wifi - snap.wifi) + (s.cell - snap.cell);
  }

  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * 位置子消息: 把 field 1/2/3 换成目标值。
   *
   * 先确认 field 1 与 field 2 都以 varint 形式存在才动手。少了这道判断, 任何
   * 恰好有 field 1 的子消息都会被当成坐标写坏 —— 响应里这样的子消息很多。
   */
  function patchLocation(bytes, target, stats) {
    const fields = scanFields(bytes);
    let hasLat = false;
    let hasLon = false;
    for (const f of fields) {
      if (f.fieldNo === 1 && f.wireType === 0) hasLat = true;
      if (f.fieldNo === 2 && f.wireType === 0) hasLon = true;
    }
    if (!hasLat || !hasLon) return bytes;

    const out = [];
    for (const f of fields) {
      if (f.fieldNo === 1 && f.wireType === 0) {
        out.push(encodeField(1, 0, Math.round(target.latitude * COORD_SCALE)));
      } else if (f.fieldNo === 2 && f.wireType === 0) {
        out.push(encodeField(2, 0, Math.round(target.longitude * COORD_SCALE)));
      } else if (f.fieldNo === 3 && f.wireType === 0) {
        out.push(encodeField(3, 0, target.accuracy));
      } else {
        out.push(f.raw);
      }
    }
    stats.locations++;
    return concatBytes(out);
  }

  const MAC_RE = /^[0-9a-fA-F]{1,2}(:[0-9a-fA-F]{1,2}){5}$/;

  /** WiFi 条目: 只有 field 1 长得像 MAC 地址才认, 否则原样放行。 */
  function patchWifiEntry(bytes, target, stats) {
    const fields = scanFields(bytes);
    let looksLikeWifi = false;
    for (const f of fields) {
      if (f.fieldNo === 1 && f.wireType === 2) {
        let s = "";
        for (let i = 0; i < f.value.length; i++) s += String.fromCharCode(f.value[i] & 0xff);
        looksLikeWifi = MAC_RE.test(s);
      }
    }
    if (!looksLikeWifi) return bytes;

    let changed = false;
    const out = [];
    for (const f of fields) {
      if (f.fieldNo === 2 && f.wireType === 2) {
        try {
          const next = patchLocation(f.value, target, stats);
          if (!bytesEqual(next, f.value)) changed = true;
          out.push(encodeField(f.fieldNo, f.wireType, next));
        } catch (e) {
          stats.skipped++;
          out.push(f.raw);
        }
      } else {
        out.push(f.raw);
      }
    }
    if (changed) stats.wifi++;
    return concatBytes(out);
  }

  /** 基站条目: 位置子消息挂在 field 5 上。 */
  function patchCellEntry(bytes, target, stats) {
    const fields = scanFields(bytes);
    let changed = false;
    const out = [];
    for (const f of fields) {
      if (f.fieldNo === 5 && f.wireType === 2) {
        try {
          const next = patchLocation(f.value, target, stats);
          if (!bytesEqual(next, f.value)) changed = true;
          out.push(encodeField(f.fieldNo, f.wireType, next));
        } catch (e) {
          stats.skipped++;
          out.push(f.raw);
        }
      } else {
        out.push(f.raw);
      }
    }
    if (changed) stats.cell++;
    return concatBytes(out);
  }

  function patchPayload(bytes, target, stats) {
    const fields = scanFields(bytes);
    const out = [];
    for (const f of fields) {
      if (f.wireType === 2 && f.fieldNo === 2) {
        out.push(encodeField(f.fieldNo, f.wireType, patchWifiEntry(f.value, target, stats)));
      } else if (f.wireType === 2 && (f.fieldNo === 22 || f.fieldNo === 24)) {
        out.push(encodeField(f.fieldNo, f.wireType, patchCellEntry(f.value, target, stats)));
      } else {
        out.push(f.raw);
      }
    }
    return concatBytes(out);
  }

  /**
   * 按「头部 + 2 字节长度 + 载荷」的帧格式在 base 处试着改写。
   *
   * 长度字段必须跟着载荷一起更新 —— 改完坐标后载荷长度几乎总会变(整数位数不同),
   * 沿用旧长度会让后半截响应整体错位, 设备侧直接判成响应损坏。
   */
  function patchFrameAt(bytes, base, target, stats) {
    if (bytes.length < base + 10) throw new Error("帧头不完整 @" + base);
    const payloadLen = ((bytes[base + 8] & 0xff) << 8) | (bytes[base + 9] & 0xff);
    if (payloadLen <= 0) throw new Error("空帧 @" + base);
    if (base + 10 + payloadLen > bytes.length) throw new Error("帧长 " + payloadLen + " 越界 @" + base);

    const head = bytes.slice(0, base + 8);
    const payload = bytes.slice(base + 10, base + 10 + payloadLen);
    const tail = bytes.slice(base + 10 + payloadLen);

    const snap = snapshotStats(stats);
    const patched = patchPayload(payload, target, stats);

    if (patched.length > 0xffff) {
      restoreStats(stats, snap);
      throw new Error("改写后载荷超出 16 位长度字段: " + patched.length);
    }
    if (patchedCount(stats, snap) <= 0 || bytesEqual(payload, patched)) {
      restoreStats(stats, snap);
      throw new Error("帧可解析但没有可改的 wloc 载荷 @" + base);
    }
    return concatBytes([head, [(patched.length >> 8) & 0xff, patched.length & 0xff], patched, tail]);
  }

  /**
   * 兜底: 不认帧头, 直接从某个偏移起把剩余字节当 protobuf 解。
   * 帧格式是逆向来的, Apple 换个头部长度就会全线失效; 这条路只认 protobuf 本身。
   */
  function patchRawScan(bytes, target, stats) {
    const errors = [];
    const limit = Math.min(256, bytes.length);
    for (let offset = 0; offset <= limit; offset++) {
      const snap = snapshotStats(stats);
      try {
        const rest = bytes.slice(offset);
        const patched = patchPayload(rest, target, stats);
        if (patchedCount(stats, snap) > 0 && !bytesEqual(rest, patched)) {
          return concatBytes([bytes.slice(0, offset), patched]);
        }
        restoreStats(stats, snap);
      } catch (e) {
        restoreStats(stats, snap);
        if (errors.length < 6) errors.push("raw@" + offset + ":" + (e && e.message ? e.message : e));
      }
    }
    throw new Error("裸 protobuf 扫描失败; " + errors.join(" | "));
  }

  function patchBody(bytes, target) {
    const stats = newStats();
    if (bytes.length < 10) throw new Error("响应体太短: " + bytes.length);

    // 常见的帧起点集中在前 16 字节的偶数位, 先试这些命中最快; 之后再逐字节扫。
    const offsets = [0, 2, 4, 6, 8, 10, 12, 14, 16];
    const scanTo = Math.min(96, Math.max(0, bytes.length - 10));
    for (let i = 0; i <= scanTo; i++) if (offsets.indexOf(i) < 0) offsets.push(i);

    const errors = [];
    for (const base of offsets) {
      const snap = snapshotStats(stats);
      try {
        const data = patchFrameAt(bytes, base, target, stats);
        log.info(
          "已改写 offset=" + base + " locations=" + stats.locations + " wifi=" + stats.wifi + " cell=" + stats.cell +
            " skipped=" + stats.skipped
        );
        return { data, stats };
      } catch (e) {
        restoreStats(stats, snap);
        if (errors.length < 6) errors.push("@" + base + ":" + (e && e.message ? e.message : e));
      }
    }

    try {
      const data = patchRawScan(bytes, target, stats);
      log.info(
        "已改写(裸扫描兜底) locations=" + stats.locations + " wifi=" + stats.wifi + " cell=" + stats.cell +
          " skipped=" + stats.skipped
      );
      return { data, stats };
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }

    throw new Error("未找到可改写的 wloc 载荷; " + errors.join(" | "));
  }

  // ---------------------------------------------------------------------------
  // 坐标扰动
  // ---------------------------------------------------------------------------

  const EARTH_RADIUS_M = 6378137;

  /**
   * 在目标点周围半径 radius 米内随机取一点。
   *
   * 半径用 sqrt(random) 而不是 random: 圆面积与半径平方成正比, 直接用 random
   * 会把点堆在圆心附近。方位角均匀, 沿大圆推算终点(球面直接公式), 高纬度也不会
   * 因为「每度经度的实际距离变短」而把扰动拉长。
   */
  function applyJitter(target) {
    const radius = Number(target.randomRadius);
    if (!Number.isFinite(radius) || radius <= 0) return target;

    const distance = Math.sqrt(Math.random()) * radius;
    const bearing = Math.random() * 2 * Math.PI;
    const angular = distance / EARTH_RADIUS_M;
    const lat1 = (target.latitude * Math.PI) / 180;
    const lon1 = (target.longitude * Math.PI) / 180;

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 =
      ((lon1 +
        Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)) +
        3 * Math.PI) %
        (2 * Math.PI)) -
      Math.PI;

    return {
      longitude: Number(((lon2 * 180) / Math.PI).toFixed(8)),
      latitude: Number(((lat2 * 180) / Math.PI).toFixed(8)),
      accuracy: target.accuracy,
      randomRadius: radius,
      jitterDistance: distance,
    };
  }

  // ---------------------------------------------------------------------------
  // 配置解析
  // ---------------------------------------------------------------------------
  //
  // 优先级(从低到高): 内置默认 < 模块参数 < 持久化存储(选点页面/快捷指令写入)
  //
  // 「哨兵坐标」这条规则需要解释: 模块订阅里自带一组示例坐标, 如果用户从没改过
  // 模块参数、又清掉了持久化数据, 那他的真实意图是「恢复真实定位」, 而不是
  // 「把我送到示例坐标去」。所以当参数恰好等于哨兵值且无持久化数据时进入透传。
  // 用户一旦在模块参数里填了自己的坐标, 这条规则就不触发, 清除数据后仍按参数走。

  const SENTINEL_LON = 113.94114;
  const SENTINEL_LAT = 22.544577;

  const DEFAULTS = {
    longitude: null,
    latitude: null,
    accuracy: 25,
    randomRadius: 0,
    logLevel: "info",
  };

  function resolveSettings() {
    const args = parseArgument(globalThis.$argument);
    const saved = Store.read(STORE_KEY);
    const cfg = {
      longitude: DEFAULTS.longitude,
      latitude: DEFAULTS.latitude,
      accuracy: DEFAULTS.accuracy,
      randomRadius: DEFAULTS.randomRadius,
      logLevel: DEFAULTS.logLevel,
    };

    // 1) 模块参数
    if (args.longitude) cfg.longitude = parseFloat(args.longitude);
    if (args.latitude) cfg.latitude = parseFloat(args.latitude);
    if (args.accuracy) cfg.accuracy = parseInt(args.accuracy, 10);
    if (args.randomRadius !== undefined) cfg.randomRadius = parseFloat(args.randomRadius);
    if (args.logLevel) cfg.logLevel = args.logLevel;
    if (args.LogLevel) cfg.logLevel = args.LogLevel;

    const fromArgs = { longitude: cfg.longitude, latitude: cfg.latitude };

    // 2) 持久化存储覆盖模块参数
    if (saved && typeof saved === "object") {
      if (saved.longitude) cfg.longitude = parseFloat(saved.longitude);
      if (saved.latitude) cfg.latitude = parseFloat(saved.latitude);
      if (saved.accuracy) cfg.accuracy = parseInt(saved.accuracy, 10);
      if (saved.randomRadius !== undefined) cfg.randomRadius = parseFloat(saved.randomRadius);
      cfg.source = "storage";
      log.info("使用已保存坐标: " + cfg.longitude + "," + cfg.latitude);
    } else if (fromArgs.longitude === SENTINEL_LON && fromArgs.latitude === SENTINEL_LAT) {
      cfg.longitude = null;
      cfg.latitude = null;
      cfg.source = "passthrough";
      log.info("透传模式: 无持久化坐标且模块参数为出厂示例值, 不修改定位");
      return cfg;
    } else {
      cfg.source = cfg.longitude === null || cfg.latitude === null ? "passthrough" : "argument";
    }

    if (cfg.longitude === null || cfg.latitude === null || !Number.isFinite(cfg.longitude) || !Number.isFinite(cfg.latitude)) {
      cfg.longitude = null;
      cfg.latitude = null;
      cfg.source = "passthrough";
      log.info("透传模式: 未设置坐标, 不修改定位响应");
    } else {
      log.debug(
        "lon=" + cfg.longitude + " lat=" + cfg.latitude + " acc=" + cfg.accuracy +
          " randomRadius=" + cfg.randomRadius + " source=" + cfg.source
      );
    }
    if (!Number.isFinite(cfg.accuracy) || cfg.accuracy <= 0) cfg.accuracy = DEFAULTS.accuracy;
    if (!Number.isFinite(cfg.randomRadius) || cfg.randomRadius < 0) cfg.randomRadius = 0;
    return cfg;
  }

  // ---------------------------------------------------------------------------
  // 主流程
  // ---------------------------------------------------------------------------

  /** 各平台给 body 的形态不一 (ArrayBuffer / TypedArray / 类数组 / binary string), 统一成字节数组。 */
  function toBytes(body) {
    if (!body) return [];
    if (typeof ArrayBuffer !== "undefined") {
      if (body instanceof ArrayBuffer) return Array.prototype.slice.call(new Uint8Array(body));
      if (ArrayBuffer.isView && ArrayBuffer.isView(body)) {
        return Array.prototype.slice.call(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
      }
    }
    if (typeof body === "string") {
      const out = [];
      for (let i = 0; i < body.length; i++) out.push(body.charCodeAt(i) & 0xff);
      return out;
    }
    if (typeof body.length === "number") {
      const out = [];
      for (let i = 0; i < body.length; i++) out.push(body[i] & 0xff);
      return out;
    }
    return [];
  }

  function handleResponse(request, response, cfg) {
    const url = (request && request.url) || "";
    log.debug("Response " + url);

    const input = toBytes(response.bodyBytes || response.rawBody || response.body);
    if (!input.length) {
      log.warn("无二进制 body, 跳过 (模块是否缺少 binary-body-mode?)");
      return response;
    }
    if (cfg.longitude === null || cfg.latitude === null) {
      log.info("透传模式: 未设置坐标, 原样放行 (恢复真实定位)");
      return response;
    }

    let raw = input;
    if (isGzip(input)) {
      log.debug("body 为 gzip, 长度 " + input.length + ", 就地解压");
      raw = Array.prototype.slice.call(ungzip(new Uint8Array(input)));
    }

    const target = applyJitter(cfg);
    const result = patchBody(raw, target);
    const out = new Uint8Array(result.data);

    response.body = out;
    response.bodyBytes = out;
    response.rawBody = out;
    if (response.headers) {
      // 载荷已经是明文且长度变了; 留着旧的 Content-Encoding / Content-Length
      // 会让设备按 gzip 去解一段明文, 直接判成响应损坏。
      delete response.headers["Content-Encoding"];
      delete response.headers["content-encoding"];
      delete response.headers["Transfer-Encoding"];
      delete response.headers["transfer-encoding"];
      response.headers["Content-Length"] = String(out.length);
    }
    response.status = 200;
    response.statusCode = 200;

    log.info(
      "目标坐标 " + target.longitude + "," + target.latitude +
        " 精度=" + target.accuracy + "m" +
        " 扰动=" + ((target.jitterDistance || 0).toFixed(1)) + "m" +
        " 改写点位=" + result.stats.locations
    );
    return response;
  }

  // 测试钩子。只有当宿主在加载脚本之前显式设置了 globalThis.__LEO_WLOC_TEST__
  // 才会导出内部函数 —— 代理工具里这个变量不存在, 这段等同于不存在。
  // 有了它, inflate / protobuf 这些纯函数可以被单元测试直接喂上千条样本, 而不必
  // 每次都拼一个完整的 WLOC 响应。
  if (globalThis.__LEO_WLOC_TEST__) {
    globalThis.__LEO_WLOC_TEST__ = {
      PLATFORM,
      Store,
      parseQuery,
      parseArgument,
      isGzip,
      ungzip,
      inflateRaw,
      readVarint,
      encodeVarint,
      encodeField,
      scanFields,
      patchLocation,
      patchPayload,
      patchBody,
      applyJitter,
      resolveSettings,
      SENTINEL_LON,
      SENTINEL_LAT,
    };
  }

  let outgoing;
  (async () => {
    const response = typeof $response !== "undefined" ? $response : undefined;
    if (!response) {
      log.warn("非响应模式, 跳过");
      return;
    }
    const cfg = resolveSettings();
    log.setLevel(cfg.logLevel);
    log.debug(SCRIPT_NAME + " v" + SCRIPT_VERSION + " on " + PLATFORM);
    try {
      outgoing = handleResponse(typeof $request !== "undefined" ? $request : {}, response, cfg);
    } catch (e) {
      // 失败必须原样放行。返回半成品 body 会让 locationd 认为响应损坏,
      // 比「没改成」更糟 —— 那会连真实定位一起坏掉。
      log.error("改写失败, 原样放行: " + ((e && e.message) || e));
      outgoing = response;
    }
  })()
    .catch((e) => {
      log.error((e && e.stack) || e);
      outgoing = typeof $response !== "undefined" ? $response : undefined;
    })
    .finally(() => {
      if (!outgoing || typeof outgoing !== "object") return finish(null, "response");
      const headers = outgoing.headers;
      if (headers) {
        if (headers["Content-Encoding"]) headers["Content-Encoding"] = "identity";
        if (headers["content-encoding"]) headers["content-encoding"] = "identity";
      }
      if (PLATFORM === "Quantumult X") {
        // QX 自己会重算长度; 留着旧值会截断 body。
        if (!outgoing.status) outgoing.status = 200;
        if (headers) {
          delete headers["Content-Length"];
          delete headers["content-length"];
          delete headers["Transfer-Encoding"];
          delete headers["transfer-encoding"];
        }
      }
      finish(outgoing, "response");
    });
})();
