import config from '../config.js';
import crypto from 'node:crypto';
import net from 'node:net';
import { normalizeText } from './utils.js';

export const LEVEL = { OWNER: 1, BOT: 2, ADMIN: 3, MEMBER: 4 };
export const LEVEL_NAME = { 1: 'FUNDADOR', 2: 'BOT', 3: 'ADMINISTRADOR', 4: 'MEMBRO' };

export const toPhone = jid => (jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

/** Converte um JID (número ou LID) em número real. Devolve '' se não for possível resolver. */
export function resolvePhone(jid, participants = []) {
  if (!jid) return '';
  if (jid.endsWith('@s.whatsapp.net')) return toPhone(jid);
  const p = participants.find(x => x.id === jid || x.lid === jid);
  const pn = p?.phoneNumber || p?.jid;
  if (pn) return toPhone(pn);
  return jid.endsWith('@lid') ? '' : toPhone(jid);
}

export function participantMatches(p, jid, phone) {
  const ids = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(toPhone);
  return ids.includes(toPhone(jid)) || (!!phone && ids.includes(phone));
}

export function isBotAdmin(meta, user) {
  if (!meta || !user) return false;
  const mine = [user.id, user.lid].filter(Boolean).map(toPhone);
  return meta.participants.some(p => p.admin &&
    [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(toPhone).some(x => mine.includes(x)));
}

/** O fundador só é reconhecido pelo número real resolvido — nunca por nomes ou texto. */
export const isOwnerPhone = phone => !!phone && phone === config.ownerNumber;

export function getLevel({ phone, isGroupAdmin = false, isBotSelf = false }) {
  if (isOwnerPhone(phone)) return LEVEL.OWNER;
  if (isBotSelf) return LEVEL.BOT;
  if (isGroupAdmin) return LEVEL.ADMIN;
  return LEVEL.MEMBER;
}
export const can = (userLevel, required) => userLevel <= required;

export function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
      if (arr.length >= max) { hits.set(key, arr); return false; }
      arr.push(now); hits.set(key, arr); return true;
    }
  };
}

export function createDedupe(ttlMs = 60_000) {
  const seen = new Map();
  return id => {
    const now = Date.now();
    for (const [k, t] of seen) if (now - t > ttlMs) seen.delete(k);
    if (seen.has(id)) return true;
    seen.set(id, now); return false;
  };
}

export const hasLink = text => /(https?:\/\/|chat\.whatsapp\.com\/|\bwww\.)\S+/i.test(text || '');

/** Moderação de grupo. Admins e fundador são isentos. Devolve o motivo ou null. */
export function moderate(cfg, { text = '', level, phone }) {
  if (level <= LEVEL.ADMIN) return null;
  if (phone && cfg.muted.includes(phone)) return 'mutado';
  if (cfg.antilink && hasLink(text)) return 'link';
  if (cfg.anticoncorrencia && cfg.concorrencia.length) {
    const t = normalizeText(text);
    if (cfg.concorrencia.some(w => t.includes(normalizeText(w)))) return 'concorrencia';
  }
  return null;
}

/** Só marca como estrangeiro se o número real for conhecido (nunca remove "às cegas"). */
export function isForeign(phone, allowed = config.allowedCountryCodes) {
  return !!phone && !allowed.some(c => phone.startsWith(c));
}

/** Validação anti-SSRF para obtenção de conteúdo remoto (usada nas fases seguintes). */
export function isSafeUrl(str) {
  let u; try { u = new URL(str); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return false;
  return true;
}

/** IP privado/reservado (v4 e v6). Usado contra SSRF. */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return isPrivateIp(mapped[1]);
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true;
}

/** Strikes: devolve quantas infracções o membro tem nas últimas 24h. */
export function addStrike(cfg, phone, now = Date.now(), windowMs = 86400e3) {
  const arr = (cfg.strikes[phone] || []).filter(t => now - t < windowMs);
  arr.push(now); cfg.strikes[phone] = arr; return arr.length;
}

export const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
export function tokenMatches(given, storedHash) {
  if (!given || !storedHash) return false;
  const a = Buffer.from(hashToken(given)), b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
