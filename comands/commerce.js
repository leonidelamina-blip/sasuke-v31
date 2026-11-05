import crypto from 'node:crypto';
import config from '../config.js';
import { db, getSettings, saveSettings } from '../plugins/database.js';
import { formatarMensagem } from '../plugins/style.js';
import { credit, debit, getBalance, historyOf, salesReport } from '../plugins/economy.js';
import { createOrder, DuplicateOrder, getOrder, listOrders, openOrdersOf, orderLine, setState, OPEN } from '../plugins/orders.js';
import { applyProof, ocrImage, parseProofText, registerAndReconcile } from '../plugins/payments.js';
import { hashToken } from '../plugins/security.js';
import { fmtMT, isMzNumber, operatorOf, parseMoney, fmtUptime, fmtDateTime } from '../plugins/utils.js';
import { listRentals } from '../plugins/rentals.js';

const C = 'COMPRAS & MEGAS', F = 'ADMINISTRAÇÃO DO FUNDADOR';
const LIST = { megas: 'megas', pico: 'picos' };
const prices = kind => (getSettings()[LIST[kind]] ??= []);
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const findPrice = (operator, product) => [...prices('megas'), ...prices('pico')].find(p => same(p.operator, operator) && same(p.product, product));
const clientJid = o => `${o.client}@s.whatsapp.net`;
const ID_RE = /^(ORD|DEP|ALG)-[A-Z0-9]+$/i;

export function paymentInfo() { const p = db('nano').pagamento; return p ? String(p) : null; }

function table(kind) {
  const list = prices(kind); if (!list.length) return null;
  const by = {};
  for (const p of list) (by[p.operator] ??= []).push(`${p.product} — ${fmtMT(p.value)}`);
  return Object.entries(by).flatMap(([op, items]) => [`【 ${op.toUpperCase()} 】`, ...items]);
}

async function setPrice(c, kind) {
  const label = kind === 'pico' ? 'addpic' : 'setmegas';
  const del = /^del\s/i.test(c.text);
  const parts = c.text.replace(/^del\s+/i, '').split('|').map(s => s.trim());
  if (del) {
    if (parts.length < 2) return c.fail(`Uso: .${label} del Operadora | Produto`);
    const i = prices(kind).findIndex(p => same(p.operator, parts[0]) && same(p.product, parts[1]));
    if (i < 0) return c.fail('Entrada não encontrada.');
    prices(kind).splice(i, 1); await saveSettings(); return c.ok('Removido.');
  }
  const value = parseMoney(parts[2]);
  if (parts.length < 3 || !parts[0] || !parts[1] || !(value > 0)) return c.fail(`Uso: .${label} Operadora | Produto | Valor\nEx: .${label} Vodacom | 1GB | 25`);
  const list = prices(kind), i = list.findIndex(p => same(p.operator, parts[0]) && same(p.product, parts[1]));
  if (i >= 0) list[i].value = value; else list.push({ operator: parts[0], product: parts[1], value });
  await saveSettings(); return c.ok(`${parts[0]} ${parts[1]} = ${fmtMT(value)}`);
}

function payLines(o) {
  const info = paymentInfo();
  return [`ID: ${o.id}`, o.type === 'DEPOSITO' ? `Depósito: ${fmtMT(o.value)}` : `${o.operator} ${o.product} → ${o.dest}`, `Valor: ${fmtMT(o.value)}`, `Estado: ${o.state}`,
    ...(info ? ['', 'PAGAMENTO:', info] : ['', 'Pede ao dono os dados de pagamento.']),
    '', `Depois de pagar, envia o comprovativo no PRIVADO:`, `📷 imagem com a legenda .comprovativo ${o.id}`, `ou .verificarsms ${o.id} <texto do SMS>`, '⚠️ Nunca envies PINs nem códigos de verificação.'];
}

const notifyClient = (c, o, text) => c.sock.sendMessage(clientJid(o), { text: formatarMensagem('ENCOMENDA ' + o.state, [`ID: ${o.id}`, text], { gratis: false }) }).catch(() => {});

