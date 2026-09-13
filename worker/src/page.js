// 在线选点页面。
//
// 整页是一个模板串, 由 Worker 直接返回, 没有构建产物、没有前端框架。
// 页面里的 JS 一律用字符串拼接而不是模板串 —— 外层已经是模板串了, 内层再用
// 反引号就要处处转义, 那种代码改一次错一次。
//
// 数据流:
//   点选/解析 -> 得到 WGS84 坐标 -> 点「储存到设备」
//     -> fetch https://gs-loc.apple.com/wloc-settings/save?lon=..&lat=..
//     -> 代理模块拦截 -> wloc-settings.js 写入持久化存储
//     -> 下次 Apple 定位 -> wloc.js 改写响应
//
// 坐标不经过本站服务器: 那条 save 请求被模块就地截下, 根本不出设备。

import { GEO_BROWSER_JS } from "./geo-browser.js";
import { PROJECT, REPO_URL, SAVE_API, DEFAULT_CENTER, SOURCE_OFFER_URL } from "./config.js";

// Leaflet 走 cdnjs (Cloudflare 自家, 与本项目的部署同源厂商)。
// integrity 是实测值, 与 leafletjs.com/download.html 公布的一致, 且 cdnjs 与
// unpkg 两处的文件逐字节相同 —— CDN 被篡改时浏览器会拒绝执行, 下面的 typeof L
// 检查会给出可读的提示, 而不是一个空白页。
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
const LEAFLET_CSS_SRI = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
const LEAFLET_JS_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";

