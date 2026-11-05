import { db, save, uid } from './database.js';
import { credit } from './economy.js';
import { round2 } from './utils.js';

export const ORDER_STATES = ['PENDENTE', 'EM ANÁLISE', 'APROVADO', 'REJEITADO', 'CANCELADO'];
export const TRANSITIONS = {
  'PENDENTE': ['EM ANÁLISE', 'APROVADO', 'REJEITADO', 'CANCELADO'],
  'EM ANÁLISE': ['PENDENTE', 'APROVADO', 'REJEITADO', 'CANCELADO'],
  'APROVADO': [],                 // estado final: impede aprovações repetidas
  'REJEITADO': ['PENDENTE'],      // .restaura
  'CANCELADO': ['PENDENTE']
};
export const OPEN = ['PENDENTE', 'EM ANÁLISE'];
const DUP_WINDOW = 10 * 60e3;

export const getOrder = id => db('orders')[String(id || '').toUpperCase()] ?? null;
export const listOrders = (fn = () => true) => Object.values(db('orders')).filter(fn).sort((a, b) => b.createdAt - a.createdAt);
export const openOrdersOf = client => listOrders(o => o.client === client && OPEN.includes(o.state));

export class DuplicateOrder extends Error {
  constructor(order) { super('Encomenda duplicada'); this.order = order; }
}

export function createOrder({ client, type = 'COMPRA', dest = null, operator = null, product = null, value, kind = 'megas' }) {
  value = round2(value);
  if (!(value > 0)) throw new Error('Valor inválido');
  const now = Date.now();
  const dup = listOrders(o => o.client === client && o.type === type && OPEN.includes(o.state) && o.dest === dest &&
    o.product === product && o.value === value && now - o.createdAt < DUP_WINDOW)[0];
  if (dup) throw new DuplicateOrder(dup);
  const id = uid(type === 'DEPOSITO' ? 'DEP' : 'ORD');
  const order = { id, type, kind, client, dest, operator, product, value, state: 'PENDENTE', createdAt: now,
    proof: null, admin: null, history: [{ ts: now, state: 'PENDENTE', by: client }] };
  db('orders')[id] = order;
  save('orders');
  return order;
}

/** A transição valida e altera de forma síncrona; só depois há `await` (sem aprovações duplas). */
export async function setState(id, to, { by = null, note = null } = {}) {
  const o = getOrder(id);
  if (!o) throw new Error('Encomenda não encontrada');
  if (o.state === to) throw new Error(`Encomenda já está ${to}`);
  if (!TRANSITIONS[o.state]?.includes(to)) throw new Error(`Transição inválida: ${o.state} → ${to}`);
  o.state = to;
  o.history.push({ ts: Date.now(), state: to, by, note });
  if (by && by !== o.client) o.admin = by;
  if (to === 'APROVADO') {
    o.approvedAt = Date.now();
    if (o.type === 'DEPOSITO') await credit(o.client, o.value, { orderId: o.id, note: 'Depósito aprovado', by });
  }
  await save('orders');
  return o;
}

export const orderLine = o => `${o.id} • ${o.state} • ${o.type === 'DEPOSITO' ? 'Depósito' : `${o.operator} ${o.product} → ${o.dest}`} • ${o.value.toFixed(2)} MT`;