/** Núcleo do comprovativo (imagem via OCR ou texto de SMS). Nunca aprova só por causa da imagem. */
export async function processProof(c, text, orderId) {
  const open = openOrdersOf(c.phone);
  const order = orderId ? getOrder(orderId) : (open.length === 1 ? open[0] : null);
  if (!order) return c.fail(open.length > 1 ? `Tens várias encomendas abertas. Indica o ID:\n${open.map(orderLine).join('\n')}` : 'Não encontrei uma encomenda aberta. Faz primeiro .compra ou .depositar.');
  if (order.client !== c.phone) return c.fail('Esta encomenda não é tua.');
  const proof = parseProofText(text);
  let v;
  try { v = await applyProof(order.id, proof, 'SISTEMA'); } catch (e) { return c.fail(e.message); }
  const dados = [`Referência: ${proof.ref ?? '—'}`, `Valor lido: ${proof.amount != null ? fmtMT(proof.amount) : '—'}`, `Data: ${proof.date ?? '—'}`];
  if (v.status === 'APROVAR') {
    await c.notifyOwner(`✅ Encomenda ${order.id} aprovada automaticamente (${fmtMT(order.value)}). Entrega pendente: ${orderLine(order)}`);
    return c.send('PAGAMENTO CONFIRMADO', [`ID: ${order.id}`, ...dados, order.type === 'DEPOSITO' ? `Saldo: ${fmtMT(getBalance(order.client))}` : 'A tua encomenda será processada em breve.']);
  }
  if (v.status === 'BLOQUEADO') {
    await c.notifyOwner(`🚨 Referência reutilizada em ${order.id} (+${c.phone}). Verifica possível fraude.`);
    return c.fail('Esta referência de transacção já foi utilizada. O dono foi avisado.');
  }
  await c.notifyOwner(`🧾 Comprovativo para análise manual: ${orderLine(order)}\nMotivo: ${v.reasons.join(', ')}\nRef: ${proof.ref ?? '—'} | Valor lido: ${proof.amount ?? '—'}`);
  return c.send('EM ANÁLISE', [`ID: ${order.id}`, ...dados, 'Ainda não há confirmação independente do pagamento. O dono vai verificar manualmente.', ...(proof.ref ? [] : ['Não consegui ler a referência: tenta uma imagem mais nítida ou usa .verificarsms.'])]);
}

const need = (c, flag) => (c.isGroup ? c.fail('Envia isto no PRIVADO do bot, para proteger os teus dados.') : !c.phone ? c.fail('Não consegui identificar o teu número.') : null);
const todayStart = () => { const d = new Date(Date.now() + 2 * 3600e3); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 2 * 3600e3; };

