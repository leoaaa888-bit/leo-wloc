// 坐标系换算。
//
// 全项目内部一律以 WGS84 为准 —— 那是 wloc.js 唯一认的坐标系, 也是写进设备的值。
// 这里负责把各家地图给的坐标折算回 WGS84:
//
//   WGS84   国际标准, GPS 原始坐标
//   GCJ-02  中国大陆强制加密偏移 ("火星坐标"), 高德/腾讯/苹果中国大陆在用
//   BD-09   百度在 GCJ-02 之上再叠一层自有偏移
//   BD09MC  百度的墨卡托米制形式, 网页版 URL 里出现的那种大数字
//
// 偏移量在深圳一带约 600 米。对一个定位工具来说, 少做或多做一次换算就是几百米的
// 误差, 所以每条规则都写清了「什么来源、什么地区」。

const GCJ_A = 6378245.0; // 克拉索夫斯基椭球长半轴, GCJ-02 算法指定
const GCJ_EE = 0.00669342162296594323; // 对应的第一偏心率平方
const X_PI = (Math.PI * 3000) / 180;

/** 纬度 <= 90, 经度 <= 180; NaN / Infinity 一并挡掉。 */
export function inRange(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** 保留 6 位小数, 约 0.1 米 —— 再多的位数没有物理意义。 */
export function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// GCJ-02
// ---------------------------------------------------------------------------

// 粗矩形。它把港澳台也圈了进去, 这是刻意的 —— 见下方 usesWgs84Locally 的说明。
function gcjOutOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function gcjDeltaLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return r;
}

function gcjDeltaLon(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return r;
}

