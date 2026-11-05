import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDb } from './helpers.js';
import { db, save, flush, getGroup, setDir } from '../plugins/database.js';
import { formatarMensagem, formatarErro, formatarSucesso, sasuke, emojiFor, frasesFrias } from '../plugins/style.js';
import * as S from '../plugins/security.js';
import { calc, normalizePhone, formatPhone, unwrap, getText, describeWeather, fmtUptime } from '../plugins/utils.js';

test('style: template com rodapé e frase', () => {
  tmpDb();
  const t = formatarMensagem('Teste', ['linha 1', '👑 com emoji']);
  assert.match(t, /🩸 TESTE/); assert.match(t, /┃ 🩸 linha 1/); assert.match(t, /┃ 👑 com emoji/);
  assert.match(t, /SASUKE V31 • GOD EDITION/); assert.match(t, /Dono: Leo - 852223969/);
  assert.match(t, /wa\.me\/258852223969/); assert.ok(frasesFrias.some(f => t.includes(f)));
  assert.doesNotMatch(t, /CANAL OFICIAL/);
});
test('style: modo grátis acrescenta canal', () => {
  tmpDb(); db('settings').freeMode = true;
  assert.match(formatarMensagem('x', ['a']), /CANAL OFICIAL:\nhttps:\/\/whatsapp\.com\/channel/);
  assert.doesNotMatch(formatarMensagem('x', ['a'], { gratis: false }), /CANAL OFICIAL/);
});
test('style: erro, sucesso, sasuke e emojis', () => {
  tmpDb();
  assert.match(formatarErro('falhou'), /ERRO/); assert.match(formatarSucesso('ok'), /CONCLUÍDO/); assert.match(sasuke('olá'), /olá/);
  assert.equal(emojiFor('ping'), '⚡'); assert.equal(emojiFor('ajuda', 'menu'), '📜'); assert.equal(emojiFor('xyz', 'xyz'), '🔥');
  assert.equal(emojiFor('anti-link'), '🔗'); assert.equal(emojiFor('ban'), '🔨');
});

test('database: persiste após "reinício"', async () => {
  const d = tmpDb();
  db('nano').tabela = 'preços'; await save('nano');
  setDir(d);
  assert.equal(db('nano').tabela, 'preços');
});
test('database: escritas concorrentes não corrompem o ficheiro', async () => {
  const d = tmpDb();
  const o = db('users');
  await Promise.all(Array.from({ length: 50 }, (_, i) => { o['u' + i] = i; return save('users'); }));
  await flush();
  const disk = JSON.parse(fs.readFileSync(path.join(d, 'users.json'), 'utf8'));
  assert.equal(Object.keys(disk).length, 50);
  assert.ok(!fs.existsSync(path.join(d, 'users.json.tmp')));
});
test('database: grupo recebe valores por omissão', () => {
  tmpDb(); const g = getGroup('1@g.us');
  assert.equal(g.antilink, false); assert.deepEqual(g.muted, []); assert.equal(getGroup('1@g.us'), g);
});