export default [
  /* ───────── público ───────── */
  { name: 'megas', cat: C, level: 4, desc: 'Tabela de megas', run: c => {
    const t = table('megas'), r = getSettings().restanas;
    return t ? c.send('MEGAS', [...t, ...(r ? ['', `📦 ${r}`] : []), '', 'Compra: .compra <operadora> <produto> <número>']) : c.fail('Tabela de megas ainda não configurada. O dono usa .setmegas.');
  } },
  { name: 'picos', cat: C, level: 4, desc: 'Tabela de picos', run: c => { const t = table('pico'); return t ? c.send('PICOS', t) : c.fail('Tabela de picos ainda não configurada. O dono usa .addpic.'); } },
  { name: 'picospv', cat: C, level: 4, desc: 'Envia a tabela de picos no privado', run: async c => {
    const t = table('pico'); if (!t) return c.fail('Tabela de picos ainda não configurada.');
    const to = c.sender?.endsWith('@s.whatsapp.net') ? c.sender : `${c.phone}@s.whatsapp.net`;
    if (!c.phone && !c.sender) return c.fail('Não consegui identificar o teu número.');
    await c.sock.sendMessage(to, { text: formatarMensagem('PICOS', t) });
    if (c.isGroup) await c.ok('Enviei a tabela no teu privado.');
  } },
  { name: 'compra', aliases: ['comprar'], cat: C, level: 4, desc: 'Cria uma encomenda', usage: '.compra Vodacom 1GB 846123456', run: async c => {
    if (!c.phone) return c.fail('Não consegui identificar o teu número.');
    const a = c.args, dest = (a.at(-1) || '').replace(/\D/g, '').replace(/^258/, '');
    if (a.length < 3 || !isMzNumber(dest)) return c.fail('Uso: .compra <operadora> <produto> <número>\nEx: .compra Vodacom 1GB 846123456');
    const entry = findPrice(a[0], a.slice(1, -1).join(' '));
    if (!entry) return c.fail('Produto não encontrado. Vê as tabelas com .megas ou .picos.');
    const det = operatorOf(dest);
    if (det && !same(det, entry.operator)) return c.fail(`O número ${dest} pertence à ${det}, não à ${entry.operator}. Confirma a operadora.`);
    let o;
    try { o = createOrder({ client: c.phone, dest, operator: entry.operator, product: entry.product, value: entry.value, kind: prices('pico').includes(entry) ? 'pico' : 'megas' }); }
    catch (e) { if (e instanceof DuplicateOrder) return c.send('ENCOMENDA JÁ EXISTE', payLines(e.order)); return c.fail(e.message); }
    if (getSettings().vendaAuto && getBalance(c.phone) >= o.value) {
      await debit(c.phone, o.value, { orderId: o.id, note: 'Compra com saldo' });
      await setState(o.id, 'APROVADO', { by: 'SISTEMA', note: 'Pago com saldo' });
      await c.notifyOwner(`💰 Compra paga com saldo: ${orderLine(o)} (+${c.phone}). Entrega pendente.`);
      return c.send('COMPRA CONCLUÍDA', [`ID: ${o.id}`, `${o.operator} ${o.product} → ${o.dest}`, `Pago com saldo: ${fmtMT(o.value)}`, `Saldo actual: ${fmtMT(getBalance(c.phone))}`]);
    }
    await c.notifyOwner(`🛒 Nova encomenda: ${orderLine(o)} (+${c.phone})`);
    return c.send('ENCOMENDA CRIADA', payLines(o));
  } },
  { name: 'depositar', cat: C, level: 4, desc: 'Pede um depósito de saldo', usage: '.depositar 100', run: async c => {
    if (!c.phone) return c.fail('Não consegui identificar o teu número.');
    const v = parseMoney(c.args[0]); if (!(v > 0)) return c.fail('Uso: .depositar <valor>. Ex: .depositar 100');
    let o; try { o = createOrder({ client: c.phone, type: 'DEPOSITO', value: v, kind: 'deposito' }); }
    catch (e) { if (e instanceof DuplicateOrder) return c.send('DEPÓSITO JÁ EXISTE', payLines(e.order)); return c.fail(e.message); }
    await c.notifyOwner(`💵 Novo pedido de depósito: ${orderLine(o)} (+${c.phone})`);
    return c.send('DEPÓSITO CRIADO', payLines(o));
  } },
  { name: 'comprovativo', cat: C, level: 4, desc: 'Envia o comprovativo (imagem, no privado)', usage: 'Imagem com a legenda .comprovativo ID', run: async c => {
    const bad = need(c); if (bad) return bad;
    const media = await c.getMedia(['image']);
    if (!media) return c.fail('Envia uma imagem com a legenda .comprovativo <ID> (ou responde à imagem).');
    let text;
    try { text = await ocrImage(media.buffer); }
    catch (e) { return c.fail(e.message === 'OCR_INDISPONIVEL' ? 'Leitura de imagens indisponível. Usa .verificarsms <ID> <texto do SMS>.' : 'Não consegui ler a imagem. Envia uma imagem mais nítida ou usa .verificarsms.'); }
    return processProof(c, text, c.args[0] && ID_RE.test(c.args[0]) ? c.args[0] : null);
  } },
  { name: 'verificarsms', cat: C, level: 4, desc: 'Verifica o SMS de pagamento (no privado)', usage: '.verificarsms ID <texto do SMS>', run: async c => {
    const bad = need(c); if (bad) return bad;
    const id = ID_RE.test(c.args[0] || '') ? c.args[0] : null, text = id ? c.text.slice(c.args[0].length).trim() : c.text;
    if (!text) return c.fail('Cola o texto do SMS de confirmação. Ex: .verificarsms ORD-XXXX <texto>');
    return processProof(c, text, id);
  } },
  { name: 'encomendas', cat: C, level: 4, desc: 'As tuas encomendas', run: c => {
    const l = listOrders(o => o.client === c.phone).slice(0, 8);
    return l.length ? c.send('AS TUAS ENCOMENDAS', l.map(orderLine)) : c.fail('Ainda não tens encomendas.');
  } },
  { name: 'saldo', cat: C, level: 4, desc: 'O teu saldo e movimentos', run: c => {
    const h = historyOf(c.phone, 5).map(t => `${t.type === 'CREDITO' ? '➕' : '➖'} ${fmtMT(t.amount)} — ${t.note ?? ''}`.trim());
    return c.send('SALDO', [`Saldo: ${fmtMT(getBalance(c.phone))}`, ...(h.length ? ['', 'Últimos movimentos:', ...h] : [])]);
  } },
  { name: 'cancelar', cat: C, level: 4, desc: 'Cancela uma encomenda aberta', usage: '.cancelar ID', run: async c => {
    const o = getOrder(c.args[0]); if (!o) return c.fail('Encomenda não encontrada. Uso: .cancelar <ID>');
    if (o.client !== c.phone && c.level !== 1) return c.fail('Esta encomenda não é tua.');
    try { await setState(o.id, 'CANCELADO', { by: c.phone }); return c.ok(`Encomenda ${o.id} cancelada.`); } catch (e) { return c.fail(e.message); }
  } },
  { name: 'dia-gratis', cat: C, level: 4, desc: 'Estado do dia grátis', run: c =>
    c.send('DIA GRÁTIS', [getSettings().freeMode ? 'Promoção ACTIVA 🎉' : 'Sem promoção activa de momento.', `Acompanha o canal: ${config.channelUrl}`], { gratis: false }) },
  { name: 'pagamento', aliases: ['mpesa', 'm-pesa'], cat: C, level: 4, desc: 'Dados de pagamento', run: c => {
    const p = paymentInfo();
    return p ? c.send('PAGAMENTO', p.split('\n')) : c.fail('Dados de pagamento ainda não configurados. O dono define com: .nanoadd pagamento | <dados>');
  } },

  /* ───────── fundador ───────── */
  { name: 'setmegas', cat: F, level: 1, desc: 'Define preços de megas', usage: '.setmegas Operadora | Produto | Valor  (ou del)', run: c => setPrice(c, 'megas') },
  { name: 'addpic', cat: F, level: 1, desc: 'Adiciona preço de pico', usage: '.addpic Operadora | Produto | Valor', run: c => setPrice(c, 'pico') },
  { name: 'delpic', cat: F, level: 1, desc: 'Remove preço de pico', usage: '.delpic Operadora | Produto', run: c => setPrice({ ...c, text: 'del ' + c.text, fail: c.fail, ok: c.ok }, 'pico') },
  { name: 'setrestanas', cat: F, level: 1, desc: 'Nota de stock mostrada em .megas', usage: '.setrestanas texto | limpar', run: async c => {
    if (!c.text) return c.fail('Uso: .setrestanas <texto> ou .setrestanas limpar');
    const s = getSettings(); if (/^limpar$/i.test(c.text)) delete s.restanas; else s.restanas = c.text.slice(0, 200);
    await saveSettings(); return c.ok('Nota de stock actualizada.');
  } },
  { name: 'addsaldo', cat: F, level: 1, desc: 'Adiciona saldo a um cliente', usage: '.addsaldo 258840000001 50', run: async c => {
    const phone = (c.args[0] || '').replace(/\D/g, ''), v = parseMoney(c.args[1]);
    if (phone.length < 10 || !(v > 0)) return c.fail('Uso: .addsaldo <número com indicativo> <valor>');
    await credit(phone, v, { note: 'Saldo adicionado pelo fundador', by: c.phone });
    return c.ok(`+${phone}: ${fmtMT(getBalance(phone))}`);
  } },
  { name: 'regpagamento', cat: F, level: 1, desc: 'Regista um pagamento recebido (confirmação independente)', usage: '.regpagamento REF | valor | data', run: async c => {
    const [ref, val, date] = c.text.split('|').map(s => s.trim());
    try {
      const { entry, approved } = await registerAndReconcile({ ref, amount: parseMoney(val), date: date || null, source: 'manual' });
      for (const o of approved) await notifyClient(c, o, 'Pagamento confirmado. A tua encomenda será processada.');
      return c.ok(`Pagamento ${entry.ref} (${fmtMT(entry.amount)}) registado. Encomendas aprovadas: ${approved.length}.`);
    } catch (e) { return c.fail(e.message + '\nUso: .regpagamento REF | valor | data'); }
  } },
  { name: 'pendentes', cat: F, level: 1, desc: 'Encomendas por tratar', run: c => {
    const l = listOrders(o => OPEN.includes(o.state)).slice(0, 15);
    return l.length ? c.send('PENDENTES', l.map(o => `${orderLine(o)}${o.proof ? ` • ref ${o.proof.ref ?? '—'}` : ''}`)) : c.send('PENDENTES', ['Nada pendente.']);
  } },
  { name: 'aprovar', cat: F, level: 1, desc: 'Aprova uma encomenda manualmente', usage: '.aprovar ID', run: async c => {
    try { const o = await setState(c.args[0]?.toUpperCase(), 'APROVADO', { by: c.phone, note: 'Aprovação manual' }); await notifyClient(c, o, 'Aprovada. A tua encomenda será processada.'); return c.ok(`${o.id} aprovada.`); }
    catch (e) { return c.fail(e.message); }
  } },
  { name: 'rejeitar', cat: F, level: 1, desc: 'Rejeita uma encomenda', usage: '.rejeitar ID [motivo]', run: async c => {
    try { const o = await setState(c.args[0]?.toUpperCase(), 'REJEITADO', { by: c.phone, note: c.args.slice(1).join(' ') || null }); await notifyClient(c, o, c.args.slice(1).join(' ') || 'Rejeitada.'); return c.ok(`${o.id} rejeitada.`); }
    catch (e) { return c.fail(e.message); }
  } },
  { name: 'restaura', cat: F, level: 1, desc: 'Repõe uma encomenda rejeitada/cancelada', usage: '.restaura ID', run: async c => {
    try { const o = await setState(c.args[0]?.toUpperCase(), 'PENDENTE', { by: c.phone, note: 'Restaurada' }); return c.ok(`${o.id} voltou a PENDENTE.`); }
    catch (e) { return c.fail(e.message); }
  } },
  { name: 'relatorio', cat: F, level: 1, desc: 'Relatório de vendas', usage: '.relatorio [hoje|semana|mes]', run: c => {
    const p = (c.args[0] || 'hoje').toLowerCase(), since = p === 'mes' ? Date.now() - 30 * 86400e3 : p === 'semana' ? Date.now() - 7 * 86400e3 : todayStart();
    const r = salesReport(since);
    return c.send(`RELATÓRIO (${p})`, [`Vendas aprovadas: ${r.count}`, `Total: ${fmtMT(r.total)}`, `Depósitos aprovados: ${fmtMT(r.deposits)}`, `Pendentes: ${r.pending}`,
      ...Object.entries(r.by).map(([op, x]) => `${op}: ${x.n} • ${fmtMT(x.total)}`)]);
  } },
  { name: 'telefones', cat: F, level: 1, desc: 'Lista clientes registados', run: c => {
    const cl = Object.entries(getSettings().clientes ?? {});
    return c.send('CLIENTES', cl.length ? cl.map(([p, x]) => `+${p} • ${x.nome} • ${fmtMT(getBalance(p))}`) : ['Sem clientes. Usa .addtelefone']);
  } },
  { name: 'addtelefone', cat: F, level: 1, desc: 'Regista um cliente', usage: '.addtelefone 258840000001 Nome', run: async c => {
    const p = (c.args[0] || '').replace(/\D/g, ''); if (p.length < 10) return c.fail('Uso: .addtelefone <número com indicativo> <nome>');
    (getSettings().clientes ??= {})[p] = { nome: c.args.slice(1).join(' ') || 'Cliente', desde: Date.now() };
    await saveSettings(); return c.ok(`+${p} registado.`);
  } },
  { name: 'deltelefone', cat: F, level: 1, desc: 'Remove um cliente', usage: '.deltelefone 258840000001', run: async c => {
    const p = (c.args[0] || '').replace(/\D/g, ''), cl = getSettings().clientes ?? {};
    if (!cl[p]) return c.fail('Cliente não encontrado.'); delete cl[p]; await saveSettings(); return c.ok('Cliente removido.');
  } },
  { name: 'venda-automatica', cat: F, level: 1, desc: 'Compras pagas com saldo são aprovadas na hora', usage: '.venda-automatica on|off', run: async c => {
    const a = (c.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(a)) return c.send('VENDA AUTOMÁTICA', [`Estado: ${getSettings().vendaAuto ? 'ACTIVA' : 'INACTIVA'}`, 'Usa .venda-automatica on|off']);
    getSettings().vendaAuto = a === 'on'; await saveSettings(); return c.ok(`Venda automática ${a === 'on' ? 'activada' : 'desactivada'}.`);
  } },
  { name: 'token', cat: F, level: 1, desc: 'Gera novo token do webhook de pagamentos', run: async c => {
    const t = crypto.randomBytes(24).toString('hex'); getSettings().tokenHash = hashToken(t); await saveSettings();
    return c.send('NOVO TOKEN', [t, 'Guarda-o já: só é mostrado uma vez (guardo apenas o hash).', 'Usa-o no cabeçalho x-token do webhook.'], { frase: false });
  } },
  { name: 'settoken', cat: F, level: 1, desc: 'Define o token do webhook', usage: '.settoken <token com 16+ caracteres>', run: async c => {
    if ((c.args[0] || '').length < 16) return c.fail('O token deve ter pelo menos 16 caracteres. Apaga a tua mensagem depois.');
    getSettings().tokenHash = hashToken(c.args[0]); await saveSettings(); return c.ok('Token definido (guardado apenas como hash). Apaga a mensagem com o token.');
  } },
  { name: 'bot', cat: F, level: 1, desc: 'Painel do bot; .bot on|off pausa para membros', usage: '.bot [on|off]', run: async c => {
    const a = (c.args[0] || '').toLowerCase(), s = getSettings();
    if (['on', 'off'].includes(a)) { s.botOff = a === 'off'; await saveSettings(); return c.ok(s.botOff ? 'Bot em pausa: só o fundador é atendido.' : 'Bot activo para todos.'); }
    return c.send('PAINEL', [`Estado: ${s.botOff ? 'EM PAUSA' : 'ACTIVO'}`, `Activo há: ${fmtUptime(process.uptime())}`, `Encomendas abertas: ${listOrders(o => OPEN.includes(o.state)).length}`,
      `Alugueres activos: ${listRentals(r => r.state === 'ACTIVO').length}`, `Venda automática: ${s.vendaAuto ? 'sim' : 'não'}`, `Modo grátis: ${s.freeMode ? 'sim' : 'não'}`]);
  } }
];
