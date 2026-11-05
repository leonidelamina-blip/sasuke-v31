import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import config from '../config.js';
import { tmpDb, fakeCtx } from './helpers.js';
import { db, getGroup, setDir, flush } from '../plugins/database.js';
import { parseMoney, parseWhen, inClosedWindow, operatorOf, nowHM, fmtDateTime } from '../plugins/utils.js';
import * as P from '../plugins/payments.js';
import * as O from '../plugins/orders.js';
import * as E from '../plugins/economy.js';
import * as R from '../plugins/rentals.js';
import * as SC from '../plugins/scheduler.js';
import * as N from '../plugins/net.js';
import * as AI from '../plugins/ai.js';
import * as M from '../plugins/media.js';
import { isPrivateIp, hashToken, addStrike } from '../plugins/security.js';
import { findCommand, commands } from '../commands/index.js';
import { autoReply } from '../commands/automation.js';
import { deps } from '../commands/utility.js';

const run = async (name, over) => { const c = fakeCtx(over); await findCommand(name).run(c); return c; };
const last = c => c.out.at(-1);
const DAY = 86400e3;

test('utils: dinheiro, tempo (Maputo), operadoras', () => {
  assert.equal(parseMoney('1.500,00'), 1500); assert.equal(parseMoney('1,500.00'), 1500); assert.equal(parseMoney('25,5'), 25.5);
  assert.equal(parseMoney('25.50MT'), 25.5); assert.equal(parseMoney('1.500'), 1500); assert.equal(parseMoney('abc'), null); assert.equal(parseMoney('-5'), null); assert.equal(parseMoney('−5'), null); assert.equal(parseMoney('100'), 100);
  const now = Date.parse('2026-11-05T10:00:00Z');                       // 12:00 em Maputo
  assert.equal(nowHM(now), '12:00'); assert.equal(parseWhen('2026-11-10 14:30', now), Date.parse('2026-11-10T12:30:00Z'));
  assert.equal(parseWhen('10/11/2026 14:30', now), Date.parse('2026-11-10T12:30:00Z')); assert.equal(parseWhen('30m', now), now + 1800e3);
  assert.equal(parseWhen('11:00', now), Date.parse('2026-11-06T09:00:00Z')); assert.equal(parseWhen('lixo', now), null); assert.equal(parseWhen('25:99', now), null);
  assert.ok(inClosedWindow('23:00', '22:00', '06:00') && inClosedWindow('03:00', '22:00', '06:00') && !inClosedWindow('12:00', '22:00', '06:00'));
  assert.ok(inClosedWindow('13:30', '13:00', '14:00') && !inClosedWindow('15:00', '13:00', '14:00'));
  assert.equal(operatorOf('846123456'), 'Vodacom'); assert.equal(operatorOf('866123456'), 'Movitel'); assert.equal(operatorOf('826123456'), 'Tmcel'); assert.equal(operatorOf('906123456'), null);
});

test('comprovativos: extracção de referência/valor/data', () => {
  const a = P.parseProofText('Confirmado ABC1D2E3F4. Transferiste 150.00MT para 841234567 em 05/11/2026 as 10:30.');
  assert.deepEqual(a, { ref: 'ABC1D2E3F4', amount: 150, date: '2026-11-05' });
  const b = P.parseProofText('ID da transacao: XY12345678Z Valor: 1.250,50 MT Data 5-11-26');
  assert.deepEqual(b, { ref: 'XY12345678Z', amount: 1250.5, date: '2026-11-05' });
  assert.equal(P.parseProofText('olá, paguei já').ref, null); assert.equal(P.parseProofText('841234567 pagou 25 MT').ref, null);
});

test('comprovativos: OCR real (tesseract) lê a referência de uma imagem', async () => {
  const svg = '<svg width="1000" height="260"><rect width="100%" height="100%" fill="white"/><text x="30" y="90" font-size="52" font-family="DejaVu Sans" fill="black">Confirmado QK7M2X9PW4.</text><text x="30" y="170" font-size="52" font-family="DejaVu Sans" fill="black">Transferiste 150.00MT em 05/11/2026</text></svg>';
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const p = P.parseProofText(await P.ocrImage(png));
  assert.equal(p.ref, 'QK7M2X9PW4'); assert.equal(p.amount, 150);
  await assert.rejects(P.ocrImage(Buffer.from('não é imagem')));
  assert.deepEqual(fs.readdirSync(path.join(config.root, 'temp')).filter(f => f.startsWith('ocr-')), []);
});

