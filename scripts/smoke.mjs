// Teste de integração do index.js com um Baileys SIMULADO (copia o projecto para uma pasta temporária;
// nunca toca em node_modules nem na sessão reais).  Uso: node scripts/smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sasuke-smoke-'));
fs.cpSync(root, tmp, { recursive: true, filter: s => !/node_modules|sessao|\.git|\/temp\/|assets\/owner/.test(s) });
fs.mkdirSync(path.join(tmp, 'temp'), { recursive: true });
const nm = path.join(tmp, 'node_modules'); fs.mkdirSync(path.join(nm, '@whiskeysockets/baileys'), { recursive: true }); fs.mkdirSync(path.join(nm, 'pino'), { recursive: true });
const realSharp = path.join(root, 'node_modules', 'sharp');
if (fs.existsSync(realSharp)) fs.symlinkSync(fs.realpathSync(realSharp), path.join(nm, 'sharp'));
fs.writeFileSync(path.join(nm, 'pino/package.json'), '{"name":"pino","type":"module","main":"index.js"}');
fs.writeFileSync(path.join(nm, 'pino/index.js'), 'export default () => ({});');
fs.writeFileSync(path.join(nm, '@whiskeysockets/baileys/package.json'), '{"name":"@whiskeysockets/baileys","type":"module","main":"index.js"}');
fs.writeFileSync(path.join(nm, '@whiskeysockets/baileys/index.js'), `
import { EventEmitter } from 'node:events';
export default function makeWASocket() {
  const ev = new EventEmitter(), sent = [];
  const sock = { ev: { on: (e, f) => ev.on(e, f), emit: (...a) => ev.emit(...a) }, sent, user: { id: '258872698781:1@s.whatsapp.net' },
    sendMessage: async (j, c) => { sent.push({ j, c }); return {}; },
    groupMetadata: async () => ({ subject: 'Grupo', participants: [
      { id: '111@lid', phoneNumber: '258852223969@s.whatsapp.net', admin: null }, { id: '258840000001@s.whatsapp.net', admin: 'admin' },
      { id: '258840000002@s.whatsapp.net' }, { id: '258872698781@s.whatsapp.net', admin: 'admin' }] }),
    profilePictureUrl: async () => { throw new Error('x'); }, groupParticipantsUpdate: async (...a) => { sent.push({ kick: a }); }, groupSettingUpdate: async (...a) => { sent.push({ setting: a }); } };
  globalThis.__made = (globalThis.__made || 0) + 1;
  sock.requestPairingCode = async n => { (globalThis.__paired ??= []).push(n); return '12345678'; };
  globalThis.__sock = sock;
  if (process.env.STUB_REGISTERED === '0') setTimeout(() => ev.emit('connection.update', { qr: 'x' }), 30);
  else queueMicrotask(() => ev.emit('connection.update', { connection: 'open' }));
  return sock;
}
export const useMultiFileAuthState = async () => ({ state: { creds: { registered: process.env.STUB_REGISTERED !== '0' } }, saveCreds() {} });
export const fetchLatestBaileysVersion = async () => ({ version: [2, 3000, 1] });
export const DisconnectReason = { loggedOut: 401 };
export const Browsers = { ubuntu: () => ['Ubuntu', 'Chrome', '1'] };
export const downloadMediaMessage = async () => globalThis.__png;
`);
fs.writeFileSync(path.join(tmp, '_driver.mjs'), `
process.env.SASUKE_DB_DIR = ${JSON.stringify(path.join(tmp, 'db'))};
import sharp from 'sharp';
const svg = '<svg width="1000" height="260"><rect width="100%" height="100%" fill="white"/><text x="30" y="90" font-size="52" font-family="DejaVu Sans" fill="black">Confirmado QK7M2X9PW4.</text><text x="30" y="170" font-size="52" font-family="DejaVu Sans" fill="black">Transferiste 25.00MT em 05/11/2026</text></svg>';
globalThis.__png = await sharp(Buffer.from(svg)).png().toBuffer();
await import('./index.js'); await new Promise(r => setTimeout(r, 300));
const s = globalThis.__sock; let n = 0, fail = 0;
const T = (name, cond) => { if (!cond) fail++; console.log(cond ? 'OK  ' : 'FAIL', name); };
const OWNER_LID = '111@lid', OWNER = '258852223969@s.whatsapp.net', ADM = '258840000001@s.whatsapp.net', MEM = '258840000002@s.whatsapp.net', CLI = '258840000005@s.whatsapp.net';
const GRP = '120@g.us';
const send = async (message, who, jid = GRP, wait = 150) => { s.sent.length = 0; const key = { id: 'M' + (++n), remoteJid: jid }; if (jid.endsWith('@g.us')) key.participant = who;
  s.ev.emit('messages.upsert', { type: 'notify', messages: [{ key, message, messageTimestamp: Math.floor(Date.now() / 1000) }] }); await new Promise(r => setTimeout(r, wait)); return [...s.sent]; };
const txt = (t, who, jid) => send({ conversation: t }, who, jid);
const has = (o, re) => o.some(x => re.test(x.c?.text || x.c?.caption || ''));
let o;
o = await txt('.ping', MEM); T('ping + reacção ⚡', o.some(x => x.c.react?.text === '⚡') && has(o, /PING/));
o = await txt('.nanoadd tabela | x', ADM); T('admin comum não usa comando do fundador', has(o, /Sem permissão/) && !o.some(x => x.c.react));
o = await txt('.setmegas Vodacom | 1GB | 25', OWNER_LID); T('fundador (via LID) configura preços', has(o, /1GB = 25,00 MT/));
o = await txt('.compra Vodacom 1GB 846000001', CLI, CLI); T('compra em privado cria encomenda', has(o, /ENCOMENDA CRIADA/) && o.some(x => x.j === OWNER && /Nova encomenda/.test(x.c.text)));
o = await txt('.auto-comprovativo on', OWNER, OWNER); T('fundador activa auto-comprovativo', has(o, /activado/));
o = await send({ imageMessage: { mimetype: 'image/png', fileLength: 1000 } }, CLI, CLI, 4000); T('imagem no privado → OCR → EM ANÁLISE (sem aprovar)', has(o, /EM ANÁLISE/) && o.some(x => x.j === OWNER && /análise manual/.test(x.c.text)));
o = await txt('.regpagamento QK7M2X9PW4 | 25', OWNER, OWNER); T('registo independente aprova e avisa o cliente', has(o, /aprovadas: 1/) && o.some(x => x.j === CLI && /APROVADO/.test(x.c.text)));
await txt('.nanoadd tabela | Vodacom 1GB = 25 MT', OWNER_LID); o = await txt('TABELA', MEM); T('nano responde sem prefixo (maiúsculas)', has(o, /Vodacom 1GB = 25 MT/));
await txt('.auto-responder add horário | Abrimos às 8h', OWNER, OWNER);
o = await txt('qual o horário?', MEM); T('auto-responder por palavra', has(o, /Abrimos às 8h/));
o = await send({ imageMessage: { mimetype: 'image/png', fileLength: 1000, caption: '.fig' } }, MEM); T('.fig com imagem envia sticker', o.some(x => Buffer.isBuffer(x.c.sticker)));
o = await txt('.fecha', ADM); T('admin fecha grupo + 🔒', o.some(x => x.setting) && o.some(x => x.c.react?.text === '🔒'));
await txt('.anti-link on', ADM); await txt('.auto-remover on', ADM);
o = await txt('vê https://a.com', MEM); T('anti-link apaga (1)', o.some(x => x.c.delete));
await txt('outra https://b.com', MEM); o = await txt('e https://c.com', MEM);
T('3ª infracção em 24h → removido', o.some(x => x.kick && x.kick[2] === 'remove'));
o = await txt('https://ok.com', ADM); T('anti-link isenta admin', !o.some(x => x.c.delete));
await txt('.bot off', OWNER, OWNER); o = await txt('.ping', MEM); T('.bot off: membro ignorado', o.length === 0);
o = await txt('.ping', OWNER_LID); T('.bot off: fundador continua a ser atendido', has(o, /PING/));
await txt('.bot on', OWNER, OWNER);
o = await txt('.dono', MEM); T('.dono envia cartão', has(o, /LEONIDE/) && o.some(x => x.c.react?.text === '👑'));
await txt('.bemvindo on', ADM); s.sent.length = 0; s.ev.emit('group-participants.update', { id: GRP, participants: ['258840000009@s.whatsapp.net'], action: 'add' });
await new Promise(r => setTimeout(r, 150)); T('boas-vindas com menção', s.sent.some(x => /BEM-VINDO/.test(x.c.text || '') && x.c.mentions?.length));
const { flush } = await import('./plugins/database.js'); await flush(); process.exit(fail ? 1 : 0);
`);
fs.writeFileSync(path.join(tmp, '_driver2.mjs'), `
process.env.SASUKE_DB_DIR = ${JSON.stringify(path.join(tmp, 'db2'))};
await import('./index.js'); await new Promise(r => setTimeout(r, 400));
let fail = 0; const T = (name, cond) => { if (!cond) fail++; console.log(cond ? 'OK  ' : 'FAIL', name); };
T('pareamento: número normalizado (872698781 → 258872698781) e código pedido', JSON.stringify(globalThis.__paired) === '["258872698781"]');
globalThis.__sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
await new Promise(r => setTimeout(r, 7500));
T('reconexão após 515 (novo socket)', globalThis.__made === 2);
T('novo código pedido na nova ligação, sem duplicados do temporizador antigo', globalThis.__paired.length === 2);
process.exit(fail ? 1 : 0);
`);
const r2 = spawnSync(process.execPath, ['_driver2.mjs'], { cwd: tmp, encoding: 'utf8', timeout: 60_000, env: { ...process.env, BOT_NUMBER: '872698781', STUB_REGISTERED: '0' } });
const r = spawnSync(process.execPath, ['_driver.mjs'], { cwd: tmp, encoding: 'utf8', timeout: 90_000 });
console.log(r2.stdout.split('\n').filter(l => /^(OK|FAIL)/.test(l)).join('\n')); if (r2.status) console.log(r2.stderr.slice(-800));
console.log(r.stdout.split('\n').filter(l => /^(OK|FAIL)/.test(l)).join('\n') || r.stdout); if (r.status) console.log(r.stderr.slice(-1500));
fs.rmSync(tmp, { recursive: true, force: true }); process.exit((r.status || r2.status) ? 1 : 0);
