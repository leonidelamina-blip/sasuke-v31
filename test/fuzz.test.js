import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import config from '../config.js';
import { tmpDb, fakeCtx } from './helpers.js';
import { commands } from '../commands/index.js';
import { deps } from '../commands/utility.js';

globalThis.fetch = async () => { throw new Error('offline'); };
deps.fetch = async () => { throw new Error('offline'); };
deps.safeFetch = async () => { throw new Error('offline'); };

const INPUTS = ['', 'abc', '    ', '😀'.repeat(60), 'a'.repeat(5000), '| | |', '-1', '99999999999999999999', '../../etc/passwd', '<script>alert(1)</script>',
  '0', '1 2 3', 'on', 'off', 'del', 'add', 'x | y | z', 'ORD-NAOEXISTE', 'ALG-NAOEXISTE', '258840000001', '258840000001 100', '2026-01-01 10:00 | x', '30m | x', 'null undefined', '\n\n\n', '%s %d {} ${x}'];
const META = { subject: 'Grupo', announce: false, participants: [
  { id: config.ownerNumber + '@s.whatsapp.net', admin: null }, { id: '258840000001@s.whatsapp.net', admin: 'admin' }, { id: '258872698781@s.whatsapp.net', admin: 'admin' }] };
const BAD = /undefined|NaN|\[object Object\]|Infinity/;
const okSock = () => ({ user: { id: '258872698781:1@s.whatsapp.net' }, sentAll: [], sendMessage: async function (j, c) { this.sentAll.push(c); return {}; },
  profilePictureUrl: async () => { throw new Error('sem foto'); }, groupParticipantsUpdate: async () => [], groupSettingUpdate: async () => {}, groupUpdateSubject: async () => {},
  groupInviteCode: async () => 'abc', groupLeave: async () => {} });
const denySock = () => { const s = okSock(); for (const k of ['groupParticipantsUpdate', 'groupSettingUpdate', 'groupUpdateSubject', 'groupInviteCode', 'groupLeave']) s[k] = async () => { throw Object.assign(new Error('forbidden'), { data: 403 }); }; return s; };

async function runOne(cmd, text, { sock = okSock(), getMedia = async () => null, msg = {}, level = 1 } = {}) {
  const c = fakeCtx({ text, args: text.split(/\s+/).filter(Boolean), level, phone: config.ownerNumber, sender: config.ownerNumber + '@s.whatsapp.net',
    isGroup: !!cmd.group, jid: cmd.group ? '120@g.us' : config.ownerNumber + '@s.whatsapp.net', meta: cmd.group ? META : null, botIsAdmin: true,
    sock, getMedia, commands, m: { key: { id: 'X', remoteJid: '120@g.us' }, message: msg, messageTimestamp: Math.floor(Date.now() / 1000) } });
  await cmd.run(c);
  return { c, sock };
}
const texts = c => [...c.out.map(o => o.text ?? o.caption ?? ''), ...(c.sock.sentAll ?? []).map(o => o.text ?? o.caption ?? '')];

test('stress: todos os comandos × 26 entradas — nunca rebentam, respondem e não mostram lixo', async () => {
  const problems = [];
  for (const cmd of commands) {
    for (const input of INPUTS) {
      tmpDb();
      try {
        const { c, sock } = await runOne(cmd, input);
        const replies = c.out.length + sock.sentAll.length;
        if (!replies) problems.push(`${cmd.name} [${JSON.stringify(input.slice(0, 20))}] sem resposta`);
        for (const t of texts(c)) { const bad = t.match(BAD)?.[0]; if (bad && !input.includes(bad)) problems.push(`${cmd.name} [${JSON.stringify(input.slice(0, 20))}] lixo: ${bad}`); if (t.length > 8000) problems.push(`${cmd.name} resposta enorme (${t.length})`); }
      } catch (e) { problems.push(`${cmd.name} [${JSON.stringify(input.slice(0, 20))}] EXCEPÇÃO: ${e.message}`); }
    }
  }
  assert.deepEqual([...new Set(problems)].slice(0, 40), []);
});

test('stress: níveis baixos e comandos de dono em contexto de membro respondem sem rebentar', async () => {
  const problems = [];
  for (const cmd of commands) for (const input of ['', 'abc', '258840000001 10']) {
    tmpDb();
    try { const { c, sock } = await runOne(cmd, input, { level: 4 }); if (!c.out.length && !sock.sentAll.length) problems.push(`${cmd.name} (membro) sem resposta`); }
    catch (e) { problems.push(`${cmd.name} (membro) EXCEPÇÃO: ${e.message}`); }
  }
  assert.deepEqual([...new Set(problems)].slice(0, 30), []);
});

test('stress: media inválida/gigante/corrompida nos comandos multimédia e comprovativos', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
  const bufs = [Buffer.alloc(0), Buffer.from('lixo'), Buffer.alloc(11 * 1024 * 1024, 1), png.subarray(0, 20), Buffer.from(png)];
  const problems = [];
  for (const name of ['fig', 'toimage', 'hd', 'blur', 'pixel', 'gray', 'invert', 'comprovativo', 'donofoto']) {
    const cmd = commands.find(c => c.name === name);
    for (const type of ['image', 'video', 'sticker']) for (const buffer of bufs.slice(0, 4)) {
      tmpDb();
      try { const { c, sock } = await runOne(cmd, '', { getMedia: async () => ({ buffer, type, seconds: 5, mimetype: 'x' }) }); if (!c.out.length && !sock.sentAll.length) problems.push(`${name}/${type} sem resposta`); }
      catch (e) { problems.push(`${name}/${type}/${buffer.length} EXCEPÇÃO: ${e.message}`); }
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('stress: o WhatsApp recusa operações (bot sem admin) — comandos de grupo não rebentam', async () => {
  const problems = [];
  const m = { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: ['258840000001@s.whatsapp.net'], stanzaId: 'ABC', participant: '258840000001@s.whatsapp.net' } } };
  for (const cmd of commands.filter(c => c.group)) for (const input of ['', 'on', '258840000001', 'Novo nome', 'on 22:00 06:00']) {
    tmpDb();
    try { await runOne(cmd, input, { sock: denySock(), msg: m }); }
    catch (e) { problems.push(`${cmd.name} [${input}] propaga: ${e.message}`); }
  }
  assert.deepEqual([...new Set(problems)], []);
});