export function getPageHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${PROJECT.name} · 虚拟定位选点</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${PROJECT.shortName}">
<meta name="referrer" content="no-referrer">
<!-- 内联图标: 没有它浏览器每次加载都会去要 /favicon.ico 并拿到 404 -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%93%8D%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="${LEAFLET_CSS_SRI}" crossorigin="anonymous" referrerpolicy="no-referrer"/>
<script src="${LEAFLET_JS}" integrity="${LEAFLET_JS_SRI}" crossorigin="anonymous" referrerpolicy="no-referrer"><\/script>
<style>
:root{
  --blue:#0a84ff; --green:#30d158; --red:#ff453a; --orange:#ff9f0a;
  --bg:#f2f2f7; --card:#ffffff; --text:#11141a; --muted:#6e7280;
  --line:#e3e3e8; --chip:#ececf1; --chip-a:#dcdce3;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#000000; --card:#1c1c1e; --text:#f2f2f7; --muted:#98989f;
    --line:#2c2c2e; --chip:#2c2c2e; --chip-a:#3a3a3c;
  }
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,system-ui,"Helvetica Neue",sans-serif;background:var(--bg);color:var(--text);padding-bottom:env(safe-area-inset-bottom)}
#map{height:46vh;min-height:260px;width:100%;background:var(--chip)}
.maprow{position:relative}
.layers{position:absolute;top:10px;right:10px;z-index:1000;display:flex;flex-wrap:wrap;gap:4px;max-width:calc(100% - 20px);justify-content:flex-end;background:rgba(255,255,255,.9);backdrop-filter:blur(12px);border-radius:10px;padding:4px;box-shadow:0 2px 10px rgba(0,0,0,.18)}
@media (prefers-color-scheme:dark){.layers{background:rgba(28,28,30,.9)}}
.layers button{border:0;background:transparent;color:var(--text);padding:6px 9px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.layers button.on{background:var(--blue);color:#fff}
.wrap{max-width:640px;margin:0 auto;padding:14px}
.card{background:var(--card);border-radius:14px;padding:15px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.card h2{font-size:14px;font-weight:600;margin-bottom:11px;letter-spacing:.01em}
.mono{font-family:var(--mono);font-size:13.5px;background:var(--bg);border-radius:9px;padding:10px 12px;word-break:break-all;line-height:1.5}
.row{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}
.btn{flex:1;min-width:96px;padding:11px 14px;border:0;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;transition:transform .12s,background .12s}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.55}
.primary{background:var(--blue);color:#fff}
.secondary{background:var(--chip);color:var(--text)}
.secondary:active{background:var(--chip-a)}
.danger{background:var(--red);color:#fff}
.ok{background:var(--green);color:#fff}
.small{flex:none;min-width:0;padding:7px 12px;font-size:12.5px;border-radius:8px}
.field{display:flex;gap:8px;margin-top:10px}
.field input{flex:1;min-width:0;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:var(--card);color:var(--text);outline:none;font-family:inherit}
.field input:focus{border-color:var(--blue)}
.hint{font-size:11.5px;color:var(--muted);margin-top:7px;line-height:1.5}
.jitter{display:flex;align-items:center;gap:8px;margin-top:11px;font-size:13px;color:var(--muted);flex-wrap:wrap}
.jitter input{width:74px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);font-size:13px;font-family:var(--mono);outline:none}
.banner{display:none;background:var(--red);color:#fff;border-radius:12px;padding:13px 15px;margin-bottom:12px;font-size:13.5px;line-height:1.6}
.banner b{display:block;margin-bottom:5px;font-size:14px}
.banner ol{margin:0 0 0 18px}
.favs{max-height:250px;overflow-y:auto;-webkit-overflow-scrolling:touch}
.fav{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:10px;margin-bottom:6px;cursor:pointer}
.fav:active{background:var(--chip-a)}
.fav .i{flex:1;min-width:0}
.fav .n{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fav .c{font-size:11px;color:var(--muted);font-family:var(--mono);margin-top:2px}
.fav .live{font-size:10.5px;color:var(--green);font-weight:600;margin-top:2px}
.fav .x{flex:none;width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:var(--red);font-size:18px;line-height:1;cursor:pointer}
.empty{text-align:center;color:var(--muted);font-size:13px;padding:18px 0}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;gap:8px}
.head h2{margin-bottom:0}
.toast{position:fixed;left:50%;top:16px;transform:translateX(-50%);background:rgba(20,20,22,.94);color:#fff;padding:11px 18px;border-radius:22px;font-size:13.5px;opacity:0;transition:opacity .25s;pointer-events:none;z-index:9999;max-width:92vw;text-align:center;line-height:1.45}
.toast.show{opacity:1}
.mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:none;align-items:center;justify-content:center;padding:22px}
.mask.show{display:flex}
.modal{background:var(--card);border-radius:16px;padding:20px;width:100%;max-width:330px}
.modal h3{font-size:16px;font-weight:600;margin-bottom:14px;text-align:center}
.modal input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:var(--bg);color:var(--text);outline:none;margin-bottom:10px;font-family:inherit}
footer{text-align:center;font-size:11.5px;color:var(--muted);padding:6px 14px 26px;line-height:1.8}
footer a{color:var(--muted)}
@media(max-width:430px){#map{height:40vh}.wrap{padding:11px}}
</style>
</head>
<body>

<div class="maprow">
  <div id="map"></div>
  <div class="layers">
    <button class="on" data-l="satellite">卫星</button>
    <button data-l="street">街道</button>
    <button data-l="amap" title="高德为 GCJ-02 偏移图源, 选点已自动换算回 WGS84">高德</button>
    <button data-l="osm">标准</button>
    <button data-l="dark">暗色</button>
  </div>
</div>

<div class="wrap">

  <div class="banner" id="banner">
    <b>模块没有生效</b>
    写入请求没有被拦截, 请检查:
    <ol>
      <li>代理工具里 ${PROJECT.name} 模块已启用</li>
      <li>MITM 已开启, CA 证书已安装并「完全信任」</li>
      <li>MITM 主机名包含 gs-loc.apple.com</li>
      <li>当前 Safari 流量确实走代理</li>
    </ol>
  </div>

  <div class="card">
    <h2>目标位置</h2>
    <div class="mono" id="coords">点击地图选点, 或在下方搜索 / 粘贴链接</div>
    <div class="jitter">
      <label for="radius">扰动半径</label>
      <input id="radius" type="number" min="0" max="5000" step="1" value="0">
      <span>米 · 每次定位在目标点周围随机偏移, 0 为关闭</span>
    </div>
    <div class="row">
      <button class="btn primary" id="saveBtn">储存到设备</button>
      <button class="btn secondary" id="favBtn">收藏位置</button>
      <button class="btn secondary" id="meBtn">当前位置</button>
    </div>
  </div>

  <div class="card">
    <h2>查找位置</h2>
    <div class="field">
      <input id="q" placeholder="地名, 或地图链接 / 经纬度" autocomplete="off" autocapitalize="off" spellcheck="false">
    </div>
    <div class="row">
      <button class="btn secondary" id="parseBtn">解析链接</button>
      <button class="btn secondary" id="searchBtn">搜索地名</button>
    </div>
    <div class="hint">链接支持 Apple Maps · Google Maps · 高德 · 百度 · 纯坐标文本 (含短链, 自动换算到 WGS84)。回车键会自动判断该用哪种方式。</div>
  </div>

  <div class="card">
    <div class="head">
      <h2>设备当前生效坐标</h2>
      <button class="btn secondary small" id="refreshBtn">刷新</button>
    </div>
    <div class="mono" id="active">查询中…</div>
    <div class="row">
      <button class="btn danger small" id="clearBtn">清除数据 (恢复真实定位)</button>
    </div>
  </div>

  <div class="card">
    <div class="head">
      <h2>收藏的位置</h2>
      <button class="btn secondary small" id="clearFavBtn" style="display:none">清空</button>
    </div>
    <div class="favs" id="favs"></div>
  </div>

</div>

<footer>
  ${PROJECT.name} v${PROJECT.version} · 作者 ${PROJECT.author}<br>
  坐标只写入你的设备, 不经过本站服务器<br>
  <a href="${SOURCE_OFFER_URL}" target="_blank" rel="noopener">源码 (AGPL-3.0)</a> ·
  <a href="${REPO_URL}" target="_blank" rel="noopener">项目主页</a>
</footer>

<div class="toast" id="toast"></div>

<div class="mask" id="favMask">
  <div class="modal">
    <h3>收藏此位置</h3>
    <input id="favName" placeholder="备注名称, 如: 公司、家" maxlength="30">
    <div class="hint" style="text-align:center;margin-bottom:12px" id="favCoords"></div>
    <div class="row" style="margin-top:0">
      <button class="btn secondary" id="favCancel">取消</button>
      <button class="btn primary" id="favOk">保存</button>
    </div>
  </div>
</div>

<script>
if (typeof L === 'undefined') {
  document.getElementById('map').innerHTML =
    '<div style="padding:26px;text-align:center;font-size:13.5px;color:#6e7280;line-height:1.7">' +
    '地图库加载失败<br>cdnjs.cloudflare.com 不可达 (或被 SRI 校验拒绝)<br>请检查网络/代理后刷新<\\/div>';
  throw new Error('leaflet unavailable');
}

${GEO_BROWSER_JS}

var SAVE_API = ${JSON.stringify(SAVE_API)};
var FAV_KEY = 'leo_wloc_favorites';

// lat/lon 恒为 WGS84 —— 这是写进设备、也是 wloc.js 唯一认的坐标系。
// 底图可能是 GCJ-02 图源, 屏幕上的读数与它并不相等; 换算集中在 toDisp/fromDisp
// 两个函数里, 其它地方一律不碰。
var lat = ${DEFAULT_CENTER.lat}, lon = ${DEFAULT_CENTER.lon};
var picked = false;
var liveLat = null, liveLon = null;
var layerIsGcj = false;

function toDisp(la, lo){ return layerIsGcj ? wgs84ToGcj02(la, lo) : {lat:la, lon:lo}; }
function fromDisp(la, lo){ return layerIsGcj ? gcj02ToWgs84(la, lo) : {lat:la, lon:lo}; }

var map = L.map('map', {zoomControl:true}).setView([lat, lon], ${DEFAULT_CENTER.zoom});

var tiles = {
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'ArcGIS'}),
  street:    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {maxZoom:19, attribution:'ArcGIS'}),
  osm:       L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'\\u00a9 OpenStreetMap'}),
  dark:      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:19, attribution:'\\u00a9 CARTO'}),
  amap:      L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {maxZoom:18, subdomains:'1234', attribution:'\\u00a9 高德'})
};
var cur = tiles.satellite;
cur.addTo(map);

