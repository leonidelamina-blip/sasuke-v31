import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { tmpDb, fakeCtx } from './helpers.js';
import { db, getGroup, setDir } from '../plugins/database.js';
import { findCommand, friendlyError } from '../commands/index.js';

const meta = { subject: 'G', participants: [{ id: '258840000001@s.whatsapp.net' }, { id: config.ownerNumber + '@s.whatsapp.net' }] };
const mention = j => ({ message: { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: [j] } } }, key: {} });
const run = async (name, over) => { const c = fakeCtx({ meta, level: 1, ...over }); await findCommand(name).run(c); return c; };
const last = c => c.out.at(-1).text;
const sockWith = status => ({ user: { id: '1:1@s.whatsapp.net' }, sendMessage: async () => {}, groupParticipantsUpdate: async (j, ids) => ids.map(id => ({ status: String(status), jid: id })) });

test('operações de grupo: lê o resultado real do WhatsApp (não anuncia sucesso falso)', async () => {
  tmpDb(); const m = mention('258840000001@s.whatsapp.net');
  for (const name of ['kick', 'promover', 'rebaixar']) {
    assert.match(last(await run(name, { sock: sockWith(200), m })), /@258840000001/, name + ' 200');
    assert.match(last(await run(name, { sock: sockWith(403), m })), /Não foi possível.*recusou/, name + ' 403');
    assert.match(last(await run(name, { sock: sockWith(404), m })), /não está no grupo/, name + ' 404');
    assert.match(last(await run(name, { sock: sockWith(409), m })), /já estava/, name + ' 409');
    assert.match(last(await run(name, { sock: sockWith(999), m })), /código 999/, name + ' 999');
  }
  const okBan = await run('ban', { sock: sockWith(200), m, jid: 'g@g.us' }); assert.match(last(okBan), /Removido do grupo/);
  const badBan = await run('ban', { sock: sockWith(403), m, jid: 'g@g.us' }); assert.match(last(badBan), /registado, mas não consegui removê-lo/);
  assert.deepEqual(getGroup('g@g.us').banned, ['258840000001']);
});

test('erros do WhatsApp são traduzidos; desconhecidos continuam a subir para o registo', async () => {
  assert.match(friendlyError({ data: 403 }), /administrador/); assert.match(friendlyError(new Error('forbidden')), /administrador/);
  assert.match(friendlyError({ output: { statusCode: 404 } }), /alvo/); assert.match(friendlyError(new Error('rate-overlimit')), /limitou/);
  assert.match(friendlyError(new Error('Timed Out')), /ligação/); assert.equal(friendlyError(new Error('bug qualquer')), null);
  const sock = { user: { id: '1:1@s.whatsapp.net' }, sendMessage: async () => {}, groupSettingUpdate: async () => { throw new Error('bug interno'); } };
  await assert.rejects(findCommand('abre').run(fakeCtx({ meta, sock, level: 1 })), /bug interno/);
  const deny = { ...sock, groupSettingUpdate: async () => { throw Object.assign(new Error('x'), { data: 403 }); } };
  const c = fakeCtx({ meta, sock: deny, level: 1 }); await findCommand('abre').run(c); assert.match(c.out.at(-1).text, /administrador/);
});

test('base de dados: ficheiro corrompido não é apagado em silêncio', async () => {
  const d = tmpDb(); fs.writeFileSync(path.join(d, 'orders.json'), '{"ORD-1": {"valor": 25,');
  const o = db('orders'); assert.deepEqual(o, {});
  const backups = fs.readdirSync(d).filter(f => f.startsWith('orders.json.corrupto-')); assert.equal(backups.length, 1);
  assert.match(fs.readFileSync(path.join(d, backups[0]), 'utf8'), /ORD-1/);
  setDir(d); assert.deepEqual(db('inexistente'), {}); assert.equal(fs.readdirSync(d).filter(f => f.startsWith('inexistente')).length, 0);
});
