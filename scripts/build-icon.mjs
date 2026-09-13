// 生成项目图标 assets/icon.png —— 纯本地绘制, 不引用任何第三方图片资源。
//
// 为什么自己写 PNG 编码而不是拉个库: 图标是模块 #!icon= 的目标, 必须是仓库里
// 自有的位图。引入 sharp/canvas 会给一个零依赖的项目挂上原生编译依赖, 而这里
// 要画的东西只有「圆角矩形 + 定位针」, 手写 8 位 RGBA 扫描线比装依赖便宜得多。
//
// 用法: node scripts/build-icon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;
// 超采样再降采样: 直接按像素判断内外会让圆角和针尖出现锯齿, 4x4 取平均即可。
const SS = 4;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const TOP = hex("#3FA9FF");
const BOTTOM = hex("#0A5BD3");
const INK = hex("#FFFFFF");

// 圆角矩形: 到「内缩矩形」的距离场, <= r 即在形内。
function inRoundRect(x, y, w, h, r) {
  const dx = Math.max(Math.abs(x - w / 2) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(y - h / 2) - (h / 2 - r), 0);
  return Math.hypot(dx, dy) <= r;
}

// 定位针 = 上方圆头 + 下方切线三角。三角的两条腰取圆的切线, 接缝处才不会鼓出来。
function inPin(x, y, cx, cy, r, tipY) {
  if (Math.hypot(x - cx, y - cy) <= r) return true;
  if (y < cy || y > tipY) return false;
  const d = tipY - cy;
  if (d <= r) return false;
  // 圆心到针尖的距离 d, 切点处半宽按相似三角形收缩。
  const half = (r * Math.sqrt(d * d - r * r)) / d;
  const t = (y - cy) / (tipY - cy);
  const w = half * (1 - t) + 0 * t;
  const yc = cy + (r * r) / d;
  if (y < yc) return Math.hypot(x - cx, y - cy) <= r;
  return Math.abs(x - cx) <= w * ((tipY - y) / (tipY - yc));
}

const px = Buffer.alloc(SIZE * SIZE * 4);
const CX = SIZE / 2;
const PIN_CY = SIZE * 0.42;
const PIN_R = SIZE * 0.17;
const PIN_TIP = SIZE * 0.78;
const HOLE_R = SIZE * 0.068;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let cover = 0;
    let ink = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS;
        const fy = y + (sy + 0.5) / SS;
        if (!inRoundRect(fx, fy, SIZE, SIZE, SIZE * 0.225)) continue;
        cover++;
        const hole = Math.hypot(fx - CX, fy - PIN_CY) <= HOLE_R;
        if (!hole && inPin(fx, fy, CX, PIN_CY, PIN_R, PIN_TIP)) ink++;
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    if (!cover) {
      px[o] = px[o + 1] = px[o + 2] = px[o + 3] = 0;
      continue;
    }
    const bg = mix(TOP, BOTTOM, y / (SIZE - 1));
    const c = mix(bg, INK, ink / cover);
    px[o] = Math.round(c[0]);
    px[o + 1] = Math.round(c[1]);
    px[o + 2] = Math.round(c[2]);
    px[o + 3] = Math.round((cover / n) * 255);
  }
}

// PNG: 每条扫描线前置一个 filter 字节, 这里统一用 0 (None)。
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(resolve(root, "assets"), { recursive: true });
writeFileSync(resolve(root, "assets/icon.png"), png);
console.log(`assets/icon.png  ${SIZE}x${SIZE}  ${png.length} bytes`);
