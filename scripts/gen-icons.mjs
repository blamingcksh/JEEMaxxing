// Generates PWA icons (192, 512) + apple-touch-icon (180) as real PNG files.
// Pure Node (zlib) — no dependencies. Run: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- minimal PNG encoder (truecolor, no alpha for 512/192; RGBA for maskable) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- drawing helpers ----
function lerp(a, b, t) { return a + (b - a) * t; }
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const BG = [5, 5, 8];
const EDGE = [18, 20, 34];

function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? size * 0.14 : 0;
  const cx = size / 2, cy = size / 2;
  // bolt polygon (centered, 2:3 aspect) normalized to unit height
  const bolt = [
    [0.10, -0.02], [0.62, -0.02], [0.44, 0.28], [0.70, 0.28], [0.22, 0.62],
    [0.34, 0.28], [0.06, 0.28],
  ];
  const s = size * 0.30;
  const pts = bolt.map(([bx, by]) => [cx + bx * s, cy + by * s]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-square background
      const r = size * (maskable ? 0.20 : 0.16);
      const dx = Math.max(Math.abs(x - cx) - (size / 2 - r - pad), 0);
      const dy = Math.max(Math.abs(y - cy) - (size / 2 - r - pad), 0);
      const dist = Math.hypot(dx, dy);
      const rr = Math.min(1, Math.max(0, r - dist + 0.5));
      const edge = (Math.hypot(x - cx, y - cy) > size * 0.34);
      const base = edge ? EDGE : BG;
      // subtle vertical gradient on background
      const g = 1 - (y / size) * 0.35;
      // bolt: amber with slight vertical gradient
      let cr = base[0] * g, cg = base[1] * g, cb = base[2] * g;
      if (inPolygon(x + 0.5, y + 0.5, pts)) {
        const bt = (y / size) * 0.35;
        cr = lerp(0xff, 0xdd, bt);
        cg = lerp(0xb2, 0x8e, bt);
        cb = lerp(0x24, 0x18, bt);
      }
      const a = Math.max(0, Math.min(255, Math.round(rr * 255)));
      px[i] = cr; px[i + 1] = cg; px[i + 2] = cb; px[i + 3] = a;
    }
  }
  return px;
}

const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'icon-192.png'), png(192, 192, drawIcon(192)));
writeFileSync(join(outDir, 'icon-512.png'), png(512, 512, drawIcon(512)));
writeFileSync(join(outDir, 'icon-512-maskable.png'), png(512, 512, drawIcon(512, { maskable: true })));
writeFileSync(join(outDir, 'apple-touch-icon-180.png'), png(180, 180, drawIcon(180)));
console.log('icons written to', outDir);