test('security: níveis e verificação do fundador', () => {
  assert.equal(S.getLevel({ phone: '258852223969' }), 1);
  assert.equal(S.getLevel({ phone: '258852223969', isGroupAdmin: true }), 1);
  assert.equal(S.getLevel({ phone: '258840000001', isGroupAdmin: true }), 3);
  assert.equal(S.getLevel({ phone: '258840000001' }), 4);
  assert.equal(S.getLevel({ phone: '' }), 4);
  assert.ok(S.can(1, 4)); assert.ok(S.can(3, 3)); assert.ok(!S.can(3, 1)); assert.ok(!S.can(4, 3));
});
test('security: LID só vira número real se resolvido', () => {
  const parts = [{ id: '999@lid', phoneNumber: '258852223969@s.whatsapp.net' }];
  assert.equal(S.resolvePhone('999@lid', parts), '258852223969');
  assert.equal(S.resolvePhone('555@lid', parts), '');
  assert.equal(S.resolvePhone('258840000001:7@s.whatsapp.net'), '258840000001');
  assert.equal(S.getLevel({ phone: S.resolvePhone('555@lid', parts) }), 4);
});
test('security: bot admin detectado', () => {
  const meta = { participants: [{ id: '258872698781@s.whatsapp.net', admin: 'admin' }, { id: '1@s.whatsapp.net' }] };
  assert.ok(S.isBotAdmin(meta, { id: '258872698781:3@s.whatsapp.net' }));
  assert.ok(!S.isBotAdmin({ participants: [{ id: '258872698781@s.whatsapp.net' }] }, { id: '258872698781:3@s.whatsapp.net' }));
});
test('security: rate limiter e dedupe', () => {
  const rl = S.createRateLimiter({ max: 2, windowMs: 1000 });
  assert.ok(rl.hit('a', 0)); assert.ok(rl.hit('a', 10)); assert.ok(!rl.hit('a', 20)); assert.ok(rl.hit('a', 2000)); assert.ok(rl.hit('b', 0));
  const d = S.createDedupe(); assert.equal(d('x'), false); assert.equal(d('x'), true);
});
test('security: moderação isenta admins', () => {
  tmpDb(); const cfg = getGroup('g@g.us'); cfg.antilink = true; cfg.muted.push('258840000001');
  assert.equal(S.moderate(cfg, { text: 'olha https://x.com', level: 4, phone: '258840000002' }), 'link');
  assert.equal(S.moderate(cfg, { text: 'olha https://x.com', level: 3, phone: '258840000002' }), null);
  assert.equal(S.moderate(cfg, { text: 'oi', level: 4, phone: '258840000001' }), 'mutado');
  cfg.anticoncorrencia = true; cfg.concorrencia = ['Bot Rival'];
  assert.equal(S.moderate(cfg, { text: 'melhor que o bot rival!', level: 4, phone: '1' }), 'concorrencia');
  assert.equal(S.moderate(cfg, { text: 'bom dia', level: 4, phone: '1' }), null);
});
test('security: estrangeiros e URLs seguras', () => {
  assert.ok(S.isForeign('351912345678', ['258'])); assert.ok(!S.isForeign('258840000001', ['258'])); assert.ok(!S.isForeign('', ['258']));
  for (const u of ['http://localhost/x', 'http://127.0.0.1', 'http://10.0.0.5', 'http://192.168.1.1', 'http://172.16.0.1', 'http://169.254.169.254', 'file:///etc/passwd', 'http://[::1]/', 'http://user:p@x.com', 'ftp://x.com'])
    assert.equal(S.isSafeUrl(u), false, u);
  assert.ok(S.isSafeUrl('https://api.open-meteo.com/v1/forecast'));
});

test('utils: calculadora segura', () => {
  assert.equal(calc('(2+3)*4'), 20); assert.equal(calc('2^3^2'), 512); assert.equal(calc('-3+5'), 2); assert.equal(calc('10/4'), 2.5);
  assert.equal(calc('0,1+0,2'), 0.3); assert.equal(calc('10%3'), 1);
  for (const bad of ['1/0', '2+', 'process.exit()', '(1', '1)', '', '2**', 'a+1']) assert.throws(() => calc(bad), bad);
});
test('utils: números, texto e meteorologia', () => {
  assert.equal(normalizePhone('+258 87 269 8781'), '258872698781'); assert.equal(normalizePhone('872698781'), '258872698781');
  assert.equal(normalizePhone('0027831234567'), '27831234567'); assert.equal(normalizePhone('123'), null); assert.equal(normalizePhone('abc'), null);
  assert.equal(formatPhone('258852223969'), '+258 852 223 969');
  assert.equal(getText(unwrap({ ephemeralMessage: { message: { extendedTextMessage: { text: 'oi' } } } })), 'oi');
  assert.equal(describeWeather(0), 'Céu limpo'); assert.equal(describeWeather(95), 'Trovoada'); assert.match(fmtUptime(3661), /1h 1m 1s/);
});
