// Worker / Pages 的路由入口。
//
// 这里不用 Hono 之类的框架: 一共四条路由, 原生 fetch handler 就够了, 换来的是
// worker 端零 npm 运行时依赖 —— 部署只需要 wrangler 本身, 不必先 npm install,
// 也没有第三方包需要跟着升级。

import { getPageHtml } from "./page.js";
import { parseCoords } from "./parse.js";
import { gcj02ToWgs84, toWgs84, round6, inRange } from "./geo.js";
import { PROJECT, SOURCE_OFFER_URL } from "./config.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}

/**
 * 地图链接解析, 供选点页面和快捷指令调用。
 *
 *   GET /api/parse?u=<链接>&format=json&cs=<gcj|bd|none>
 *
 * 返回 {lat, lon, name}; 高德 / 苹果地图 (中国大陆均为 GCJ-02) 自动转 WGS84,
 * 境外坐标自动跳过。cs= 可强制指定坐标系。不带 format=json 时返回纯文本
 * "lat=..&lon=.." —— 快捷指令里拼 URL 更省事。
 */
async function handleParse(url) {
  const raw = url.searchParams.get("u") || "";
  const cs = (url.searchParams.get("cs") || "").toLowerCase();
  const fmt = (url.searchParams.get("format") || "").toLowerCase();

  let { lat, lon, name, src } = await parseCoords(raw);

  if (cs === "gcj") ({ lat, lon } = gcj02ToWgs84(lat, lon));
  else if (cs === "bd") ({ lat, lon } = toWgs84(lat, lon, "baidu"));
  else if (cs !== "none") ({ lat, lon } = toWgs84(lat, lon, src));

  // 出口再校验一次: cs= 是调用方指定的, 强行按错误坐标系换算也可能把值推出值域。
  // 宁可报错也不要返回一个能被当成坐标写进设备的数字。
  if (!inRange(lat, lon)) throw new Error("解析出的坐标超出合法范围");

  lat = round6(lat);
  lon = round6(lon);
  name = name || "";

  if (fmt === "json") return json({ lat, lon, name, src });
  return new Response(`lat=${lat}&lon=${lon}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

export async function handleRequest(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "只接受 GET" }, 405);
  }

  switch (url.pathname) {
    case "/":
    case "/index.html":
      return new Response(getPageHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });

    case "/api/parse":
      try {
        return await handleParse(url);
      } catch (e) {
        // 422 而不是 500: 绝大多数失败是「这条链接里没有坐标」, 属于输入问题。
        return json({ error: String((e && e.message) || e) }, 422);
      }

    case "/api/health":
      return json({ ok: true, project: PROJECT.name, version: PROJECT.version });

    // AGPL-3.0 第 13 条: 通过网络提供服务的修改版必须让使用者能取得源码。
    case "/source":
      return Response.redirect(SOURCE_OFFER_URL, 302);

    case "/robots.txt":
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });

    default:
      return json({ error: "Not Found" }, 404);
  }
}

export default {
  fetch(request) {
    return handleRequest(request);
  },
};
