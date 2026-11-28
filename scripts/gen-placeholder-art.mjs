// Generates the placeholder pixel-art sprite sheets in src/assets/art/.
// Run with `npm run art:placeholder`. No dependencies: writes PNGs with node:zlib.
//
// The sheet layouts written here must match src/render/manifest.ts.
// When you replace a PNG with real art, keep the same frame size and
// row/column layout, or update the manifest to match your sheet.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'art');
mkdirSync(OUT, { recursive: true });

// ---------- tiny PNG encoder ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(sheet) {
  const { w, h, px } = sheet;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- drawing helpers ----------
function sheet(w, h) {
  return { w, h, px: Buffer.alloc(w * h * 4) };
}
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
/** A drawing context clipped to one frame cell of the sheet. */
function cell(s, cx, cy, cw, ch) {
  const put = (x, y, color) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= cw || y >= ch || !color) return;
    const [r, g, b, a] = hex(color);
    const i = ((cy + y) * s.w + cx + x) * 4;
    s.px[i] = r;
    s.px[i + 1] = g;
    s.px[i + 2] = b;
    s.px[i + 3] = a;
  };
  return {
    put,
    rect(x, y, w, h, c) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c);
    },
    ellipse(ex, ey, rx, ry, c, shade) {
      for (let y = Math.floor(ey - ry); y <= Math.ceil(ey + ry); y++)
        for (let x = Math.floor(ex - rx); x <= Math.ceil(ex + rx); x++) {
          const d = ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2;
          if (d <= 1) put(x, y, shade && y > ey + ry * 0.35 ? shade : c);
        }
    },
    line(x0, y0, x1, y1, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
    },
  };
}
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function save(name, s) {
  writeFileSync(join(OUT, name), encodePng(s));
  console.log(`wrote src/assets/art/${name} (${s.w}x${s.h})`);
}