var marker = L.marker([lat, lon], {draggable:true}).addTo(map);

function switchLayer(name){
  map.removeLayer(cur);
  cur = tiles[name];
  cur.addTo(map);
  layerIsGcj = (name === 'amap');
  // 底图坐标系变了, 同一个 WGS84 点对应的屏幕位置也变了, marker 必须重摆,
  // 否则切换图层后它会停在旧图源的像素位置上, 看起来像坐标被改掉了。
  var d = toDisp(lat, lon);
  marker.setLatLng([d.lat, d.lon]);
  map.setView([d.lat, d.lon], map.getZoom());
  var bs = document.querySelectorAll('.layers button');
  for (var i=0;i<bs.length;i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-l') === name);
}

// 地图交互给出的都是「屏幕坐标系」读数, 一律先过 fromDisp 再进 setPos。
marker.on('dragend', function(e){ var p = e.target.getLatLng(); setPosFromDisp(p.lat, p.lng); });
map.on('click', function(e){ setPosFromDisp(e.latlng.lat, e.latlng.lng); });

function setPosFromDisp(dLat, dLon){ var w = fromDisp(dLat, dLon); setPos(w.lat, w.lon); }

function setPos(newLat, newLon){
  lat = newLat; lon = newLon; picked = true;
  var d = toDisp(lat, lon);
  marker.setLatLng([d.lat, d.lon]);
  document.getElementById('coords').textContent = '经度 ' + lon.toFixed(6) + '   纬度 ' + lat.toFixed(6);
}

function moveTo(newLat, newLon, zoom){
  setPos(newLat, newLon);
  var d = toDisp(lat, lon);
  map.setView([d.lat, d.lon], zoom || 16);
}

var toastTimer = null;
function toast(msg, ms){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, ms || 2600);
}
function banner(show){ document.getElementById('banner').style.display = show ? 'block' : 'none'; }