test('pagamentos: nunca aprova sem confirmação independente; bloqueia reutilização', async () => {
  tmpDb();
  const o1 = O.createOrder({ client: '258840000001', dest: '846000001', operator: 'Vodacom', product: '1GB', value: 25 });
  let v = await P.applyProof(o1.id, { ref: 'REF111AAA1', amount: 25 });
  assert.deepEqual([v.status, v.reasons[0], O.getOrder(o1.id).state], ['ANALISE', 'SEM_CONFIRMACAO_INDEPENDENTE', 'EM ANÁLISE']);
  const rec = await P.registerAndReconcile({ ref: 'ref111aaa1', amount: 25 });
  assert.equal(rec.approved.length, 1); assert.equal(O.getOrder(o1.id).state, 'APROVADO');
  const o2 = O.createOrder({ client: '258840000002', dest: '846000002', operator: 'Vodacom', product: '1GB', value: 25 });
  v = await P.applyProof(o2.id, { ref: 'REF111AAA1', amount: 25 });
  assert.deepEqual([v.status, v.reasons[0]], ['BLOQUEADO', 'REFERENCIA_REUTILIZADA']); assert.equal(O.getOrder(o2.id).state, 'PENDENTE');
  await P.registerAndReconcile({ ref: 'REF222BBB2', amount: 20 });
  v = await P.applyProof(o2.id, { ref: 'REF222BBB2', amount: 25 });
  assert.deepEqual([v.status, v.reasons[0], O.getOrder(o2.id).state], ['ANALISE', 'VALOR_INCOMPATIVEL', 'EM ANÁLISE']);
  assert.throws(() => P.registerReceived({ ref: 'REF111AAA1', amount: 25 }), /já registada/);
  assert.throws(() => P.registerReceived({ ref: 'x', amount: 25 }));
  await assert.rejects(P.applyProof(o1.id, { ref: 'REF333CCC3' }), /APROVADO/);
});

test('encomendas: duplicadas, transições, depósito credita uma só vez', async () => {
  tmpDb();
  const a = O.createOrder({ client: '1', dest: '846000001', operator: 'Vodacom', product: '1GB', value: 25 });
  assert.throws(() => O.createOrder({ client: '1', dest: '846000001', operator: 'Vodacom', product: '1GB', value: 25 }), e => e instanceof O.DuplicateOrder && e.order.id === a.id);
  await O.setState(a.id, 'CANCELADO', { by: '1' });
  await assert.rejects(O.setState(a.id, 'APROVADO'), /Transição inválida/);
  await O.setState(a.id, 'PENDENTE', { by: 'dono' }); assert.equal(O.getOrder(a.id).admin, 'dono');
  const d = O.createOrder({ client: '2', type: 'DEPOSITO', value: 100, kind: 'deposito' });
  const res = await Promise.allSettled([O.setState(d.id, 'APROVADO', { by: 'x' }), O.setState(d.id, 'APROVADO', { by: 'y' })]);
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 1); assert.equal(E.getBalance('2'), 100);
  assert.equal(O.getOrder(d.id).history.length, 2);
});

test('economia: saldo, concorrência, relatório', async () => {
  tmpDb();
  await Promise.all(Array.from({ length: 20 }, () => E.credit('9', 5)));
  assert.equal(E.getBalance('9'), 100); await E.debit('9', 30.5); assert.equal(E.getBalance('9'), 69.5);
  await assert.rejects(E.debit('9', 1000), /Saldo insuficiente/); await assert.rejects(E.credit('9', -5)); await assert.rejects(E.credit('9', 'x'));
  assert.equal(E.historyOf('9', 3).length, 3); assert.equal(E.historyOf('9', 1)[0].type, 'DEBITO');
  const o = O.createOrder({ client: '9', dest: '846000001', operator: 'Vodacom', product: '1GB', value: 25 }); await O.setState(o.id, 'APROVADO', { by: 'dono' });
  const r = E.salesReport(0); assert.equal(r.count, 1); assert.equal(r.total, 25); assert.equal(r.by.Vodacom.n, 1);
});

test('alugueres: ciclo de vida, expiração e avisos (uma vez)', async () => {
  tmpDb();
  await R.setPlan('Mensal', 30, 500); await R.setPlan('Semanal', 7, 150);
  assert.equal(R.listPlans().length, 2); await assert.rejects(R.setPlan('x', 0, 1));
  const t0 = Date.now(), r = await R.addRental({ phone: '258840000001', plan: 'mensal', by: 'dono', now: t0 });
  assert.equal(r.state, 'ACTIVO'); assert.equal(R.daysLeft(r, t0), 30);
  const sent = []; const sock = { sendMessage: async (j, c) => { sent.push([j, c.text]); } }; const notes = [];
  assert.deepEqual(await SC.runRentalChecks(sock, async t => notes.push(t), t0 + 10 * DAY), []);
  assert.equal((await SC.runRentalChecks(sock, async () => {}, t0 + 28 * DAY)).length, 1);
  assert.equal((await SC.runRentalChecks(sock, async () => {}, t0 + 28.5 * DAY)).length, 0);
  assert.equal((await SC.runRentalChecks(sock, async () => {}, t0 + 29.5 * DAY)).length, 1);
  assert.equal((await SC.runRentalChecks(sock, async () => {}, t0 + 29.6 * DAY)).length, 0);
  assert.equal((await SC.runRentalChecks(sock, async t => notes.push(t), t0 + 31 * DAY))[0][0], 'expirado');
  assert.equal(R.getRental(r.id).state, 'EXPIRADO'); assert.match(notes[0], /expirado/); assert.ok(sent.every(([j]) => j === '258840000001@s.whatsapp.net'));
  const n = t0 + 31 * DAY; const rr = await R.renew(r.id, 'dono', { dias: 10, now: n }); assert.equal(rr.state, 'ACTIVO'); assert.ok(Math.abs(rr.expiry - (n + 10 * DAY)) < 1000);
  const s = await R.suspend(r.id, 'dono', n + 4 * DAY); assert.equal(s.state, 'SUSPENSO'); await assert.rejects(R.renew(r.id, 'dono'), /suspenso/);
  const re = await R.reactivate(r.id, 'dono', n + 100 * DAY); assert.equal(re.state, 'ACTIVO'); assert.ok(Math.abs(re.expiry - (n + 106 * DAY)) < 1000);
  const p = await R.requestRental('258840000002', 'Semanal'); assert.equal(p.state, 'PENDENTE'); await assert.rejects(R.renew(p.id, 'x'), /pendente/);
  assert.equal((await R.activate(p.id, 'dono')).state, 'ACTIVO'); await R.removeRental(p.id); assert.equal(R.getRental(p.id), null);
});