/** WGS84 -> GCJ-02 (正向偏移)。 */
export function wgs84ToGcj02(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let dLat = gcjDeltaLat(lon - 105.0, lat - 35.0);
  let dLon = gcjDeltaLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLon = (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

/**
 * GCJ-02 -> WGS84。
 *
 * GCJ-02 没有解析逆函数, 常见做法是「减去在目标点算出的偏移量」, 但偏移量本身
 * 随位置变化, 单程反算在梯度大的地区会残留 1~2 米。这里用不动点迭代收敛到
 * 0.1 米以内, 与 wgs84ToGcj02 严格互逆 —— 否则用户在高德底图上选点再切回卫星图,
 * 针脚会肉眼可见地漂移。
 */
export function gcj02ToWgs84(lat, lon) {
  if (gcjOutOfChina(lon, lat)) return { lat, lon };
  let wgsLat = lat;
  let wgsLon = lon;
  for (let i = 0; i < 6; i++) {
    const g = wgs84ToGcj02(wgsLat, wgsLon);
    const errLat = g.lat - lat;
    const errLon = g.lon - lon;
    if (Math.abs(errLat) < 1e-9 && Math.abs(errLon) < 1e-9) break;
    wgsLat -= errLat;
    wgsLon -= errLon;
  }
  return { lat: wgsLat, lon: wgsLon };
}

// ---------------------------------------------------------------------------
// 百度
// ---------------------------------------------------------------------------

/** BD-09 -> GCJ-02。 */
export function bd09ToGcj02(lat, lon) {
  const x = lon - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const t = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return { lat: z * Math.sin(t), lon: z * Math.cos(t) };
}

// 百度墨卡托不是标准 Web 墨卡托, 而是按纬度分 6 段的高次多项式拟合。
// 拿标准墨卡托去逆算会差约 10 公里, 必须用下面这张系数表。
const MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
const MC2LL = [
  [1.410526172116255e-8, 8.98305509648872e-6, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 1.73379812e7],
  [-7.435856389565537e-9, 8.983055097726239e-6, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 1.026014486e7],
  [-3.030883460898826e-8, 8.98305509983578e-6, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6.85681737e6],
  [-1.981981304930552e-8, 8.983055099779535e-6, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4.48277706e6],
  [3.09191371068437e-9, 8.983055096812155e-6, 6.995724062e-5, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2.5551644e6],
  [2.890871144776878e-9, 8.983055095805407e-6, -3.068298e-8, 7.47137025468032, -3.53937994e-6, -0.02145144861037, -1.234426596e-5, 0.00010322952773, -3.23890364e-6, 8.260885e5],
];

/**
 * BD09MC (墨卡托米制) -> BD-09 (经纬度)。无法得到合法经纬度时返回 null。
 *
 * 最低一档的 MCBAND 是 0, 所以「找不到档位」这种情况不存在 —— 任何输入都能算出
 * 一对数。超出百度墨卡托实际值域的输入 (比如把像素坐标或随便一个大数喂进来)
 * 算出来的是 lon=8983 这类明显越界的垃圾。多项式拟合在定义域外本来就没有意义,
 * 与其把垃圾交给调用方, 不如在这里就判死。
 */
export function bd09mcToBd09(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let f = null;
  for (let i = 0; i < MCBAND.length; i++) {
    if (ay >= MCBAND[i]) {
      f = MC2LL[i];
      break;
    }
  }
  if (!f) return null;
  const c = ay / f[9];
  let lon = f[0] + f[1] * ax;
  let lat = f[2] + f[3] * c + f[4] * c ** 2 + f[5] * c ** 3 + f[6] * c ** 4 + f[7] * c ** 5 + f[8] * c ** 6;
  lon *= x < 0 ? -1 : 1;
  lat *= y < 0 ? -1 : 1;
  return inRange(lat, lon) ? { lat, lon } : null;
}

// ---------------------------------------------------------------------------
// 港澳台: 来源决定要不要换算
// ---------------------------------------------------------------------------
//
// GCJ-02 的偏移只施加于中国大陆, 但 gcjOutOfChina 那个粗矩形把港澳台整个圈了
// 进去。对本来就是 WGS84 的坐标白做一次反算, 实测偏 570~600 米。
//
// 关键在于这不是纯地理判断, 必须按来源区分: 高德在香港的瓦片实测仍是 GCJ-02
// (与卫星图比对差 596 米, 与大陆同量级), 百度的 BD-09 建在 GCJ 之上同理。
// 所以只有 apple / google 才在港澳台跳过换算。
//
// 实测基准 (链接原始值即真值, 与设备 GPS 逐位相同):
//   香港 ifc mall       22.284774, 114.159437
//   澳门 Galaxy Macau   22.148148, 113.555399
//   台北 101            25.033626, 121.564215

// 香港必须用多边形而不是矩形: 任何包住香港的矩形都会把深圳南山/福田一起圈进去,
// 而深圳恰恰是最常用的坐标区域。北界沿深圳河与深圳湾自西向东抬升。
// 这条线是近似的, 口岸一带 (罗湖/落马洲/沙头角) 两侧约 1 公里内可能判错 ——
// 那些地方本身就骑在边界上, 几个折点分不清。
const HK_POLY = [
  [113.8, 22.1],
  [113.8, 22.43],
  [113.9, 22.455],
  [113.98, 22.487],
  [114.05, 22.507],
  [114.11, 22.527],
  [114.17, 22.543],
  [114.24, 22.552],
  [114.32, 22.545],
  [114.5, 22.45],
  [114.5, 22.1],
];

/** 射线法。poly 的点是 [经度, 纬度]。 */
function pointInPoly(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 澳门与珠海拱北只隔一道关闸 (约 250 米), 矩形分不开; 北界取关闸纬度, 误判范围
// 限于口岸那一小片。
function inMacau(lat, lon) {
  return lat >= 22.1 && lat <= 22.215 && lon >= 113.525 && lon <= 113.605;
}

// 台湾本岛 + 澎湖。金门/马祖紧贴厦门与福州, 用矩形圈会误伤大陆, 故不含。
function inTaiwan(lat, lon) {
  return lat >= 21.85 && lat <= 25.35 && lon >= 119.3 && lon <= 122.1;
}

/** 该来源在该位置是否直接给 WGS84 (即不需要做 GCJ 反算)。 */
export function usesWgs84Locally(lat, lon, src) {
  if (src !== "apple" && src !== "google") return false;
  return inMacau(lat, lon) || inTaiwan(lat, lon) || pointInPoly(lat, lon, HK_POLY);
}

/**
 * 按来源把坐标统一折算到 WGS84。text 源 (用户直接输入的裸坐标) 视为已是 WGS84。
 *
 * 注意分工: gcj02ToWgs84 回答的是「这两个坐标系在此处相差多少」, 这个关系在香港
 * 同样成立 (高德就在用)。所以港澳台的例外不能塞进那个函数里 —— 否则就没法让
 * 苹果走一条路、高德走另一条路。
 */
export function toWgs84(lat, lon, src) {
  if (src === "baidu") {
    const g = bd09ToGcj02(lat, lon);
    return gcj02ToWgs84(g.lat, g.lon);
  }
  if (src === "amap" || src === "apple" || src === "google") {
    if (usesWgs84Locally(lat, lon, src)) return { lat, lon };
    return gcj02ToWgs84(lat, lon);
  }
  return { lat, lon };
}