/* ---------- 收藏 (localStorage, 仅浏览器本地) ---------- */
function getFavs(){ try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch(e){ return []; } }
function putFavs(v){ try { localStorage.setItem(FAV_KEY, JSON.stringify(v)); } catch(e){ toast('无法写入浏览器存储'); } }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderFavs(){
  var favs = getFavs();
  var el = document.getElementById('favs');
  document.getElementById('clearFavBtn').style.display = favs.length ? '' : 'none';
  if (!favs.length){ el.innerHTML = '<div class="empty">还没有收藏。选好位置后点「收藏位置」<\\/div>'; return; }
  var html = '';
  for (var i=0;i<favs.length;i++){
    var f = favs[i];
    var live = liveLon !== null && Math.abs(f.lon - liveLon) < 1e-6 && Math.abs(f.lat - liveLat) < 1e-6;
    html += '<div class="fav" data-i="' + i + '">' +
              '<div class="i">' +
                '<div class="n">' + esc(f.name) + '<\\/div>' +
                '<div class="c">' + f.lon.toFixed(6) + ', ' + f.lat.toFixed(6) + '<\\/div>' +
                (live ? '<div class="live">\\u2713 当前生效<\\/div>' : '') +
              '<\\/div>' +
              '<button class="x" data-del="' + i + '" aria-label="删除">\\u00d7<\\/button>' +
            '<\\/div>';
  }
  el.innerHTML = html;
}

document.getElementById('favs').addEventListener('click', function(e){
  var del = e.target.getAttribute && e.target.getAttribute('data-del');
  if (del !== null && del !== undefined){
    e.stopPropagation();
    var favs = getFavs(); var n = favs[del] && favs[del].name;
    favs.splice(del, 1); putFavs(favs); renderFavs(); toast('已删除: ' + n);
    return;
  }
  var row = e.target.closest ? e.target.closest('.fav') : null;
  if (!row) return;
  var f = getFavs()[row.getAttribute('data-i')];
  if (!f) return;
  moveTo(f.lat, f.lon, 16);
  toast(f.name + '  ' + f.lon.toFixed(4) + ', ' + f.lat.toFixed(4));
});

/* ---------- 查询 / 清除设备坐标 ---------- */
function queryActive(){
  var el = document.getElementById('active');
  el.textContent = '查询中…';
  fetch(SAVE_API + '?action=query', {method:'GET', mode:'cors', cache:'no-store'})
    .then(function(r){ return r.json(); })
    .then(function(d){
      banner(false);
      if (d.success && d.longitude && d.latitude){
        liveLon = parseFloat(d.longitude); liveLat = parseFloat(d.latitude);
        var rr = d.randomRadius || 0;
        el.textContent = '经度 ' + liveLon.toFixed(6) + '   纬度 ' + liveLat.toFixed(6) +
                         (d.accuracy ? '   精度 ' + d.accuracy + 'm' : '') +
                         (rr ? '   扰动 ' + rr + 'm' : '');
        document.getElementById('radius').value = rr;
      } else {
        liveLon = null; liveLat = null;
        el.textContent = '无已保存坐标 (脚本处于透传状态, 使用真实定位)';
      }
      renderFavs();
    })
    .catch(function(){
      liveLon = null; liveLat = null;
      el.textContent = '查询失败 — 模块未拦截到请求';
      banner(true);
      renderFavs();
    });
}

