// 地图链接解析: 从苹果地图 / Google / 高德 / 百度的分享链接里抠出经纬度和地名。
//
// 为什么要放在服务端而不是页面里:
//   - 高德分享出来是短链, 真实坐标只藏在 302 跳转的 Location 头里, 浏览器读不到
//     跨域响应头;
//   - 百度大陆 POI 的坐标是墨卡托米制, 藏在页面正文;
//   - 苹果地图在中国大陆给的是 GCJ-02, 需要按「来源 x 地区」分派换算。
// 这几件事页面都做不了, 快捷指令更做不了。

import { bd09mcToBd09, inRange } from "./geo.js";

export function safeDecode(s) {
  if (!s) return "";
  try {
    return decodeURIComponent(String(s).replace(/\+/g, " "));
  } catch (e) {
    return String(s);
  }
}

// ---------------------------------------------------------------------------
// 地名提取
// ---------------------------------------------------------------------------

/** 查询串里的 ?name= / &name= —— 苹果地图和高德 URI 都用这个键。 */
function queryName(str) {
  const m = str.match(/[?&]name=([^&]+)/i);
  return m ? safeDecode(m[1]) : "";
}

/** Google 的地名在路径里: /maps/place/Apple+Park/@... */
function googleName(str) {
  const m = str.match(/\/maps\/place\/([^/@?]+)/);
  return m ? safeDecode(m[1]).replace(/\+/g, " ").trim() : "";
}

/** 百度网页版的地名在路径里: /poi/Apple台北101/@... */
function baiduPathName(str) {
  const m = str.match(/\/poi\/([^/@?]+)/);
  return m ? safeDecode(m[1]).trim() : "";
}

// ---------------------------------------------------------------------------
// 提取规则
// ---------------------------------------------------------------------------
//
// 顺序即优先级, 从最可靠到最将就。每条规则都标了它为什么必须在当前位置。