test('agendador: persistente, recupera após reinício, ignora tarefas muito antigas', async () => {
  const d = tmpDb(); const at = Date.now() + 5000;
  const t = await SC.addTask({ jid: '1@g.us', text: 'olá', at, by: 'x' }); await flush();
  await assert.rejects(SC.addTask({ jid: '1@g.us', text: 'x', at: Date.now() - 1000 }), /passou/);
  setDir(d); assert.equal(SC.listTasks('1@g.us').length, 1);               // "reinício"
  const sent = []; const sock = { sendMessage: async (j, c) => { sent.push([j, c.text]); } };
  assert.equal(await SC.runDueTasks(sock, at - 1), 0); assert.equal(await SC.runDueTasks(sock, at + 1), 1); assert.equal(await SC.runDueTasks(sock, at + 2), 0);
  assert.match(sent[0][1], /olá/);
  const old = await SC.addTask({ jid: '2@g.us', text: 'velha', at: Date.now() + 1000, by: 'x' }); db('settings').tasks[old.id].at = Date.now() - 2 * DAY;
  assert.equal(await SC.runDueTasks(sock), 0); assert.equal(db('settings').tasks[old.id].status, 'PERDIDO');
  const c = await SC.addTask({ jid: '3@g.us', text: 'x', at: Date.now() + 9999, by: 'x' }); await SC.cancelTask(c.id, '3@g.us'); assert.equal(SC.listTasks('3@g.us').length, 0);
  await assert.rejects(SC.cancelTask(c.id, '3@g.us'));
});

test('f.auto: fecha/abre à hora certa, sem repetir; sem permissões não rebenta', async () => {
  tmpDb(); getGroup('g@g.us').fauto = { on: true, close: '22:00', open: '06:00' };
  const calls = []; const sock = { groupSettingUpdate: async (j, st) => { calls.push(st); }, sendMessage: async () => {} };
  const at = (d, h) => Date.parse(`2026-11-0${d}T${h}:00Z`);              // Maputo = UTC+2
  await SC.runFauto(sock, at(5, '10:00')); await SC.runFauto(sock, at(5, '10:05'));
  await SC.runFauto(sock, at(5, '20:30')); await SC.runFauto(sock, at(5, '20:40'));
  await SC.runFauto(sock, at(6, '04:30'));
  assert.deepEqual(calls, ['not_announcement', 'announcement', 'not_announcement']);
  const bad = { groupSettingUpdate: async () => { throw new Error('403'); }, sendMessage: async () => {} };
  assert.deepEqual(await SC.runFauto(bad, at(7, '20:30')), []); assert.equal(getGroup('g@g.us').fautoState, 'open');
});