function clearActive(){
  if (!confirm('确定清除设备上已保存的坐标?\\n清除后脚本进入透传状态, 恢复真实定位。')) return;
  fetch(SAVE_API + '?action=clear', {method:'GET', mode:'cors', cache:'no-store'})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d.success) throw new Error(d.error || '清除失败');
      liveLon = null; liveLat = null;
      document.getElementById('active').textContent = '已清除 (脚本处于透传状态, 使用真实定位)';
      renderFavs();
      toast('已清除。iOS 26+ 需重启设备才能清掉定位缓存', 4200);
    })
    .catch(function(e){ banner(true); toast('清除失败: ' + (e.message || ''), 3600); });
}

/* ---------- 储存到设备 ---------- */
function save(){
  if (!picked){ toast('请先在地图上选择一个位置'); return; }
  var btn = document.getElementById('saveBtn');
  var radius = parseInt(document.getElementById('radius').value, 10) || 0;
  btn.textContent = '储存中…'; btn.disabled = true; banner(false);

  fetch(SAVE_API + '?lon=' + lon + '&lat=' + lat + '&acc=25&randomRadius=' + radius,
        {method:'GET', mode:'cors', cache:'no-store'})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d.success) throw new Error(d.error || '写入失败');
      liveLon = lon; liveLat = lat;
      btn.textContent = '\\u2713 已储存'; btn.className = 'btn ok';
      document.getElementById('active').textContent =
        '经度 ' + lon.toFixed(6) + '   纬度 ' + lat.toFixed(6) + '   精度 25m' + (radius ? '   扰动 ' + radius + 'm' : '');
      renderFavs();
      toast('\\u2713 已写入设备, 下次定位生效');
      setTimeout(function(){ btn.textContent = '储存到设备'; btn.className = 'btn primary'; btn.disabled = false; }, 2400);
    })
    .catch(function(){
      btn.textContent = '储存到设备'; btn.className = 'btn primary'; btn.disabled = false;
      banner(true);
      toast('\\u2717 储存失败 — 请检查模块配置', 4000);
    });
}

/* ---------- 输入解析 ---------- */
// 纯坐标文本本地直接解析 —— 它也是唯一不需要坐标系换算的输入, 免去一次往返。
function parseBare(text){
  var m = text.match(/(-?\\d{1,3}\\.\\d+)[,\\s]+(-?\\d{1,3}\\.\\d+)/);
  if (!m) return null;
  var a = parseFloat(m[1]), b = parseFloat(m[2]);
  // 纬度绝对值不超过 90, 经度可达 180: 按绝对值判断谁是经度, 否则 -122.009
  // 这类西经会被当成纬度 (|-122| < 90 并不成立, 但 -122 < 90 恒成立)。
  if (Math.abs(a) <= 90 && Math.abs(b) > 90) return {lat:a, lon:b};
  if (Math.abs(b) <= 90 && Math.abs(a) > 90) return {lat:b, lon:a};
  if (Math.abs(a) > 90 || Math.abs(b) > 90) return null;
  return {lat:a, lon:b};
}

// 含链接的输入交给服务端 /api/parse: 浏览器读不到跨域 302 的 Location 头, 短链
// 只能由 Worker 展开; 服务端还会按来源做 GCJ-02 -> WGS84 换算。
function parseInput(){
  var input = document.getElementById('q').value.trim();
  if (!input) { toast('请输入地名、链接或坐标'); return; }

  if (input.toLowerCase().indexOf('http') === 0 || input.indexOf('://') > -1){
    toast('解析中…');
    fetch('/api/parse?format=json&u=' + encodeURIComponent(input))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d || d.error || typeof d.lat !== 'number') throw new Error((d && d.error) || '无法解析坐标');
        moveTo(d.lat, d.lon, 16);
        toast(d.name ? '已解析: ' + d.name : '已解析: ' + d.lon.toFixed(4) + ', ' + d.lat.toFixed(4));
      })
      .catch(function(e){ toast(e.message || '解析服务不可达', 4200); });
    return;
  }

  var bare = parseBare(input);
  if (bare){ moveTo(bare.lat, bare.lon, 16); toast('已定位: ' + bare.lon.toFixed(4) + ', ' + bare.lat.toFixed(4)); return; }
  toast('不像链接或坐标 — 试试「搜索地名」', 3200);
}

