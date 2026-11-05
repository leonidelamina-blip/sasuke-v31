import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import config from '../config.js';
import { tmpDb, fakeCtx } from './helpers.js';
import { db, getGroup } from '../plugins/database.js';
import { commands, buildIndex, findCommand } from '../commands/index.js';
import { visibleFor } from '../commands/general.js';
import { nanoReply } from '../commands/nano.js';
import { CATEGORIAS } from '../plugins/style.js';
import os from 'node:os';
import path from 'node:path';
const REAL_PHOTO = config.ownerPhotoPath;
const useTmpPhoto = () => { config.ownerPhotoPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'foto-')), 'fundador.jpg'); };
test.after(() => { config.ownerPhotoPath = REAL_PHOTO; });

const run = (name, over) => { const c = fakeCtx(over); return findCommand(name).run(c).then(() => c); };
const last = c => c.out.at(-1);

test('registo: sem duplicados, todos completos', () => {
  assert.doesNotThrow(() => buildIndex());
  assert.throws(() => buildIndex([{ name: 'a' }, { name: 'b', aliases: ['a'] }]));
  for (const c of commands) {
    assert.equal(typeof c.run, 'function', c.name); assert.ok(CATEGORIAS.includes(c.cat), c.name + ' cat');
    assert.ok([1, 2, 3, 4].includes(c.level), c.name); assert.ok(c.desc, c.name);
  }
  for (const n of ['menu', 'v7', 'imenu', 'ajuda', 'menu-interativo', 'dono', 'criador', 'owner', 'donofoto', 'ping', 'perfil', 'sasuke', 'tempo', 'todos',
    'nanoadd', 'nanodel', 'listanano', 'abre', 'fecha', 'kick', 'promover', 'rebaixar', 'hidetag', 'mudar-nome-grupo', 'anti-link', 'ban', 'mutar', 'desmutar', 'so-admin',
    'bemvindo', 'saida', 'anticoncorrencia', 'antiestrangeiros', 'calcula']) assert.ok(findCommand(n), n);
});

test('menu: só mostra o que o nível pode usar', async () => {
  tmpDb();
  const member = visibleFor(commands, 4).map(c => c.name), owner = visibleFor(commands, 1).map(c => c.name);
  assert.ok(member.includes('ping') && !member.includes('nanoadd') && !member.includes('kick'));
  assert.ok(owner.includes('nanoadd') && owner.includes('kick') && owner.includes('ping'));
  const c = await run('menu', { commands, level: 4 });
  assert.match(last(c).text, /MENU PRINCIPAL/); assert.doesNotMatch(last(c).text, /ADMINISTRAÇÃO DO FUNDADOR/);
  const o = await run('menu', { commands, level: 1, text: 'fundador' });
  assert.match(last(o).text, /\.nanoadd/);
  const all = await run('menu', { commands, level: 4, text: 'tudo' });
  assert.doesNotMatch(last(all).text, /\.nanoadd/);
  const bad = await run('menu', { commands, level: 4, text: 'zzz' }); assert.match(last(bad).text, /ERRO/);
});

test('nano: adicionar, responder sem prefixo (maiúsculas), apagar, persistir', async () => {
  tmpDb();
  await run('nanoadd', { text: 'Tabela | Vodacom 1GB = 25 MT\nVodacom 2GB = 45 MT' });
  assert.match(last(await run('listanano')).text, /tabela/);
  for (const t of ['tabela', 'TABELA', 'Tabela', ' tabela! ']) assert.match(nanoReply(t), /Vodacom 2GB = 45 MT/, t);
  assert.equal(nanoReply('outra coisa'), null); assert.equal(nanoReply('__proto__'), null); assert.equal(nanoReply('constructor'), null);
  assert.match(last(await run('nanoadd', { text: 'sem barra' })).text, /ERRO/);
  assert.match(last(await run('nanoadd', { text: 'x |   ' })).text, /ERRO/);
  await run('nanodel', { text: 'TABELA' }); assert.equal(nanoReply('tabela'), null);
  assert.match(last(await run('nanodel', { text: 'tabela' })).text, /ERRO/);
});