test('rede: IPs privados, SSRF em redirecionamentos, limite de tamanho', async () => {
  for (const ip of ['127.0.0.1', '10.1.1.1', '192.168.0.9', '172.20.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
  const mk = (status, body, headers = {}) => async () => ({ status, headers: new Headers(headers), body: (async function* () { yield Buffer.from(body); })() });
  const pub = async () => ['93.184.216.34'];
  const ok = await N.safeFetch('https://exemplo.pt/', { fetchImpl: mk(200, '<title>Olá &amp; mundo</title>', { 'content-type': 'text/html' }), resolve: pub });
  assert.equal(N.parseMeta(ok.body).title, 'Olá & mundo');
  await assert.rejects(N.safeFetch('https://exemplo.pt/', { fetchImpl: mk(302, '', { location: 'http://169.254.169.254/latest' }), resolve: pub }), /não permitida|privado/);
  await assert.rejects(N.safeFetch('https://interno.pt/', { fetchImpl: mk(200, 'x'), resolve: async () => ['10.0.0.5'] }), /privado/);
  await assert.rejects(N.safeFetch('https://x.pt/', { fetchImpl: async () => ({ status: 302, headers: new Headers({ location: '/a' }) }), resolve: pub }), /redirecionamentos/);
  const big = await N.safeFetch('https://exemplo.pt/', { fetchImpl: mk(200, 'a'.repeat(5000)), resolve: pub, maxBytes: 1000 });
  assert.equal(big.body.length, 1000); assert.ok(big.truncated);
});

async function withServer(handler, fn) {
  const srv = http.createServer(handler); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { await new Promise(r => srv.close(r)); }
}

test('IA: integração (servidor simulado), erros controlados, contexto da loja', async () => {
  tmpDb(); db('nano').tabela = 'Vodacom 1GB = 25 MT';
  const saved = { ...config.ai }; let seen;
  try {
    config.ai.url = ''; await assert.rejects(AI.ask('olá'), e => e instanceof AI.AIError && /não configurada/.test(e.message));
    await withServer(async (req, res) => {
      let b = ''; for await (const ch of req) b += ch; const j = JSON.parse(b); seen = { auth: req.headers.authorization, j };
      if (req.url === '/401') { res.writeHead(401); return res.end('{}'); } if (req.url === '/429') { res.writeHead(429); return res.end('{}'); }
      if (req.url === '/500') { res.writeHead(500); return res.end('{}'); } if (req.url === '/vazio') { res.writeHead(200); return res.end('{"choices":[]}'); }
      if (req.url === '/img') { res.writeHead(200); return res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('PNGDATA').toString('base64') }] })); }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: ' Resposta ' } }] }));
    }, async base => {
      Object.assign(config.ai, { url: base + '/ok', key: 'chave-secreta', model: 'm1', imageUrl: base + '/img', imageModel: 'im' });
      assert.equal(await AI.ask('quanto custa?', { withStore: true }), 'Resposta');
      assert.equal(seen.auth, 'Bearer chave-secreta'); assert.equal(seen.j.model, 'm1');
      assert.match(seen.j.messages[0].content, /Vodacom 1GB = 25 MT/); assert.equal(seen.j.messages[1].content, 'quanto custa?');
      for (const [u, re] of [['/401', /inválida/], ['/429', /Limite/], ['/500', /erro 500/], ['/vazio', /não devolveu/]]) { config.ai.url = base + u; await assert.rejects(AI.ask('x'), re); }
      assert.equal((await AI.generateImage('gato')).toString(), 'PNGDATA');
      config.ai.url = 'http://127.0.0.1:1/x'; await assert.rejects(AI.ask('x'), /indisponível/);
      const c = fakeCtx({ text: 'olá', deps: { ask: async () => { throw new AI.AIError('IA em baixo'); } } }); await findCommand('ia').run(c); assert.match(last(c).text, /IA em baixo/);
      const c2 = fakeCtx({ text: 'olá', deps: { ask: async (p, o) => { assert.equal(o.withStore, true); return 'linha1\nlinha2'; } }, phone: '77' }); await findCommand('ia').run(c2); assert.match(last(c2).text, /linha2/);
      assert.match(last(await run('ia', { text: '' })).text, /Uso/);
    });
  } finally { Object.assign(config.ai, saved); }
});

