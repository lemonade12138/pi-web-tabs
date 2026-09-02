// 按官方 SVG 坐标重绘 pi.dev 启动图标，输出全套尺寸
// 用法: node gen-icons.js
const zlib = require("zlib");
const fs = require("fs");

const crc32 = (b) => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  let c = 0xFFFFFFFF;
  for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const encodePng = (S, px) => {
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) Buffer.from(px.slice(y * S * 4, (y + 1) * S * 4)).copy(raw, y * (S * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
};

// 官网 SVG 坐标: 800x800 画布, rx=120 圆角, 白色 Pi 图形
const draw = (S) => {
  const k = S / 800, r = 120 * k;
  const inPoly = (x, y, pts) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      if (((pts[i][1] > y) !== (pts[j][1] > y)) && (x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0])) c = !c;
    return c;
  };
  const P = [[165.29,165.29],[517.36,165.29],[517.36,400],[400,400],[400,517.36],[282.65,517.36],[282.65,634.72],[165.29,634.72]].map(p => [p[0]*k, p[1]*k]);
  const HOLE = [[282.65,282.65],[400,282.65],[400,400],[282.65,400]].map(p => [p[0]*k, p[1]*k]);
  const B = [[517.36,400],[634.72,400],[634.72,634.72],[517.36,634.72]].map(p => [p[0]*k, p[1]*k]);
  const px = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let n = 0; // 0=透明 1..3=黑 4+=白 (2x2 超采样)
    for (const [dx, dy] of [[0.25,0.25],[0.75,0.25],[0.25,0.75],[0.75,0.75]]) {
      const sx = x + dx, sy = y + dy;
      const cx = Math.max(r, Math.min(S - r, sx)), cy = Math.max(r, Math.min(S - r, sy));
      const inside = (sx >= r && sx <= S - r) || (sy >= r && sy <= S - r) || ((sx-cx)**2 + (sy-cy)**2 <= r*r);
      if (!inside) continue;
      n += (inPoly(sx, sy, P) && !inPoly(sx, sy, HOLE)) || inPoly(sx, sy, B) ? 2 : 1;
    }
    if (n === 0) { px.push(0, 0, 0, 0); continue; }
    const v = n > 4 ? 255 : 9;
    px.push(v, v, v, Math.min(255, n * 64));
  }
  return encodePng(S, px);
};

// favicon.ico: 多尺寸打包
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => ({ s, data: draw(s) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = pngs.map(({ s, data }) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});
fs.writeFileSync("app/favicon.ico", Buffer.concat([header, ...entries, ...pngs.map(p => p.data)]));

// 全尺寸 PNG + apple-touch
fs.writeFileSync("public/icons/icon-192.png", draw(192));
fs.writeFileSync("public/icons/icon-512.png", draw(512));
fs.writeFileSync("public/icons/apple-touch-icon.png", draw(180));
console.log("全套图标已生成: favicon.ico + icon-192/512 + apple-touch-icon");
