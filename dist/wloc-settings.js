/*!
 * Leo WLOC · dist/wloc-settings.js
 * 接收选点页面 / 快捷指令写来的坐标, 存进代理工具的持久化存储。
 *
 * 项目主页: https://github.com/leoaaa888-bit/leo-wloc
 * 许可证:   AGPL-3.0-or-later (见仓库 LICENSE)
 *
 * 这是一条 http-request 脚本: 请求 gs-loc.apple.com/wloc-settings/save 永远不会
 * 真的发出去, 本脚本直接伪造一个 JSON 响应回去。借用 Apple 的域名是因为模块已经
 * 为它开了 MITM —— 页面无需知道任何自建服务地址, 也就没有额外的信任面。
 *
 * 支持的 action:
 *   save (默认)  ?lon=&lat=&acc=&randomRadius=   写入坐标
 *   query        ?action=query                   读回当前生效坐标
 *   clear        ?action=clear                   清除坐标 -> 脚本进入透传
 *
 * 本文件即源码本身, 没有构建步骤。
 *
 * 上游溯源: 实现思路参考已下线的 Yu9191/wloc (AGPL-3.0), 代码为独立重写,
 * 详见 NOTICE.md。
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
  // 业务逻辑
  // ---------------------------------------------------------------------------

  /**
   * 宽松的数字解析。
   *
   * 用逗号作小数点的地区(德语/法语键盘, 以及某些地图 App 的分享文本)会给出
   * "22,544577" 这种写法, parseFloat 只会读到 22 —— 坐标被悄悄截成整数度,
   * 落点偏出几十公里。先把逗号换成点再解析。
   */
  function toNumber(v) {
    const n = parseFloat(String(v === undefined || v === null ? "" : v).replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }

  function jsonResponse(payload) {
    return {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        // 选点页面跑在自建 Pages 域名上, 跨域请求这个伪造出来的 Apple 地址,
        // 没有 CORS 头浏览器会直接吞掉响应, 页面只能看到一个无从排查的失败。
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
      body: JSON.stringify(payload),
    };
  }

  function doQuery() {
    const saved = Store.read(STORE_KEY);
    if (saved && typeof saved === "object" && saved.longitude && saved.latitude) {
      log.debug("查询: " + saved.longitude + ", " + saved.latitude);
      return {
        success: true,
        longitude: saved.longitude,
        latitude: saved.latitude,
        accuracy: saved.accuracy || 25,
        randomRadius: saved.randomRadius === undefined ? 0 : saved.randomRadius,
        updatedAt: saved.updatedAt || null,
      };
    }
    return { success: false, error: "无已保存的坐标" };
  }

  function doClear() {
    // 写 null 而不是调各平台的删除 API —— 理由见 Store 的注释。
    if (!Store.write(STORE_KEY, null)) return { success: false, error: "清除失败: 存储写入被拒绝" };
    log.info("已清除坐标数据, 脚本将进入透传模式");
    return { success: true, cleared: true };
  }

  function doSave(query) {
    const lon = toNumber(query.get("lon") !== undefined ? query.get("lon") : query.get("longitude"));
    const lat = toNumber(query.get("lat") !== undefined ? query.get("lat") : query.get("latitude"));
    const accRaw = query.get("acc") !== undefined ? query.get("acc") : query.get("accuracy");
    let accuracy = parseInt(accRaw === undefined ? "25" : accRaw, 10);
    if (!Number.isFinite(accuracy) || accuracy <= 0) accuracy = 25;

    // 值域是最后一道闸: 解析失败或经纬颠倒的输入一旦写进存储, 之后每次定位都会被
    // 送到错误的地方, 而用户看不到任何报错。宁可这里拒绝。
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { success: false, error: "缺少或非法的 lon/lat 参数" };
    }

    const previous = Store.read(STORE_KEY);
    const record = previous && typeof previous === "object" ? JSON.parse(JSON.stringify(previous)) : {};
    record.longitude = lon;
    record.latitude = lat;
    record.accuracy = accuracy;
    // 代理工具里没有时区 API, 固定按 UTC+8 记一个可读时间, 纯展示用途。
    record.updatedAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace("Z", "+08:00");

    const radiusRaw = query.get("randomRadius");
    if (radiusRaw !== undefined && radiusRaw !== "") {
      const r = toNumber(radiusRaw);
      if (Number.isFinite(r) && r >= 0) record.randomRadius = r;
    }

    if (!Store.write(STORE_KEY, record)) {
      log.error("持久化写入被拒绝");
      return { success: false, error: "写入失败: 存储返回 false" };
    }
    log.info("已保存: " + lon + ", " + lat + " (精度 " + accuracy + "m)");
    return {
      success: true,
      longitude: lon,
      latitude: lat,
      accuracy,
      randomRadius: record.randomRadius === undefined ? 0 : record.randomRadius,
      updatedAt: record.updatedAt,
    };
  }

  let payload;
  try {
    const url = (typeof $request !== "undefined" && $request.url) || "";
    const qIndex = url.indexOf("?");
    const query = parseQuery(qIndex === -1 ? "" : url.slice(qIndex + 1));
    const action = query.get("action") || "save";
    log.setLevel(query.get("logLevel") || "info");
    log.debug(SCRIPT_NAME + " v" + SCRIPT_VERSION + " on " + PLATFORM + " action=" + action);

    if (action === "query") payload = doQuery();
    else if (action === "clear") payload = doClear();
    else payload = doSave(query);
  } catch (e) {
    log.error("处理失败: " + ((e && e.message) || e));
    payload = { success: false, error: (e && e.message) || String(e) };
  }

  // kind="request": 这是一条 http-request 脚本, Stash 在这里要 {response} 包装,
  // 与 wloc.js 的 http-response 路径不同 —— 见 finish() 的注释。
  finish(jsonResponse(payload), "request");
})();