// ---------- background: 256x144, 1 frame ----------
{
  const W = 256, H = 144;
  const s = sheet(W, H);
  const c = cell(s, 0, 0, W, H);
  const r = rng(7);
  const wall = ['#1b1622', '#211a29', '#271f30', '#2d2436'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c.put(x, y, wall[Math.min(3, Math.floor(y / 36))]);
  for (let i = 0; i < 260; i++) c.put(r() * W, r() * 110, r() < 0.5 ? '#352b40' : '#140f1a');
  // stalactites
  for (let i = 0; i < 14; i++) {
    const x = 8 + r() * 240, len = 4 + r() * 12;
    for (let j = 0; j < len; j++) c.rect(x - (len - j) / 5, j, ((len - j) / 5) * 2 + 1, 1, '#120d17');
  }
  // floor
  for (let y = 112; y < H; y++) for (let x = 0; x < W; x++) c.put(x, y, y < 114 ? '#4a3a4f' : '#3a2d40');
  for (let i = 0; i < 120; i++) c.put(r() * W, 114 + r() * 30, r() < 0.5 ? '#46374c' : '#2e2334');
  // tunnel mouth on the left
  c.ellipse(16, 112, 14, 30, '#07050a');
  c.rect(2, 100, 28, 12, '#07050a');
  for (let i = 0; i < 18; i++) c.put(4 + r() * 24, 84 + r() * 26, '#0f0b14');
  // a torch next to the tunnel
  c.rect(36, 78, 2, 10, '#5b3a22');
  c.rect(35, 74, 4, 4, '#f2a23a');
  c.put(36, 73, '#ffe27a');
  save('background.png', s);
}

// ---------- egg: 16x20 frames, row 0 = wobble (4) ----------
{
  const FW = 16, FH = 20;
  const s = sheet(FW * 4, FH);
  const offsets = [0, -1, 0, 1];
  offsets.forEach((dx, f) => {
    const c = cell(s, f * FW, 0, FW, FH);
    c.ellipse(8 + dx, 11, 6, 8, '#3f8f6e', '#2c6b52');
    c.put(5 + dx, 6, '#9fe0bf');
    c.put(6 + dx, 5, '#9fe0bf');
    c.put(9 + dx, 9, '#1f4d3b');
    c.put(6 + dx, 13, '#1f4d3b');
    c.put(10 + dx, 15, '#1f4d3b');
    if (f === 2) c.put(4, 3, '#fff6c2'); // a glint
  });
  save('egg.png', s);
}

// ---------- dragons: rows 0 = snore (4), 1 = count (4) ----------
function dragon(name, FW, FH, colors = {}) {
  const s = sheet(FW * 4, FH * 2);
  const k = FW / 64;
  const { body = '#b8443c', dark = '#7a2a28', belly = '#e3a35a', wing = '#8e3a3a' } = colors;
  for (let row = 0; row < 2; row++)
    for (let f = 0; f < 4; f++) {
      const c = cell(s, f * FW, row * FH, FW, FH);
      const breath = row === 0 ? [0, 1, 1, 0][f] * Math.max(1, k * 1.5) : 0;
      const bx = FW * 0.55, by = FH * 0.7;
      // tail curling round the front
      for (let t = 0; t < 1; t += 0.02) {
        const tx = bx + FW * 0.28 * Math.cos(t * 2.6), ty = by + FH * 0.18 * Math.sin(t * 2.6);
        c.ellipse(tx, ty, Math.max(1, 2.4 * k * (1 - t) + 0.6), Math.max(1, 2.4 * k * (1 - t) + 0.6), dark);
      }
      c.ellipse(bx, by - breath / 2, FW * 0.3, FH * 0.22 + breath / 2, body, dark);
      c.ellipse(bx - FW * 0.04, by + FH * 0.08, FW * 0.18, FH * 0.08, belly);
      // folded wing
      for (let i = 0; i < FW * 0.28; i++)
        c.line(bx - FW * 0.05 + i, by - FH * 0.15 - breath, bx + FW * 0.1 + i * 0.4, by - FH * 0.42 + i * 0.5 - breath, wing);
      // neck + head
      const hx = FW * 0.2, hy = FH * (row === 1 ? 0.5 : 0.6) + (row === 1 ? [0, 1, 2, 1][f] * k : 0);
      c.ellipse(FW * 0.3, by - FH * 0.08, FW * 0.08, FH * 0.12, body);
      c.ellipse(hx, hy, FW * 0.1, FH * 0.11, body, dark);
      c.rect(hx - FW * 0.17, hy - FH * 0.02, FW * 0.1, Math.max(2, FH * 0.09), body);
      c.put(hx - FW * 0.17, hy - FH * 0.01, dark); // nostril
      c.line(hx + FW * 0.03, hy - FH * 0.1, hx + FW * 0.09, hy - FH * 0.22, '#e8d9b0'); // horn
      if (row === 0) {
        c.line(hx - FW * 0.04, hy - FH * 0.03, hx, hy - FH * 0.03, '#2a0f0f'); // closed eye
        if (f >= 2) {
          // little z's drifting up
          const zx = hx + 2 + (f - 2) * 3 * k, zy = hy - FH * 0.25 - (f - 2) * 3 * k;
          c.line(zx, zy, zx + 2, zy, '#dfe8ff');
          c.line(zx + 2, zy, zx, zy + 2, '#dfe8ff');
          c.line(zx, zy + 2, zx + 2, zy + 2, '#dfe8ff');
        }
      } else {
        c.put(hx - FW * 0.03, hy - FH * 0.03, '#ffd84a'); // open eye
        // claw lifting a coin to look at it
        const cy2 = by + FH * 0.05 - [0, 2, 4, 2][f] * k;
        c.ellipse(FW * 0.14, cy2, Math.max(1, 2 * k), Math.max(1, 2 * k), body);
        c.ellipse(FW * 0.1, cy2 - 2 * k, Math.max(1, 1.5 * k), Math.max(1, 1.5 * k), f === 2 ? '#fff3a0' : '#e8b830');
      }
    }
  save(name, s);
}
dragon('wyrmling.png', 32, 24);
dragon('young-dragon.png', 48, 36);
dragon('adult-dragon.png', 64, 48);
// older dragons darken, then go bronze with age
dragon('elder-dragon.png', 72, 54, { body: '#8e2f4a', dark: '#561a30', belly: '#d98f6a', wing: '#6e2440' });
dragon('ancient-dragon.png', 80, 60, { body: '#a8743a', dark: '#5e3c1c', belly: '#ecd08a', wing: '#7e5426' });

// ---------- hoard: 112x40 frames, row 0 = sizes 0..5 (picked by hoard level) ----------
{
  const FW = 112, FH = 40, N = 6;
  const s = sheet(FW * N, FH);
  // All copper for now: the pile shows what the hoard holds, and it only
  // holds copper until silver and gold arrive.
  const copper = ['#b87333', '#8a5226', '#e09a5c'];
  const palettes = [copper, copper, copper, copper, copper, copper];
  for (let f = 0; f < N; f++) {
    const c = cell(s, f * FW, 0, FW, FH);
    const r = rng(100 + f);
    const rx = 10 + f * 9, ry = 3 + f * 6;
    const [base, shade, hi] = palettes[f];
    c.ellipse(FW / 2, FH - 1, rx, ry, base, shade);
    for (let i = 0; i < 20 + f * 30; i++) {
      const a = r() * Math.PI, d = Math.sqrt(r());
      const x = FW / 2 + Math.cos(a) * rx * d, y = FH - 1 - Math.sin(a) * ry * d;
      c.put(x, y, r() < 0.4 ? hi : shade);
    }
    // a few bright glints on the bigger piles
    if (f >= 3) for (let i = 0; i < f * 2; i++) c.put(FW / 2 - rx * 0.7 + r() * rx * 1.4, FH - 2 - r() * ry * 0.8, '#f6c08a');
  }
  save('hoard.png', s);
}

// ---------- metals: 112x40 frames, same sizes as the hoard; row 0 = silver coins, row 1 = gold ----------
// Drawn over the copper pile, so only the coins are painted; the rest is clear.
{
  const FW = 112, FH = 40, N = 6;
  const s = sheet(FW * N, FH * 2);
  const metals = [['#c9ced6', '#8f97a3', '#f2f4f7'], ['#e8b830', '#a87d16', '#fff0a0']];
  metals.forEach(([base, shade, hi], row) => {
    for (let f = 0; f < N; f++) {
      const c = cell(s, f * FW, row * FH, FW, FH);
      const r = rng(300 + row * 10 + f);
      const rx = 10 + f * 9, ry = 3 + f * 6;
      for (let i = 0; i < 6 + f * 14; i++) {
        const a = r() * Math.PI, d = Math.sqrt(r());
        const x = FW / 2 + Math.cos(a) * rx * d * 0.9, y = FH - 2 - Math.sin(a) * ry * d * 0.9;
        c.put(x, y, base);
        c.put(x + 1, y, r() < 0.5 ? shade : hi);
      }
    }
  });
  save('metals.png', s);
}

// ---------- kobolds: 12x12 frames; row 0 = walk (4), 1 = carry (4), 2 = work (4) ----------
// The chief variant wears a cape and a little crown, and row 2 is a pointing
// "directing" pose instead of swinging a pick.
function kobold(name, skin, dark, extra, chief = false, load = 'coins') {
  const FW = 12, FH = 12;
  const s = sheet(FW * 4, FH * 3);
  for (let row = 0; row < 3; row++)
    for (let f = 0; f < 4; f++) {
      const c = cell(s, f * FW, row * FH, FW, FH);
      const bob = row < 2 && f % 2 === 1 ? 1 : 0;
      if (chief) c.rect(2, 5 + bob, 2, 5, '#b8443c'); // cape
      c.line(2, 8 - bob, 0, 7 - bob, dark); // tail
      c.rect(3, 5 + bob, 4, 4, skin); // body
      c.rect(5, 2 + bob, 4, 3, skin); // head
      c.rect(9, 3 + bob, 2, 2, skin); // snout
      c.put(7, 3 + bob, '#1a1a1a'); // eye
      c.put(5, 1 + bob, dark); // horn
      if (extra) c.rect(3, 6 + bob, 4, 1, extra); // belt / cloth
      if (chief) {
        c.rect(6, 1 + bob, 3, 1, '#e8b830'); // crown
        c.put(6, 0 + bob, '#e8b830');
        c.put(8, 0 + bob, '#e8b830');
      }
      // legs
      if (row < 2) {
        const step = [0, 1, 0, -1][f];
        c.rect(3 + step, 9, 1, 3, dark);
        c.rect(6 - step, 9, 1, 3, dark);
      } else {
        c.rect(3, 9, 1, 3, dark);
        c.rect(6, 9, 1, 3, dark);
      }
      if (row === 1 && load === 'mushroom') {
        // carrying a chunk of mushroom stalk overhead
        c.rect(3, 0 + bob, 6, 2, '#d8c9a8');
        c.rect(3, 0 + bob, 1, 2, '#a8946c');
        c.put(8, 0 + bob, '#f0e4c8');
      } else if (row === 1 && load === 'meat') {
        // carrying a haunch of monster meat over the shoulder
        c.rect(4, 0 + bob, 5, 2, '#a83a3a');
        c.put(9, 1 + bob, '#e8e0d0'); // bone
        c.put(4, 0 + bob, '#d06060');
      } else if (row === 1) {
        // carrying a coin sack overhead
        c.ellipse(6, 1 + bob, 2.5, 1.6, '#b87333');
        c.put(5, 0 + bob, '#e09a5c');
      }
      if (row === 2 && chief) {
        // pointing: directing the warren
        const up = f % 2 === 0;
        c.line(7, 6, 10, up ? 4 : 6, skin);
        c.put(11, up ? 3 : 6, skin);
      } else if (row === 2) {
        // swinging a pick
        const up = f < 2;
        c.line(8, 6, up ? 10 : 11, up ? 1 : 8, '#6b4a2b');
        c.line(up ? 9 : 10, up ? 1 : 9, up ? 11 : 11, up ? 2 : 7, '#c0c8d0');
        if (f === 2) c.put(11, 10, '#fff3a0'); // spark
      }
    }
  save(name, s);
}
kobold('kobold-scavenger.png', '#7a8f3a', '#4d5a24', '#8a5226');
kobold('kobold-digger.png', '#5a7f9a', '#36506a', '#c0c8d0');
kobold('kobold-woodcutter.png', '#a0583a', '#6a3624', '#3f8f6e', false, 'mushroom');
kobold('kobold-quarrier.png', '#7a5a9a', '#4a3666', '#9a9aa8');
kobold('kobold-idle.png', '#8a8a6a', '#55553f', null);
kobold('kobold-researcher.png', '#b0b8c8', '#6a7080', '#e8e8f0'); // lab coat
kobold('kobold-miner.png', '#6a6a72', '#3c3c44', '#e8b830', false, 'coins');
kobold('kobold-herder.png', '#8fa060', '#5a6a38', '#d07a40');
kobold('kobold-alchemist.png', '#9a6ab8', '#5e3e74', '#5ad0a0');
kobold('kobold-blacksmith.png', '#7a7a80', '#3e3e44', '#e0782a');
kobold('kobold-shaman.png', '#b08a5a', '#6a4e2e', '#e8e0d0'); // bone necklace
kobold('kobold-hunter.png', '#5e7a4a', '#3a4e2c', '#7a4a2a', false, 'meat'); // leather
kobold('kobold-scout.png', '#c09a5a', '#7a5e34', '#3a6a8a', false, 'coins'); // travel cloak

// ---------- hats for named kobolds: 12x12 frames, one row of 6 looks ----------
// Drawn over a kobold's frame at the same spot, so they sit on the head.
{
  const FW = 12, FH = 12, N = 6;
  const s = sheet(FW * N, FH);
  const colors = ['#e0405a', '#4a8ae0', '#e8b830', '#5ad0a0', '#e9e1d4', '#c070e0'];
  for (let f = 0; f < N; f++) {
    const c = cell(s, f * FW, 0, FW, FH);
    const col = colors[f];
    if (f % 3 === 0) {
      // pointy hat
      c.rect(5, 1, 4, 1, col);
      c.rect(6, 0, 2, 1, col);
    } else if (f % 3 === 1) {
      // cap with a brim
      c.rect(5, 1, 3, 1, col);
      c.rect(5, 0, 2, 1, col);
      c.rect(8, 1, 2, 1, col);
    } else {
      // a feather
      c.rect(5, 1, 4, 1, col);
      c.line(5, 1, 3, -1, '#f6f0d0');
      c.put(4, 0, '#f6f0d0');
    }
  }
  save('hats.png', s);
}
kobold('kobold-chief.png', '#c9a13a', '#7d6220', '#5b3a22', true);