test('webhook: exige token, regista pagamento e aprova encomenda à espera', async () => {
  tmpDb(); db('settings').tokenHash = hashToken('token-super-secreto-123');
  const o = O.createOrder({ client: '258840000001', dest: '846000001', operator: 'Vodacom', product: '1GB', value: 25 });
  await P.applyProof(o.id, { ref: 'WEBHK12345', amount: 25 });
  const approved = []; const srv = P.startWebhook({ port: 0, host: '127.0.0.1', onApproved: x => approved.push(x.id) });
  await new Promise(r => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}/pagamento`;
  try {
    const post = (headers, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({}, { ref: 'WEBHK12345', amount: '25' })).status, 401);
    assert.equal((await post({ 'x-token': 'errado' }, { ref: 'WEBHK12345', amount: '25' })).status, 401);
    assert.equal(O.getOrder(o.id).state, 'EM ANÁLISE');
    const r = await post({ 'x-token': 'token-super-secreto-123' }, { ref: 'WEBHK12345', amount: '25,00' });
    assert.deepEqual(await r.json(), { ok: true, ref: 'WEBHK12345', approved: 1 });
    assert.equal(O.getOrder(o.id).state, 'APROVADO'); assert.deepEqual(approved, [o.id]);
    assert.equal((await post({ 'x-token': 'token-super-secreto-123' }, { ref: 'WEBHK12345', amount: '25' })).status, 400);
    assert.equal((await fetch(url.replace('pagamento', 'x'), { method: 'POST' })).status, 404);
  } finally { await new Promise(r => srv.close(r)); }
});

test('multimédia: conversões reais (sharp + ffmpeg) e limpeza de temporários', async () => {
  const src = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .composite([{ input: Buffer.from('<svg width="300" height="200"><circle cx="100" cy="100" r="60" fill="#0f0"/></svg>') }]).jpeg().toBuffer();
  const st = await M.toSticker(src), meta = await sharp(st).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 512, 512]);
  assert.equal((await sharp(await M.stickerToImage(st)).metadata()).format, 'png');
  assert.equal((await sharp(await M.hd(src)).metadata()).width, 600);
  const g = await sharp(await M.gray(src)).raw().toBuffer({ resolveWithObject: true });
  assert.ok(g.data.every((v, i) => i % g.info.channels !== 0 || Math.abs(v - g.data[i + 1]) < 3));
  const orig = (await sharp(src).raw().toBuffer())[0], inv = (await sharp(await M.invert(src)).raw().toBuffer())[0]; assert.ok(Math.abs(orig - inv) > 40);
  for (const f of ['blur', 'pixel']) assert.notDeepEqual(await M[f](src), src);
  assert.equal((await sharp(await M.ttp('Olá mundo bonito')).metadata()).format, 'webp');
  assert.ok((await sharp(await M.attp('Sasuke'), { animated: true }).metadata()).pages > 1);
  await assert.rejects(M.ttp('  ')); await assert.rejects(M.toSticker(Buffer.from('lixo'))); await assert.rejects(M.toSticker(Buffer.alloc(11 * 1024 * 1024)), /grande/);
  const vid = await withTmpVideo(); const vs = await M.videoToSticker(vid);
  assert.ok(vs.length <= 1024 * 1024 && (await sharp(vs, { animated: true }).metadata()).pages > 1);
  assert.deepEqual(fs.readdirSync(path.join(config.root, 'temp')).filter(f => f.startsWith('m-')), []);
  assert.deepEqual(M.wrapText('uma frase bastante comprida para quebrar', 12).every(l => l.length <= 12), true);
});
async function withTmpVideo() {
  const { execFileSync } = await import('node:child_process'); const f = path.join(config.root, 'temp', 'teste.mp4');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=12', '-t', '2', '-pix_fmt', 'yuv420p', f]);
  const b = fs.readFileSync(f); fs.rmSync(f); return b;
}

test('comandos multimédia: enviam sticker/imagem; erros controlados', async () => {
  const src = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#336699' } }).png().toBuffer();
  const get = type => async types => (types.includes(type) ? { buffer: src, type, seconds: 0 } : null);
  for (const [name, type, key] of [['fig', 'image', 'sticker'], ['sticker', 'image', 'sticker'], ['hd', 'image', 'image'], ['to-hd', 'image', 'image'], ['blur', 'image', 'image'], ['pixel', 'image', 'image'], ['gray', 'image', 'image'], ['invert', 'image', 'image']]) {
    const c = await run(name, { getMedia: get(type) }); assert.ok(Buffer.isBuffer(last(c)[key]), name);
  }
  const st = await M.toSticker(src); const c = await run('toimg', { getMedia: async t => t.includes('sticker') ? { buffer: st, type: 'sticker' } : null }); assert.ok(Buffer.isBuffer(last(c).image));
  assert.ok(Buffer.isBuffer(last(await run('ttp', { text: 'oi' })).sticker)); assert.ok(Buffer.isBuffer(last(await run('attp', { text: 'oi' })).sticker));
  assert.match(last(await run('fig')).text, /ERRO/); assert.match(last(await run('ttp')).text, /ERRO/);
  assert.match(last(await run('fig', { getMedia: async () => ({ buffer: src, type: 'video', seconds: 30 }) })).text, /10 segundos/);
  assert.match(last(await run('ia-fig', { text: 'gato', phone: '5' })).text, /não configurada/);
  assert.match(last(await run('hd', { getMedia: async () => ({ buffer: Buffer.from('lixo'), type: 'image' }) })).text, /ERRO/);
});

test('compras: tabelas configuráveis, encomenda, venda automática com saldo', async () => {
  tmpDb(); const owner = { level: 1, phone: config.ownerNumber }, cli = '258840000001';
  assert.match(last(await run('megas')).text, /ERRO/);
  await run('setmegas', { ...owner, text: 'Vodacom | 1GB | 25' }); await run('setmegas', { ...owner, text: 'Vodacom | 2GB | 45,50' }); await run('addpic', { ...owner, text: 'Movitel | Pico 5GB | 100' });
  await run('setmegas', { ...owner, text: 'Vodacom | 1GB | 26' });
  assert.match(last(await run('megas')).text, /1GB — 26,00 MT/); assert.match(last(await run('picos')).text, /Pico 5GB/);
  await run('setrestanas', { ...owner, text: 'Restam 500GB' }); assert.match(last(await run('megas')).text, /Restam 500GB/);
  assert.match(last(await run('setmegas', { ...owner, text: 'Vodacom | 1GB' })).text, /ERRO/); assert.match(last(await run('setmegas', { level: 4, text: '' })).text, /./);
  await run('delpic', { ...owner, text: 'Movitel | Pico 5GB' }); assert.match(last(await run('picos')).text, /ERRO/);
  assert.match(last(await run('compra', { phone: cli, args: ['Vodacom', '1GB'] })).text, /Uso/);
  assert.match(last(await run('compra', { phone: cli, args: ['Vodacom', '9GB', '846000001'] })).text, /não encontrado/);
  assert.match(last(await run('compra', { phone: cli, args: ['Vodacom', '1GB', '866000001'] })).text, /pertence à Movitel/);
  const c = await run('compra', { phone: cli, args: ['vodacom', '1gb', '+258846000001'] });
  assert.match(last(c).text, /ENCOMENDA CRIADA/); assert.match(last(c).text, /Valor: 26,00 MT/); assert.match(c.notes[0], /Nova encomenda/);
  assert.match(last(await run('compra', { phone: cli, args: ['vodacom', '1gb', '846000001'] })).text, /JÁ EXISTE/);
  assert.equal(O.openOrdersOf(cli).length, 1);
  await run('addsaldo', { ...owner, args: [cli, '100'] }); assert.equal(E.getBalance(cli), 100);
  await run('venda-automatica', { ...owner, args: ['on'] });
  const c2 = await run('compra', { phone: cli, args: ['Vodacom', '2GB', '846000002'] });
  assert.match(last(c2).text, /COMPRA CONCLUÍDA/); assert.equal(E.getBalance(cli), 54.5);
  assert.equal(O.listOrders(o => o.product === '2GB')[0].state, 'APROVADO');
  assert.match(last(await run('saldo', { phone: cli })).text, /54,50 MT/); assert.match(last(await run('encomendas', { phone: cli })).text, /ORD-/);
  await run('addsaldo', { ...owner, args: [cli, '-5'] }); assert.equal(E.getBalance(cli), 54.5);
  const id = O.openOrdersOf(cli)[0].id;
  assert.match(last(await run('cancelar', { phone: '258840000009', args: [id] })).text, /não é tua/);
  assert.match(last(await run('cancelar', { phone: cli, args: [id] })).text, /cancelada/);
  assert.match(last(await run('relatorio', { ...owner, args: ['hoje'] })).text, /Vendas aprovadas: 1/);
  assert.match(last(await run('bot', owner)).text, /PAINEL/); await run('bot', { ...owner, args: ['off'] }); assert.equal(db('settings').botOff, true);
});

test('comprovativos: OCR real + registo independente aprova; sem registo vai para análise manual', async () => {
  tmpDb(); const cli = '258840000001';
  db('settings').megas = [{ operator: 'Vodacom', product: '1GB', value: 25 }];
  await run('compra', { phone: cli, args: ['Vodacom', '1GB', '846000001'] });
  const svg = '<svg width="1000" height="260"><rect width="100%" height="100%" fill="white"/><text x="30" y="90" font-size="52" font-family="DejaVu Sans" fill="black">Confirmado QK7M2X9PW4.</text><text x="30" y="170" font-size="52" font-family="DejaVu Sans" fill="black">Transferiste 25.00MT em 05/11/2026</text></svg>';
  const img = await sharp(Buffer.from(svg)).png().toBuffer(), getMedia = async () => ({ buffer: img, type: 'image' });
  assert.match(last(await run('comprovativo', { phone: cli, isGroup: true, getMedia })).text, /PRIVADO/);
  assert.match(last(await run('comprovativo', { phone: cli })).text, /Envia uma imagem/);
  let c = await run('comprovativo', { phone: cli, getMedia });
  assert.match(last(c).text, /EM ANÁLISE/); assert.match(c.notes[0], /análise manual/); assert.equal(O.openOrdersOf(cli)[0].state, 'EM ANÁLISE');
  const sent = []; const sock = { user: { id: '1:1@s.whatsapp.net' }, sendMessage: async (j, x) => { sent.push([j, x.text]); } };
  const r = await run('regpagamento', { level: 1, phone: config.ownerNumber, sock, text: 'qk7m2x9pw4 | 25 | 05/11/2026' });
  assert.match(last(r).text, /aprovadas: 1/); assert.equal(sent[0][0], cli + '@s.whatsapp.net'); assert.equal(O.listOrders(o => o.client === cli)[0].state, 'APROVADO');
  assert.match(last(await run('regpagamento', { level: 1, sock, text: 'qk7m2x9pw4 | 25' })).text, /já registada/);
  const o2 = O.createOrder({ client: '258840000002', dest: '846000009', operator: 'Vodacom', product: '1GB', value: 25 });
  c = await run('comprovativo', { phone: '258840000002', getMedia });
  assert.match(last(c).text, /já foi utilizada/); assert.match(c.notes[0], /fraude/); assert.equal(O.getOrder(o2.id).state, 'PENDENTE');
  assert.match(last(await run('comprovativo', { phone: '258840000002', getMedia: async () => ({ buffer: Buffer.from('x'), type: 'image' }) })).text, /ERRO/);
});

test('verificarsms: só no privado, nunca guarda o texto do SMS, dono aprova/rejeita/restaura', async () => {
  tmpDb(); const cli = '258840000001', owner = { level: 1, phone: config.ownerNumber };
  db('settings').megas = [{ operator: 'Vodacom', product: '1GB', value: 25 }];
  await run('compra', { phone: cli, args: ['Vodacom', '1GB', '846000001'] });
  assert.match(last(await run('verificarsms', { phone: cli, isGroup: true, text: 'x' })).text, /PRIVADO/);
  assert.match(last(await run('verificarsms', { phone: cli, text: '' })).text, /Cola o texto/);
  const sms = 'Confirmado ZZ9Y8X7W6V. Transferiste 25.00MT em 05/11/2026. O teu PIN é 4321';
  const c = await run('verificarsms', { phone: cli, text: sms });
  assert.match(last(c).text, /EM ANÁLISE/); await flush();
  const disk = Object.values(db('orders')).map(o => JSON.stringify(o)).join() + JSON.stringify(db('transactions'));
  assert.ok(!disk.includes('4321') && !disk.includes('PIN') && !disk.includes('Transferiste'));
  const id = O.openOrdersOf(cli)[0].id, sent = [], sock = { user: { id: '1:1@s.whatsapp.net' }, sendMessage: async (j, x) => { sent.push(x.text); } };
  assert.match(last(await run('pendentes', owner)).text, new RegExp(id));
  assert.match(last(await run('rejeitar', { ...owner, sock, args: [id, 'valor', 'errado'] })).text, /rejeitada/); assert.match(sent[0], /valor errado/);
  assert.match(last(await run('aprovar', { ...owner, sock, args: [id] })).text, /Transição inválida/);
  await run('restaura', { ...owner, args: [id] }); assert.match(last(await run('aprovar', { ...owner, sock, args: [id] })).text, /aprovada/);
  assert.match(last(await run('aprovar', { ...owner, sock, args: [id] })).text, /ERRO/);
  assert.match(last(await run('verificarsms', { phone: cli, text: sms })).text, /Não encontrei|aberta/);
});

test('depósito, telefones, token e pagamento (nano)', async () => {
  tmpDb(); const owner = { level: 1, phone: config.ownerNumber }, cli = '258840000001';
  assert.match(last(await run('pagamento')).text, /ERRO/); db('nano').pagamento = 'M-Pesa: 84 000 0000\nNome: Loja';
  for (const n of ['pagamento', 'mpesa', 'm-pesa']) assert.match(last(await run(n)).text, /M-Pesa: 84/);
  assert.match(last(await run('depositar', { phone: cli, args: ['100'] })).text, /DEPÓSITO CRIADO/); assert.match(last(await run('depositar', { phone: cli, args: ['abc'] })).text, /Uso/);
  const dep = O.openOrdersOf(cli)[0];
  await P.registerAndReconcile({ ref: 'DEP100REF1', amount: 100 }); await P.applyProof(dep.id, { ref: 'DEP100REF1', amount: 100 });
  assert.equal(E.getBalance(cli), 100);
  await run('addtelefone', { ...owner, args: [cli, 'João', 'Silva'] }); assert.match(last(await run('telefones', owner)).text, /João Silva.*100,00 MT/);
  await run('deltelefone', { ...owner, args: [cli] }); assert.match(last(await run('telefones', owner)).text, /Sem clientes/);
  const t = await run('token', owner); const tok = last(t).text.match(/[0-9a-f]{48}/)[0]; assert.equal(db('settings').tokenHash, hashToken(tok)); assert.ok(!JSON.stringify(db('settings')).includes(tok));
  assert.match(last(await run('settoken', { ...owner, args: ['curto'] })).text, /16/); await run('settoken', { ...owner, args: ['um-token-longo-e-seguro'] }); assert.equal(db('settings').tokenHash, hashToken('um-token-longo-e-seguro'));
  await run('modo-gratis', { ...owner, args: ['on'] }); assert.match(last(await run('dia-gratis')).text, /ACTIVA/);
});

test('alugueres (comandos)', async () => {
  tmpDb(); const owner = { level: 1, phone: config.ownerNumber }, cli = '258840000001', sent = []; const sock = { user: { id: '1:1@s.whatsapp.net' }, sendMessage: async (j, x) => { sent.push([j, x.text]); } };
  assert.match(last(await run('alugar')).text, /Ainda não há planos/);
  await run('setplano', { ...owner, text: 'Mensal | 30 | 500' }); assert.match(last(await run('alugar')).text, /Mensal: 30 dias/);
  const c = await run('alugar', { phone: cli, args: ['Mensal'] }); assert.match(last(c).text, /PENDENTE/); assert.match(c.notes[0], /Pedido de aluguer/);
  const id = R.listRentals()[0].id; await run('addaluguer', { ...owner, args: [id] }); assert.equal(R.getRental(id).state, 'ACTIVO');
  assert.match(last(await run('meualuguer', { phone: cli })).text, /ACTIVO/); assert.match(last(await run('alugados', owner)).text, new RegExp(id));
  await run('addaluguer', { ...owner, args: ['258840000002', 'Mensal'] }); assert.equal(R.listRentals().length, 2);
  await run('renovar', { ...owner, sock, args: [id, '15'] }); assert.equal(sent.length, 1); await run('suspender', { ...owner, args: [id] }); assert.equal(R.getRental(id).state, 'SUSPENSO');
  assert.match(last(await run('suspender', { ...owner, args: [id] })).text, /ERRO/); await run('reativar', { ...owner, args: [id] }); assert.equal(R.getRental(id).state, 'ACTIVO');
  await run('delaluguer', { ...owner, args: [id] }); assert.equal(R.getRental(id), null); assert.match(last(await run('delaluguer', { ...owner, args: [id] })).text, /ERRO/);
  assert.match(last(await run('alugar', { phone: cli, args: ['Inexistente'] })).text, /ERRO/); await run('delplano', { ...owner, text: 'Mensal' }); assert.equal(R.listPlans().length, 0);
});

test('automação: auto-responder, agendar, auto-remover/strikes, f.auto, auto-comprovativo', async () => {
  tmpDb(); const owner = { level: 1, phone: config.ownerNumber };
  await run('auto-responder', { ...owner, text: 'add Horário | Abrimos das 8h às 18h', args: ['add'] });
  assert.match(autoReply('Qual é o HORÁRIO de hoje?'), /8h/); assert.equal(autoReply('horários'), null); assert.equal(autoReply(''), null);
  assert.match(last(await run('auto-responder', { ...owner, text: 'lista', args: ['lista'] })).text, /horario/);
  await run('auto-responder', { ...owner, text: 'del horario', args: ['del'] }); assert.equal(autoReply('horário'), null);
  assert.match(last(await run('agendar-mensagem', { level: 3, isGroup: true, text: '2h | Reunião às 18h' })).text, /Agendada AG-/);
  assert.equal(SC.listTasks('120@g.us').length, 1); assert.match(last(await run('agendamentos', { level: 3 })).text, /Reunião/);
  assert.match(last(await run('agendar-mensagem', { level: 3, isGroup: false, text: '2h | x' })).text, /só o fundador/);
  assert.match(last(await run('agendar-mensagem', { level: 3, isGroup: true, text: 'ontem | x' })).text, /inválida/);
  await run('cancelar-agenda', { level: 3, args: [SC.listTasks()[0].id] }); assert.equal(SC.listTasks().length, 0);
  await run('auto-remover', { level: 3, args: ['on'], jid: 'g@g.us' }); const cfg = getGroup('g@g.us'); assert.equal(cfg.autoremover, true);
  assert.deepEqual([addStrike(cfg, '1'), addStrike(cfg, '1'), addStrike(cfg, '1')], [1, 2, 3]); assert.equal(addStrike(cfg, '1', Date.now() + 2 * DAY), 1);
  await run('f.auto', { level: 3, args: ['on', '22:00', '06:00'], jid: 'g@g.us' }); assert.deepEqual(cfg.fauto, { on: true, close: '22:00', open: '06:00' });
  assert.match(last(await run('f.auto', { level: 3, args: ['on', '25:00', '06:00'], jid: 'g@g.us' })).text, /Uso/);
  await run('f.auto', { level: 3, args: ['off'], jid: 'g@g.us' }); assert.equal(cfg.fauto, null);
  await run('auto-comprovativo', { ...owner, args: ['on'] }); assert.equal(db('settings').autoProof, true);
});

test('utilitários: cep, link, gerar-link, metadados, google, raw', async () => {
  tmpDb(); const saved = { ...deps }, k = { key: config.googleKey, cx: config.googleCx };
  const ok = obj => async () => ({ ok: true, json: async () => obj });
  try {
    deps.fetch = ok({ cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' });
    assert.match(last(await run('cep', { args: ['01001-000'] })).text, /Praça da Sé/); assert.match(last(await run('cep', { args: ['123'] })).text, /Uso/);
    deps.fetch = ok({ erro: true }); assert.match(last(await run('cep', { args: ['99999999'] })).text, /não encontrado/);
    deps.fetch = async () => ({ ok: false, status: 500 }); assert.match(last(await run('cep', { args: ['01001000'] })).text, /indisponível/);
    let asked; deps.fetch = async u => { asked = u; return { ok: true, json: async () => ({ shorturl: 'https://is.gd/abc' }) }; };
    assert.match(last(await run('link', { args: ['exemplo.pt/pagina?a=1'] })).text, /is\.gd\/abc/); assert.match(asked, /url=https%3A%2F%2Fexemplo\.pt/);
    assert.match(last(await run('link', { args: ['http://localhost:3000'] })).text, /não permitida/); assert.match(last(await run('link', { args: ['http://192.168.1.1'] })).text, /não permitida/);
    assert.match(last(await run('gerar-link', { args: ['258840000001', 'olá', 'mundo'] })).text, /wa\.me\/258840000001\?text=ol%C3%A1%20mundo/); assert.match(last(await run('gerar-link', { args: ['12'] })).text, /Uso/);
    deps.safeFetch = async () => ({ status: 200, url: 'https://x.pt/', contentType: 'text/html; charset=utf-8', body: '<title>Loja X</title><meta name="description" content="Megas baratos">', truncated: false });
    assert.match(last(await run('metadados', { args: ['x.pt'] })).text, /Título: Loja X/);
    assert.match(last(await run('metadados', { args: ['http://127.0.0.1/admin'] })).text, /não permitida/);
    deps.safeFetch = async () => { throw new Error('Destino privado ou inválido'); }; assert.match(last(await run('metadados', { args: ['https://rebind.pt'] })).text, /não permitido/);
    config.googleKey = ''; assert.match(last(await run('google-search', { text: 'x' })).text, /GOOGLE_API_KEY/);
    Object.assign(config, { googleKey: 'k', googleCx: 'c' }); deps.fetch = async u => { asked = u; return { ok: true, json: async () => ({ items: [{ title: 'T1', link: 'https://a.pt', snippet: 'sn' }] }) }; };
    assert.match(last(await run('google-search', { text: 'megas' })).text, /T1/); assert.ok(!last(await run('google-search', { text: 'megas' })).text.includes('key='));
    const raw = await run('raw', { m: { key: {}, message: { extendedTextMessage: { text: 'x', contextInfo: { quotedMessage: { imageMessage: { jpegThumbnail: 'A'.repeat(500) } } } } } } });
    assert.match(last(raw).text, /\[500\]/);
  } finally { Object.assign(deps, saved); config.googleKey = k.key; config.googleCx = k.cx; }
});

test('registo: todos os comandos da especificação existem e têm categoria', () => {
  const spec = `menu menu-interativo v7 imenu ajuda ping perfil dono criador owner sasuke tempo todos donofoto nanoadd nanodel listanano bemvindo saida compra comprar comprovativo verificarsms megas picos picospv restaura dia-gratis alugar pagamento bot depositar setmegas addsaldo telefones addtelefone deltelefone venda-automatica addpic delpic setrestanas token settoken alugados addaluguer delaluguer renovar suspender reativar fig sticker toimage toimg hd to-hd ia-fig attp ttp blur pixel gray invert google-search cep link gerar-link metadados raw m-pesa mpesa calcula abre fecha grupo kick promover rebaixar hidetag limpar mudar-nome-grupo anti-link anticoncorrencia antiestrangeiros ban mutar desmutar so-admin auto-comprovativo auto-responder agendar-mensagem auto-remover f.auto ia`.split(/\s+/);
  const missing = spec.filter(n => !findCommand(n)); assert.deepEqual(missing, []);
  const cats = new Set(commands.map(c => c.cat)); assert.equal(cats.size, 10);
});
