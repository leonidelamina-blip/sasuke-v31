import { db, save, uid } from './database.js';
import { round2 } from './utils.js';

export function getUser(phone) { return (db('users')[phone] ??= { firstSeen: Date.now(), cmds: 0 }); }
export const getBalance = phone => round2(db('users')[phone]?.balance ?? 0);

function store() { const t = db('transactions'); t.history ??= []; t.received ??= {}; t.refs ??= {}; return t; }
export const allTransactions = () => store().history;
export const historyOf = (phone, n = 10) => store().history.filter(t => t.phone === phone).slice(-n).reverse();

function log(type, phone, amount, meta) {
  const tx = { id: uid('TX'), ts: Date.now(), type, phone, amount, balanceAfter: getBalance(phone), ...meta };
  store().history.push(tx); return tx;
}

/** Operações síncronas na memória + gravação: sem corridas entre verificar e alterar. */
export async function credit(phone, amount, meta = {}) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Valor inválido');
  const u = getUser(phone); u.balance = round2((u.balance ?? 0) + amount);
  const tx = log('CREDITO', phone, amount, meta);
  await Promise.all([save('users'), save('transactions')]);
  return tx;
}

export async function debit(phone, amount, meta = {}) {
  amount = round2(amount);
  if (!(amount > 0)) throw new Error('Valor inválido');
  if (getBalance(phone) < amount) throw new Error('Saldo insuficiente');
  const u = getUser(phone); u.balance = round2(u.balance - amount);
  const tx = log('DEBITO', phone, amount, meta);
  await Promise.all([save('users'), save('transactions')]);
  return tx;
}

export function salesReport(sinceMs, now = Date.now()) {
  const orders = Object.values(db('orders')).filter(o => o.type === 'COMPRA' && (o.approvedAt ?? 0) >= sinceMs && o.state === 'APROVADO');
  const total = round2(orders.reduce((s, o) => s + o.value, 0));
  const by = {};
  for (const o of orders) { by[o.operator] ??= { n: 0, total: 0 }; by[o.operator].n++; by[o.operator].total = round2(by[o.operator].total + o.value); }
  const deposits = round2(Object.values(db('orders')).filter(o => o.type === 'DEPOSITO' && o.state === 'APROVADO' && (o.approvedAt ?? 0) >= sinceMs).reduce((s, o) => s + o.value, 0));
  const pending = Object.values(db('orders')).filter(o => ['PENDENTE', 'EM ANÁLISE'].includes(o.state)).length;
  return { count: orders.length, total, by, deposits, pending, from: sinceMs, to: now };
}
