/* ساخت آیکون‌های PNG برنامه بدون هیچ وابستگی بیرونی */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BRAND = [31, 122, 90];   // #1f7a5a
const WHITE = [255, 255, 255];

function makeIcon(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const radius = maskable ? size / 2 : size * 0.22;
  const cx = size / 2, cy = size / 2;

  const inRounded = (x, y) => {
    if (maskable) return true;                     // آیکون maskable کل بوم را پر می‌کند
    const dx = Math.max(Math.abs(x - cx) - (size / 2 - radius), 0);
    const dy = Math.max(Math.abs(y - cy) - (size / 2 - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };

  // میله‌های نمودار داخل ناحیه امن (۸۰٪ مرکزی برای maskable)
  const safe = maskable ? size * 0.7 : size * 0.62;
  const left = (size - safe) / 2;
  const barW = safe / 5;
  const gap = barW / 2;
  const baseY = (size + safe) / 2;
  const heights = [0.45, 0.75, 1.0];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = [0, 0, 0], a = 0;
      if (inRounded(x + 0.5, y + 0.5)) { c = BRAND; a = 255; }
      for (let b = 0; b < 3; b++) {
        const bx = left + b * (barW + gap);
        const topY = baseY - safe * heights[b];
        if (x >= bx && x < bx + barW && y >= topY && y <= baseY) { c = WHITE; a = 255; }
      }
      const i = (y * size + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
    }
  }
  return encodePng(px, size, size);
}

function encodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const out = path.join(__dirname, '..', 'app', 'icons');
fs.mkdirSync(out, { recursive: true });
[[192, false], [512, false], [512, true]].forEach(([s, m]) => {
  const name = m ? `icon-maskable-${s}.png` : `icon-${s}.png`;
  fs.writeFileSync(path.join(out, name), makeIcon(s, m));
  console.log('نوشته شد:', name);
});