function searchPlace(){
  var q = document.getElementById('q').value.trim();
  if (!q) { toast('请输入地名'); return; }
  toast('搜索中…');
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q))
    .then(function(r){ return r.json(); })
    .then(function(rs){
      if (!rs.length) { toast('未找到: ' + q, 3200); return; }
      moveTo(parseFloat(rs[0].lat), parseFloat(rs[0].lon), 16);
      toast(String(rs[0].display_name).slice(0, 42));
    })
    .catch(function(){ toast('搜索失败 (Nominatim 不可达)', 3200); });
}

// 回车键自动判断: 有 http/坐标就解析, 否则按地名搜。
function smartGo(){
  var v = document.getElementById('q').value.trim();
  if (!v) return;
  if (v.toLowerCase().indexOf('http') === 0 || v.indexOf('://') > -1 || parseBare(v)) parseInput();
  else searchPlace();
}

function locateMe(){
  if (!navigator.geolocation) { toast('浏览器不支持定位'); return; }
  toast('获取当前位置中…');
  navigator.geolocation.getCurrentPosition(
    function(p){ moveTo(p.coords.latitude, p.coords.longitude, 17); toast('已获取当前位置'); },
    function(e){ toast('定位失败: ' + e.message, 3200); },
    {enableHighAccuracy:true, timeout:10000}
  );
}

/* ---------- 事件绑定 ---------- */
var ls = document.querySelectorAll('.layers button');
for (var i=0;i<ls.length;i++){
  (function(b){ b.addEventListener('click', function(){ switchLayer(b.getAttribute('data-l')); }); })(ls[i]);
}
document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('meBtn').addEventListener('click', locateMe);
document.getElementById('parseBtn').addEventListener('click', parseInput);
document.getElementById('searchBtn').addEventListener('click', searchPlace);
document.getElementById('refreshBtn').addEventListener('click', queryActive);
document.getElementById('clearBtn').addEventListener('click', clearActive);
document.getElementById('q').addEventListener('keydown', function(e){ if (e.key === 'Enter') smartGo(); });

document.getElementById('favBtn').addEventListener('click', function(){
  if (!picked){ toast('请先在地图上选择一个位置'); return; }
  document.getElementById('favCoords').textContent = lon.toFixed(6) + ', ' + lat.toFixed(6);
  document.getElementById('favName').value = '';
  document.getElementById('favMask').classList.add('show');
  setTimeout(function(){ document.getElementById('favName').focus(); }, 80);
});
function closeFav(){ document.getElementById('favMask').classList.remove('show'); }
function confirmFav(){
  var name = document.getElementById('favName').value.trim();
  if (!name){ toast('请输入备注名称'); return; }
  var favs = getFavs();
  favs.push({name:name, lon:lon, lat:lat, time:new Date().toISOString()});
  putFavs(favs); closeFav(); renderFavs(); toast('已收藏: ' + name);
}
document.getElementById('favCancel').addEventListener('click', closeFav);
document.getElementById('favOk').addEventListener('click', confirmFav);
document.getElementById('favName').addEventListener('keydown', function(e){ if (e.key === 'Enter') confirmFav(); });
document.getElementById('favMask').addEventListener('click', function(e){ if (e.target.id === 'favMask') closeFav(); });

document.getElementById('clearFavBtn').addEventListener('click', function(){
  if (!confirm('清空全部收藏?')) return;
  putFavs([]); renderFavs(); toast('已清空收藏');
});

document.addEventListener('paste', function(e){
  var text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text) return;
  if (!(text.indexOf('map') > -1 || text.indexOf('loc') > -1 || /\\d+\\.\\d+/.test(text))) return;
  var box = document.getElementById('q');
  // 粘贴目标本来就是这个输入框时, 让浏览器原生插入即可; 此处再赋一次值,
  // 原生插入会叠加在后面, 结果是同一段文本出现两遍。
  if (e.target !== box) box.value = text;
  setTimeout(smartGo, 180);
});

renderFavs();
queryActive();
<\/script>
</body>
</html>`;
}
