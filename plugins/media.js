import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config.js';

const run = promisify(execFile);
export const LIMITS = { image: 10 * 1024 * 1024, video: 15 * 1024 * 1024, stickerBytes: 1024 * 1024 };
const sharpLib = async () => (await import('sharp')).default;
const open = async (buf) => {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('Imagem inválida');
  if (buf.length > LIMITS.image) throw new Error('Imagem demasiado grande (máx. 10 MB)');
  return (await sharpLib())(buf, { limitInputPixels: 40e6 }).rotate();
};

/** Pasta temporária própria, sempre limpa no fim. */
export async function withTemp(fn) {
  const base = path.join(config.root, 'temp'); await fsp.mkdir(base, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(base, 'm-'));
  try { return await fn(dir); } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

/* ───────── sticker ↔ imagem ───────── */
export async function toSticker(buf) {
  return (await open(buf)).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
}
export async function stickerToImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length > LIMITS.image) throw new Error('Sticker inválido');
  return (await sharpLib())(buf, { limitInputPixels: 40e6 }).png().toBuffer();
}

/** Vídeo/GIF curto → sticker animado (FFmpeg). Tenta qualidades decrescentes até caber em 1 MB. */
export async function videoToSticker(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('Vídeo inválido');
  if (buf.length > LIMITS.video) throw new Error('Vídeo demasiado grande (máx. 15 MB)');
  return withTemp(async dir => {
    const inp = path.join(dir, 'in'), out = path.join(dir, 'out.webp');
    await fsp.writeFile(inp, buf);
    for (const [q, fps] of [[50, 12], [30, 10], [18, 8]]) {
      const vf = `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`;
      try { await run('ffmpeg', ['-y', '-v', 'error', '-t', '8', '-i', inp, '-vf', vf, '-an', '-loop', '0', '-c:v', 'libwebp_anim', '-q:v', String(q), out], { timeout: 60_000 }); }
      catch (e) { throw new Error(e.code === 'ENOENT' ? 'FFMPEG_INDISPONIVEL' : 'Não foi possível converter o vídeo'); }
      const o = await fsp.readFile(out);
      if (o.length <= LIMITS.stickerBytes) return o;
    }
    throw new Error('O sticker animado ficou acima de 1 MB; usa um vídeo mais curto');
  });
}

/* ───────── efeitos (cada um altera mesmo a imagem) ───────── */
export async function hd(buf) {
  const img = await open(buf), { width } = await (await open(buf)).metadata();
  const target = Math.min(width * 2, 2560);
  return img.resize({ width: target, kernel: 'lanczos3' }).sharpen({ sigma: 1.1 }).jpeg({ quality: 92 }).toBuffer();
}
export async function blur(buf) { return (await open(buf)).blur(15).jpeg({ quality: 90 }).toBuffer(); }
export async function gray(buf) { return (await open(buf)).grayscale().jpeg({ quality: 90 }).toBuffer(); }
export async function invert(buf) { return (await open(buf)).negate({ alpha: false }).jpeg({ quality: 90 }).toBuffer(); }
export async function pixel(buf) {
  const base = await (await open(buf)).toBuffer({ resolveWithObject: true });
  const { width, height } = base.info, small = Math.max(8, Math.round(width / 24)), sharp = await sharpLib();
  const tiny = await sharp(base.data).resize({ width: small, kernel: 'nearest' }).toBuffer();
  return sharp(tiny).resize({ width, height, kernel: 'nearest' }).jpeg({ quality: 90 }).toBuffer();
}

/* ───────── texto → sticker ───────── */
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function wrapText(text, max = 12) {
  const lines = []; let cur = '';
  for (const w of String(text).trim().split(/\s+/)) {
    const word = w.length > max ? w.match(new RegExp(`.{1,${max}}`, 'g')).join(' ') : w;
    for (const part of word.split(' ')) {
      if (!cur) cur = part; else if ((cur + ' ' + part).length <= max) cur += ' ' + part; else { lines.push(cur); cur = part; }
    }
  }
  if (cur) lines.push(cur); return lines;
}
export function textSvg(text, fill = '#ffffff') {
  const lines = wrapText(text.slice(0, 120)), n = lines.length, widest = Math.max(...lines.map(l => l.length), 1);
  const size = Math.max(28, Math.min(110, Math.floor(430 / n), Math.floor(470 / (widest * 0.62))));
  const body = lines.map((l, i) => `<text x="256" y="${(256 + (i - (n - 1) / 2) * size * 1.2).toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${fill}" stroke="#000" stroke-width="${(size / 10).toFixed(1)}" paint-order="stroke">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><style>text{font-family:'DejaVu Sans',Arial,sans-serif;font-weight:bold;font-size:${size}px}</style>${body}</svg>`;
}
export async function ttp(text) {
  if (!text?.trim()) throw new Error('Texto vazio');
  return (await sharpLib())(Buffer.from(textSvg(text))).webp({ quality: 90 }).toBuffer();
}
const hsl = (h) => { const a = 0.5 * Math.min(0.55, 1 - 0.55), f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (0.55 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join(''); };
export async function attp(text) {
  if (!text?.trim()) throw new Error('Texto vazio');
  const sharp = await sharpLib();
  return withTemp(async dir => {
    for (let i = 0; i < 12; i++) await sharp(Buffer.from(textSvg(text, hsl(i * 30)))).png().toFile(path.join(dir, `f${String(i).padStart(2, '0')}.png`));
    const out = path.join(dir, 'out.webp');
    try { await run('ffmpeg', ['-y', '-v', 'error', '-framerate', '8', '-i', path.join(dir, 'f%02d.png'), '-loop', '0', '-c:v', 'libwebp_anim', '-q:v', '60', out], { timeout: 60_000 }); }
    catch (e) { throw new Error(e.code === 'ENOENT' ? 'FFMPEG_INDISPONIVEL' : 'Não foi possível criar o sticker animado'); }
    return fsp.readFile(out);
  });
}
