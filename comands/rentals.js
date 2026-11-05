import { formatarMensagem } from '../plugins/style.js';
import {
  activate, addRental, daysLeft, delPlan, getRental, listPlans, listRentals, reactivate, removeRental, renew, requestRental, setPlan, suspend
} from '../plugins/rentals.js';
import { fmtDateTime, fmtMT, parseMoney } from '../plugins/utils.js';

const R = 'SISTEMA DE ALUGUER', F = 'ADMINISTRAÇÃO DO FUNDADOR';
const line = r => `${r.id} • ${r.state} • +${r.phone} • ${r.plan} • ${r.state === 'ACTIVO' ? `${daysLeft(r)}d (até ${fmtDateTime(r.expiry).slice(0, 10)})` : '—'}`;
const wrap = fn => async c => { try { return await fn(c); } catch (e) { return c.fail(e.message); } };

export default [
  { name: 'alugar', cat: R, level: 4, desc: 'Vê os planos e pede um aluguer', usage: '.alugar [plano]', run: wrap(async c => {
    const plans = listPlans();
    if (!c.args.length) return c.send('ALUGUER DO BOT', plans.length ? [...plans.map(p => `${p.nome}: ${p.dias} dias • ${fmtMT(p.valor)}`), '', 'Pede com: .alugar <plano>'] : ['Ainda não há planos configurados. Fala com o dono.']);
    if (!c.phone) return c.fail('Não consegui identificar o teu número.');
    const r = await requestRental(c.phone, c.args.join(' '));
    await c.notifyOwner(`🏷️ Pedido de aluguer ${r.id}: +${c.phone}, plano ${r.plan} (${fmtMT(r.valor)})`);
    return c.send('PEDIDO DE ALUGUER', [`ID: ${r.id}`, `Plano: ${r.plan} • ${r.dias} dias • ${fmtMT(r.valor)}`, 'Estado: PENDENTE', 'Combina o pagamento com o dono; o aluguer só é activado por ele.']);
  }) },
  { name: 'meualuguer', cat: R, level: 4, desc: 'Estado do teu aluguer', run: c => {
    const l = listRentals(r => r.phone === c.phone);
    return l.length ? c.send('O TEU ALUGUER', l.map(line)) : c.fail('Não tens alugueres.');
  } },
  { name: 'alugados', cat: F, level: 1, desc: 'Lista alugueres', run: c => {
    const l = listRentals();
    return c.send('ALUGUERES', l.length ? l.slice(0, 20).map(line) : ['Sem alugueres.']);
  } },
  { name: 'addaluguer', cat: F, level: 1, desc: 'Cria/activa um aluguer', usage: '.addaluguer <número> <plano>  |  .addaluguer <ID pendente>', run: wrap(async c => {
    if (/^ALG-/i.test(c.args[0] || '')) { const r = await activate(c.args[0], c.phone); return c.ok(`${r.id} activado até ${fmtDateTime(r.expiry)}.`); }
    const phone = (c.args[0] || '').replace(/\D/g, ''); if (phone.length < 10 || c.args.length < 2) return c.fail('Uso: .addaluguer <número com indicativo> <plano>');
    const r = await addRental({ phone, plan: c.args.slice(1).join(' '), by: c.phone });
    return c.ok(`${r.id} criado para +${phone} até ${fmtDateTime(r.expiry)}.`);
  }) },
  { name: 'delaluguer', cat: F, level: 1, desc: 'Remove um aluguer', usage: '.delaluguer ID', run: wrap(async c => { const r = await removeRental(c.args[0]); return c.ok(`${r.id} removido.`); }) },
  { name: 'renovar', cat: F, level: 1, desc: 'Renova um aluguer', usage: '.renovar ID [dias]', run: wrap(async c => {
    const r = await renew(c.args[0], c.phone, { dias: c.args[1] ? Number(c.args[1]) : undefined });
    await c.sock.sendMessage(r.phone + '@s.whatsapp.net', { text: formatarMensagem('ALUGUER RENOVADO', [`ID: ${r.id}`, `Válido até ${fmtDateTime(r.expiry)}`], { gratis: false }) }).catch(() => {});
    return c.ok(`${r.id} renovado até ${fmtDateTime(r.expiry)}.`);
  }) },
  { name: 'suspender', cat: F, level: 1, desc: 'Suspende um aluguer', usage: '.suspender ID', run: wrap(async c => { const r = await suspend(c.args[0], c.phone); return c.ok(`${r.id} suspenso (tempo restante guardado).`); }) },
  { name: 'reativar', cat: F, level: 1, desc: 'Reactiva um aluguer suspenso', usage: '.reativar ID', run: wrap(async c => { const r = await reactivate(c.args[0], c.phone); return c.ok(`${r.id} ${r.state}, até ${fmtDateTime(r.expiry)}.`); }) },
  { name: 'setplano', cat: F, level: 1, desc: 'Cria/altera um plano', usage: '.setplano Nome | dias | valor', run: wrap(async c => {
    const [n, d, v] = c.text.split('|').map(s => s.trim());
    if (!n || !d || v == null) return c.fail('Uso: .setplano Mensal | 30 | 500');
    await setPlan(n, d, parseMoney(v)); return c.ok(`Plano ${n}: ${d} dias, ${fmtMT(parseMoney(v))}.`);
  }) },
  { name: 'delplano', cat: F, level: 1, desc: 'Remove um plano', usage: '.delplano Nome', run: wrap(async c => { await delPlan(c.text); return c.ok('Plano removido.'); }) }
];
