// Generates the placeholder app icon, Android adaptive icon layers, splash mark and favicon.
// No image libraries: shapes are drawn with signed distance functions and written as PNG with
// Node's zlib. Re-run with `node scripts/make-icons.mjs` after changing the colors below.
// The mark: a route (thick amber line) from a start ring to an end dot. Replace with a real
// logo before publishing.
import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const AMBER = [245, 158, 11]
const INK = [17, 19, 24] // matches android.adaptiveIcon.backgroundColor in app.config.ts
const WHITE = [255, 255, 255]

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
// opaque=true writes RGB (color type 2): the App Store rejects an app icon with an alpha channel.
function png(size, rgba, opaque = false) {
  const bpp = opaque ? 3 : 4
  const raw = Buffer.alloc((size * bpp + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * bpp + 1)] = 0
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < bpp; c++) raw[y * (size * bpp + 1) + 1 + x * bpp + c] = rgba[(y * size + x) * 4 + c]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// Mark geometry in a 0..1 box (scaled into each image's content area).
const A = [0.26, 0.74], B = [0.74, 0.26]
function segDist(p, a, b) {
  const pa = [p[0] - a[0], p[1] - a[1]], ba = [b[0] - a[0], b[1] - a[1]]
  const h = Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1]) / (ba[0] * ba[0] + ba[1] * ba[1])))
  return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h)
}
// Returns coverage 0..1 of the mark at point p (mark units).
function markAt(p) {
  const line = segDist(p, A, B) < 0.055
  const dStart = Math.hypot(p[0] - A[0], p[1] - A[1])
  const startRing = dStart < 0.13 && dStart > 0.065
  const startHole = dStart <= 0.065
  const endDot = Math.hypot(p[0] - B[0], p[1] - B[1]) < 0.13
  return (line && !startHole) || startRing || endDot
}

// bg: [r,g,b] or null (transparent). content: fraction of the image the mark's box fills.
function render(size, { bg, fg, content, radius = 0, opaque = false }) {
  const out = Buffer.alloc(size * size * 4)
  const SS = 3
  const off = (1 - content) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size
        if (markAt([(u - off) / content, (v - off) / content])) hits++
      }
      const a = hits / (SS * SS)
      const i = (y * size + x) * 4
      let base = bg ? [...bg, 255] : [0, 0, 0, 0]
      if (bg && radius > 0) {
        // rounded square background (favicon)
        const r = radius * size, cx = Math.min(Math.max(x + 0.5, r), size - r), cy = Math.min(Math.max(y + 0.5, r), size - r)
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) base = [0, 0, 0, 0]
      }
      const fa = a * 255
      if (base[3] === 0) { out[i] = fg[0]; out[i + 1] = fg[1]; out[i + 2] = fg[2]; out[i + 3] = Math.round(fa) }
      else for (let c = 0; c < 3; c++) { out[i + c] = Math.round(base[c] * (1 - a) + fg[c] * a); out[i + 3] = 255 }
    }
  }
  return png(size, out, opaque)
}

const files = {
  'icon.png': render(1024, { bg: INK, fg: AMBER, content: 0.72, opaque: true }), // iOS: no transparency
  'android-icon-foreground.png': render(1024, { bg: null, fg: AMBER, content: 0.5 }), // inside the adaptive safe zone
  'android-icon-background.png': render(1024, { bg: INK, fg: INK, content: 0.5 }),
  'android-icon-monochrome.png': render(1024, { bg: null, fg: WHITE, content: 0.5 }),
  'splash-icon.png': render(1024, { bg: null, fg: AMBER, content: 0.6 }), // shown on the light and dark splash backgrounds
  'favicon.png': render(48, { bg: INK, fg: AMBER, content: 0.72, radius: 0.2 }),
}
for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(OUT, name), buf)
  console.log('wrote', name, buf.length, 'bytes')
}