const RULES = [
  {
    id: "apple",
    // 前缀 (?:^|[?&]) 是必需的: 无锚定时 "ll=" 会匹配任何以 ll 结尾的参数名,
    // scroll=1.5,2.5 / pull=... 都会被当成坐标。
    re: /(?:^|[?&])(?:coordinate|ll|sll)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i,
    pick: (m, s) => ({ lat: +m[1], lon: +m[2], name: queryName(s), src: "apple" }),
  },
  {
    id: "google-pin",
    // !3d<lat>!4d<lon> 是地点针脚的真实坐标, 必须优先于 @lat,lon —— 后者是相机
    // 视口中心, 与缩放级别绑定, 可以离目标十几公里。
    re: /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    pick: (m, s) => ({ lat: +m[1], lon: +m[2], name: googleName(s), src: "google" }),
  },
  {
    id: "amap-p",
    // 高德 ?p=POIID,纬度,经度,名称,城市
    re: /[?&]p=[^,&%]*(?:,|%2C)(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
    pick: (m) => ({ lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" }),
  },
  {
    id: "amap-q",
    // 高德新版分享链 ?q=纬度,经度,名称
    re: /[?&]q=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)(?:(?:,|%2C)((?:(?!,|%2C|&).)+))?/i,
    pick: (m) => ({ lat: +m[1], lon: +m[2], name: m[3] ? safeDecode(m[3]) : "", src: "amap" }),
  },
  {
    id: "amap-uri",
    // 高德 URI API 的 lnglat= / position= 是「经度,纬度」序, 与上面所有规则相反。
    //
    // 不要顺手补一条 location=/center= 规则: 高德那两个键是 lon,lat, 而百度的
    // location= 实际是 lat,lng —— 同名不同序, 一条规则必然解颠倒一家。
    // 宁可少认一种也不要认错。
    re: /(?:^|[?&])(?:lnglat|position)=(-?\d{1,3}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i,
    pick: (m, s) => ({ lat: +m[2], lon: +m[1], name: queryName(s), src: "amap" }),
  },
  {
    id: "baidu-mc",
    // 百度网页版把 BD09MC 米制坐标写进路径: /poi/名称/@12709535.375,2529761.45,19z
    // 位数 (6~9) 本身就把它和经纬度形式的 @ 区分开了。
    re: /baidu\.com\/[^\s]*?@(-?\d{6,9}(?:\.\d+)?)(?:,|%2C)(-?\d{6,9}(?:\.\d+)?)/i,
    pick: (m, s) => {
      const bd = bd09mcToBd09(+m[1], +m[2]);
      return bd ? { lat: bd.lat, lon: bd.lon, name: baiduPathName(s), src: "baidu" } : null;
    },
  },
  {
    id: "google-viewport",
    // 只有在没有针脚坐标时才退而求其次用视口中心。
    re: /\/maps\/[^\s]*@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    pick: (m, s) => ({ lat: +m[1], lon: +m[2], name: googleName(s), src: "google" }),
  },
];

// 裸坐标兜底单独放, 因为扫描页面正文时必须能关掉它。
const BARE_RE = /(-?\d{1,3}\.\d{4,})\s*(?:,|%2C)\s*(-?\d{1,3}\.\d{4,})/;

function extractRaw(s, opts) {
  if (!s) return null;
  const str = String(s);
  for (const rule of RULES) {
    const m = str.match(rule.re);
    if (!m) continue;
    const hit = rule.pick(m, str);
    if (hit) return hit;
  }
  // opts.allowBare=false 时不启用「两个裸小数」兜底。扫描页面正文必须关掉它:
  // 正文里任何一对小数都会命中 (百度页面的 "view_dir":"-0.8477,0.0000" 就是如此),
  // 结果是静默返回一个错误坐标 —— 比解析失败危险得多。
  if (!opts || opts.allowBare !== false) {
    const m = str.match(BARE_RE);
    if (m) return { lat: +m[1], lon: +m[2], name: "", src: "text" };
  }
  return null;
}

/**
 * 从一段字符串里提取经纬度 + 名称。
 *
 * 值域是最后一道闸。上面的兜底规则不带语义, 匹配到什么就返回什么, 经纬颠倒
 * (lat=113.9) 或纯粹的垃圾数字都能一路走到调用方。这里拦掉的是「解析成了错的」,
 * 它比「解析失败」危险得多 —— 后者会提示用户, 前者会把设备定位挪到别处。
 */
export function extractFromString(s, opts) {
  const hit = extractRaw(s, opts);
  return hit && inRange(hit.lat, hit.lon) ? hit : null;
}

// ---------------------------------------------------------------------------
// 跟随跳转
// ---------------------------------------------------------------------------
//
// /api/parse 会去 fetch 调用方给的任意 URL。Workers 出网到不了内网, 所以经典的
// SSRF (打内网 / 元数据服务) 基本不成立, 剩下的风险是资源耗尽 —— 一个永不结束的
// 响应能把子请求挂死, 一个几百 MB 的响应能把 128 MB 的 Worker 内存打爆。
// 下面两个常量和 isFetchable() 挡的是这个, 而不是「禁止访问某些站点」。

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_HOPS = 5;

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/24A5370h Safari/604.1",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh-Hans;q=0.9",
};

function isFetchable(u) {
  let url;
  try {
    url = new URL(u);
  } catch (e) {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[")) return false; // IP 字面量
  return true;
}

/** 只读前 MAX_BODY_BYTES, 读满就掐掉连接。坐标总在页面靠前的位置, 读全文没有收益。 */
async function readCapped(resp) {
  if (!resp.body || typeof resp.body.getReader !== "function") {
    return (await resp.text()).slice(0, MAX_BODY_BYTES);
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try {
    await reader.cancel();
  } catch (e) {
    /* 连接已经关了就不用管 */
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

function isBaiduHost(u) {
  try {
    return /(^|\.)baidu\.com$/i.test(new URL(u).hostname);
  } catch (e) {
    return false;
  }
}

/**
 * 百度页面正文里的 "x":"12686385.66","y":"2560876.53" —— BD09MC 米制。
 * 量级校验用于把它和页面里其它同名字段 (像素坐标等) 区分开。
 */
export function extractBaiduFromBody(body) {
  const m = String(body).match(/"x"\s*:\s*"?(-?\d+(?:\.\d+)?)"?\s*,\s*"y"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/);
  if (!m) return null;
  const x = +m[1];
  const y = +m[2];
  if (!(Math.abs(x) > 1e5 && Math.abs(y) > 1e5)) return null;
  const bd = bd09mcToBd09(x, y);
  if (!bd || !inRange(bd.lat, bd.lon)) return null;
  const nm = String(body).match(/<title>[^<]*?【([^】]{1,40})】/);
  return { lat: bd.lat, lon: bd.lon, name: nm ? nm[1] : "", src: "baidu" };
}

const BAIDU_HINT =
  "百度这条链接的坐标要靠网页脚本才能取到(港澳台的 POI 多为此类)。" +
  "请在浏览器打开该链接, 等地址栏变成 map.baidu.com/poi/名称/@数字,数字,19z 之后, 复制整条地址再粘贴。";

/** 接受原文 (可能含中文地名 + 链接), 抠出 URL, 必要时跟随重定向展开短链, 提取坐标。 */
export async function parseCoords(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("空输入");

  const urlMatch = text.match(/https?:\/\/[^\s'"<>]+/i);
  const target = urlMatch ? urlMatch[0] : text;

  let hit = extractFromString(target);
  if (hit) return hit;

  if (urlMatch) {
    let cur = target;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (!isFetchable(cur)) break;
      let resp;
      try {
        resp = await fetch(cur, {
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: BROWSER_HEADERS,
        });
      } catch (e) {
        break;
      }

      const loc = resp.headers.get("location");
      if (loc) {
        hit = extractFromString(loc);
        if (hit) return hit;
        cur = new URL(loc, cur).toString();
        hit = extractFromString(cur);
        if (hit) return hit;
        continue;
      }

      hit = extractFromString(resp.url);
      if (hit) return hit;

      try {
        const body = await readCapped(resp);
        hit = extractFromString(body, { allowBare: false });
        if (hit) return hit;
        // 百度分享链展开后 URL 里只有 uid, 坐标以 BD09MC 藏在正文中。
        if (isBaiduHost(cur)) {
          hit = extractBaiduFromBody(body);
          if (hit) return hit;
        }
      } catch (e) {
        /* 正文读不到就走下面的报错分支 */
      }
      break;
    }
  }

  // 百度对大陆 POI 会把坐标直出在移动版页面里, 港澳台的则不会 —— 那边要靠页面
  // 脚本带 auth/seckey 反爬令牌去查, 服务端无法复现。与其只说一句「解析不了」,
  // 不如告诉用户那条确实走得通的路。
  if (urlMatch && isBaiduHost(target)) throw new Error(BAIDU_HINT);
  throw new Error("未能从链接中解析出经纬度");
}
