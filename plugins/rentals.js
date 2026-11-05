import { db, save, uid, getSettings, saveSettings } from './database.js';
import { round2 } from './utils.js';

export const RENTAL_STATES = ['ACTIVO', 'PENDENTE', 'EXPIRADO', 'SUSPENSO'];
const DAY = 86400e3;
export const rentals = () => db('rentals');
export const getRental = id => rentals()[String(id || '').toUpperCase()] ?? null;
export const listRentals = (fn = () => true) => Object.values(rentals()).filter(fn).sort((a, b) => a.expiry - b.expiry);
const plans = () => (getSettings().plans ??= {});
export const listPlans = () => Object.entries(plans()).map(([nome, p]) => ({ nome, ...p }));
export const findPlan = name => { const n = String(name || '').toLowerCase(); return listPlans().find(p => p.nome.toLowerCase() === n) ?? null; };

export async function setPlan(nome, dias, valor) {
  dias = Math.floor(Number(dias)); valor = round2(valor);
  if (!nome || !(dias > 0) || !(valor >= 0)) throw new Error('Plano inválido');
  plans()[nome] = { dias, valor }; await saveSettings();
}
export async function delPlan(nome) {
  const p = findPlan(nome); if (!p) throw new Error('Plano não encontrado');
  delete plans()[p.nome]; await saveSettings();
}

const push = (r, state, by, note) => r.history.push({ ts: Date.now(), state, by, note });

export async function addRental({ phone, plan, by = null, state = 'ACTIVO', now = Date.now() }) {
  const p = findPlan(plan); if (!p) throw new Error('Plano não encontrado');
  const id = uid('ALG');
  const r = { id, phone, plan: p.nome, dias: p.dias, valor: p.valor, state, start: now, expiry: now + p.dias * DAY,
    warned: { d3: false, d1: false }, history: [] };
  push(r, state, by, 'criado');
  rentals()[id] = r; await save('rentals'); return r;
}
export const requestRental = (phone, plan) => addRental({ phone, plan, by: phone, state: 'PENDENTE' });

export async function activate(id, by, now = Date.now()) {
  const r = getRental(id); if (!r) throw new Error('Aluguer não encontrado');
  if (r.state !== 'PENDENTE') throw new Error(`Aluguer está ${r.state}`);
  r.state = 'ACTIVO'; r.start = now; r.expiry = now + r.dias * DAY; push(r, 'ACTIVO', by, 'activado');
  await save('rentals'); return r;
}

export async function renew(id, by, { dias, plan, now = Date.now() } = {}) {
  const r = getRental(id); if (!r) throw new Error('Aluguer não encontrado');
  if (r.state === 'SUSPENSO') throw new Error('Aluguer suspenso: usa .reativar primeiro');
  if (r.state === 'PENDENTE') throw new Error('Aluguer pendente: usa .addaluguer/activar primeiro');
  const p = plan ? findPlan(plan) : null; if (plan && !p) throw new Error('Plano não encontrado');
  const d = Math.floor(Number(dias ?? p?.dias ?? r.dias)); if (!(d > 0)) throw new Error('Dias inválidos');
  if (p) { r.plan = p.nome; r.valor = p.valor; }
  r.expiry = Math.max(now, r.expiry) + d * DAY; r.state = 'ACTIVO'; r.warned = { d3: false, d1: false };
  push(r, 'ACTIVO', by, `renovado +${d}d`); await save('rentals'); return r;
}

export async function suspend(id, by, now = Date.now()) {
  const r = getRental(id); if (!r) throw new Error('Aluguer não encontrado');
  if (r.state !== 'ACTIVO') throw new Error(`Só é possível suspender alugueres ACTIVOS (está ${r.state})`);
  r.remaining = Math.max(0, r.expiry - now); r.state = 'SUSPENSO'; push(r, 'SUSPENSO', by); await save('rentals'); return r;
}
export async function reactivate(id, by, now = Date.now()) {
  const r = getRental(id); if (!r) throw new Error('Aluguer não encontrado');
  if (r.state !== 'SUSPENSO') throw new Error(`Aluguer não está suspenso (está ${r.state})`);
  r.expiry = now + (r.remaining ?? 0); delete r.remaining; r.warned = { d3: false, d1: false };
  r.state = r.expiry > now ? 'ACTIVO' : 'EXPIRADO'; push(r, r.state, by, 'reactivado'); await save('rentals'); return r;
}
export async function removeRental(id) {
  const r = getRental(id); if (!r) throw new Error('Aluguer não encontrado');
  delete rentals()[r.id]; await save('rentals'); return r;
}
export const daysLeft = (r, now = Date.now()) => Math.max(0, Math.ceil((r.expiry - now) / DAY));