test('dono: cartão em texto quando não há foto', async () => {
  tmpDb(); useTmpPhoto();
  const t = last(await run('dono')).text;
  for (const s of ['LEONIDE ANTÓNIO LÂMINA', '+258 852 223 969', 'leonidelamina.dev.2026@gmail.com', 'SASUKE V31 — GOD EDITION', 'https://whatsapp.com/channel/0029VbBfoWhAO7RJaD9mXy2k']) assert.ok(t.includes(s), s);
});
test('dono: envia imagem com legenda quando há foto', async () => {
  tmpDb(); useTmpPhoto();
  fs.writeFileSync(config.ownerPhotoPath, Buffer.from([0xff, 0xd8, 0xff]));
  try { const c = await run('dono'); assert.ok(Buffer.isBuffer(last(c).image)); assert.match(last(c).caption, /FUNDADOR/); }
  finally { fs.rmSync(config.ownerPhotoPath, { force: true }); }
  const c2 = fakeCtx(); c2.sock.profilePictureUrl = async () => 'https://pps.whatsapp.net/x.jpg';
  await findCommand('criador').run(c2); assert.equal(last(c2).image.url, 'https://pps.whatsapp.net/x.jpg');
});
test('donofoto sem imagem dá erro controlado', async () => { tmpDb(); assert.match(last(await run('donofoto')).text, /ERRO/); });

test('modo-gratis alterna o canal nas mensagens', async () => {
  tmpDb(); await run('modo-gratis', { args: ['on'] });
  assert.match(last(await run('ping')).text, /CANAL OFICIAL/);
  await run('modo-gratis', { args: ['off'] });
  assert.doesNotMatch(last(await run('ping')).text, /CANAL OFICIAL/);
});

test('segurança: toggles guardam por grupo; ban/mutar protegem o fundador', async () => {
  tmpDb();
  const meta = { subject: 'G', participants: [{ id: '258840000001@s.whatsapp.net' }, { id: '258852223969@s.whatsapp.net' }, { id: '258872698781@s.whatsapp.net' }] };
  await run('anti-link', { args: ['on'], jid: 'a@g.us' }); await run('bemvindo', { args: ['on'], jid: 'a@g.us' });
  assert.equal(getGroup('a@g.us').antilink, true); assert.equal(getGroup('a@g.us').welcome, true); assert.equal(getGroup('b@g.us').antilink, false);
  assert.match(last(await run('anti-link', { args: [], jid: 'a@g.us' })).text, /ACTIVO/);
  const mention = j => ({ message: { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: [j] } } }, key: {} });
  let called = 0;
  const sock = { user: { id: '258872698781:2@s.whatsapp.net' }, sendMessage: async () => {}, groupParticipantsUpdate: async () => { called++; } };
  assert.match(last(await run('ban', { meta, sock, m: mention('258852223969@s.whatsapp.net') })).text, /protegido/); assert.equal(called, 0);
  assert.match(last(await run('kick', { meta, sock, m: mention('258872698781@s.whatsapp.net') })).text, /protegido/);
  await run('ban', { meta, sock, jid: 'a@g.us', m: mention('258840000001@s.whatsapp.net') });
  assert.deepEqual(getGroup('a@g.us').banned, ['258840000001']); assert.equal(called, 1);
  await run('mutar', { meta, sock, jid: 'a@g.us', m: mention('258840000001@s.whatsapp.net') });
  assert.deepEqual(getGroup('a@g.us').muted, ['258840000001']);
  await run('desmutar', { meta, sock, jid: 'a@g.us', m: mention('258840000001@s.whatsapp.net') });
  assert.deepEqual(getGroup('a@g.us').muted, []);
  await run('anticoncorrencia', { args: ['add', 'Bot', 'Rival'], jid: 'a@g.us' });
  assert.deepEqual(getGroup('a@g.us').concorrencia, ['bot rival']);
});

test('grupo: hidetag/todos mencionam todos; calcula e erro controlado', async () => {
  tmpDb();
  const meta = { subject: 'G', participants: [{ id: '1@s.whatsapp.net' }, { id: '2@s.whatsapp.net' }] };
  const h = await run('hidetag', { meta, text: 'olá' }); assert.deepEqual(last(h).mentions, ['1@s.whatsapp.net', '2@s.whatsapp.net']);
  const t = await run('todos', { meta, text: 'reunião' }); assert.match(last(t).text, /@1/);
  assert.match(last(await run('calcula', { text: '(2+3)*4' })).text, /= 20/);
  assert.match(last(await run('calcula', { text: '1/0' })).text, /ERRO/);
});
