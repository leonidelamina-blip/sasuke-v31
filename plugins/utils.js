/** Utilitários puros (sem WhatsApp) — totalmente testáveis. */

export const toNum = v => (typeof v === 'number' ? v : v?.toNumber?.() ?? Number(v));

export function fmtUptime(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m ${s % 60}s`;
}

export const normalizeText = s => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function formatPhone(p) {
  p = String(p).replace(/\D/g, '');
  if (p.length < 10) return '+' + p;
  return '+' + p.slice(0, 3) + ' ' + p.slice(3).replace(/(\d{3})(?=\d)/g, '$1 ');
}

/** Valida e normaliza um número. 9 dígitos a começar por 8 → junta o indicativo por omissão. */
export function normalizePhone(input, cc = '258') {
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d[0] === '8') d = cc + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** Remove invólucros (efémera, view-once, documento com legenda). */
export function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 ||
      m.viewOnceMessageV2Extension || m.documentWithCaptionMessage;
    if (!inner?.message) break;
    m = inner.message;
  }
  return m;
}

export function getText(content) {
  if (!content) return '';
  return content.conversation || content.extendedTextMessage?.text ||
    content.imageMessage?.caption || content.videoMessage?.caption ||
    content.documentMessage?.caption || '';
}

export function getContextInfo(content) {
  if (!content) return null;
  for (const v of Object.values(content)) if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
  return null;
}

/** Calculadora segura (parser recursivo; sem eval). Suporta + - * / % ^ e parêntesis. */
export function calc(expr) {
  const s = String(expr).replace(/\s+/g, '').replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/');
  if (!s || s.length > 200 || !/^[0-9+\-*/%^().]+$/.test(s)) throw new Error('Expressão inválida');
  let i = 0;
  const bad = () => { throw new Error('Expressão inválida'); };
  const num = () => {
    const st = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    const v = Number(s.slice(st, i));
    if (st === i || Number.isNaN(v)) bad();
    return v;
  };
  const primary = () => {
    if (s[i] === '(') { i++; const v = expr_(); if (s[i] !== ')') bad(); i++; return v; }
    return num();
  };
  const power = () => { const b = primary(); if (s[i] === '^') { i++; return b ** unary(); } return b; };
  const unary = () => {
    if (s[i] === '-') { i++; return -unary(); }
    if (s[i] === '+') { i++; return unary(); }
    return power();
  };
  const term = () => {
    let v = unary();
    while (i < s.length && '*/%'.includes(s[i])) {
      const o = s[i++]; const r = unary();
      if ((o === '/' || o === '%') && r === 0) throw new Error('Divisão por zero');
      v = o === '*' ? v * r : o === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr_ = () => {
    let v = term();
    while (i < s.length && (s[i] === '+' || s[i] === '-')) { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; }
    return v;
  };
  const result = expr_();
  if (i !== s.length || !Number.isFinite(result)) bad();
  return Number(result.toPrecision(12));
}

const WMO = [
  [[0], 'Céu limpo'], [[1, 2, 3], 'Parcialmente nublado'], [[45, 48], 'Nevoeiro'],
  [[51, 53, 55, 56, 57], 'Chuvisco'], [[61, 63, 65, 66, 67], 'Chuva'],
  [[71, 73, 75, 77, 85, 86], 'Neve'], [[80, 81, 82], 'Aguaceiros'], [[95, 96, 99], 'Trovoada']
];
export const describeWeather = code => WMO.find(([c]) => c.includes(code))?.[1] ?? 'Condição desconhecida';

/* ───────── dinheiro ───────── */
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sameMoney = (a, b) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
export const fmtMT = n => `${round2(n).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT`;

/** "1.500,00" / "1,500.00" / "25,5" / "25.50MT" → número (ou null). */
export function parseMoney(str) {
  if (/^\s*[-−–]/.test(String(str ?? ''))) return null;   // valores negativos nunca são aceites
  const s = String(str ?? '').replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastCom = s.lastIndexOf(',');
  let dec = -1;
  if (lastDot >= 0 && lastCom >= 0) dec = Math.max(lastDot, lastCom);
  else {
    const sep = lastDot >= 0 ? '.' : lastCom >= 0 ? ',' : null;
    if (sep) {
      const count = s.split(sep).length - 1, tail = s.length - s.lastIndexOf(sep) - 1;
      if (count === 1 && tail !== 3) dec = s.lastIndexOf(sep);
    }
  }
  const out = dec >= 0 ? s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1) : s.replace(/[.,]/g, '');
  const n = Number(out);
  return Number.isFinite(n) ? round2(n) : null;
}

/* ───────── tempo (Maputo = UTC+2, sem hora de verão) ───────── */
const OFFSET_MS = 2 * 3600e3;
export const nowHM = (now = Date.now()) => new Date(now + OFFSET_MS).toISOString().slice(11, 16);
export const fmtDateTime = (ms) => new Date(ms + OFFSET_MS).toISOString().replace('T', ' ').slice(0, 16);

/** '2026-11-10 14:30', '10/11/2026 14:30', '14:30', '30m', '2h', '1d' → timestamp (ms) ou null. */
export function parseWhen(str, now = Date.now()) {
  const s = String(str || '').trim();
  let m = s.match(/^(\d+)\s*(m|min|h|d)$/i);
  if (m) return now + Number(m[1]) * { m: 60e3, min: 60e3, h: 3600e3, d: 86400e3 }[m[2].toLowerCase()];
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) { const d = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})$/); if (d) m = [0, d[3], d[2], d[1], d[4], d[5]]; }
  if (m) {
    const ts = Date.parse(`${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}T${String(m[4]).padStart(2, '0')}:${m[5]}:00+02:00`);
    return Number.isNaN(ts) ? null : ts;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const [h, mi] = [Number(m[1]), Number(m[2])]; if (h > 23 || mi > 59) return null;
    const local = new Date(now + OFFSET_MS); local.setUTCHours(h, mi, 0, 0);
    let ts = local.getTime() - OFFSET_MS; if (ts <= now) ts += 86400e3; return ts;
  }
  return null;
}

/** Janela de fecho (ex.: 22:00 → 06:00, atravessa a meia-noite). */
export function inClosedWindow(hm, close, open) {
  return close > open ? (hm >= close || hm < open) : (hm >= close && hm < open);
}
export const validHM = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

/** Operadora pelo prefixo de um número moçambicano de 9 dígitos. */
export function operatorOf(num9) {
  const p = String(num9).slice(0, 2);
  return { 84: 'Vodacom', 85: 'Vodacom', 86: 'Movitel', 87: 'Movitel', 82: 'Tmcel', 83: 'Tmcel' }[p] ?? null;
}
export const isMzNumber = s => /^8[2-7]\d{7}$/.test(String(s));

export function getQuotedText(message) {
  const q = unwrap(getContextInfo(unwrap(message))?.quotedMessage);
  return getText(q).trim();
}
