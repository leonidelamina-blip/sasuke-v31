import { db, save, uid, getGroup, saveGroups, getSettings, saveSettings } from './database.js';
import { formatarMensagem } from './style.js';
import { listRentals, daysLeft } from './rentals.js';
import { nowHM, inClosedWindow } from './utils.js';

const DAY = 86400e3;
const tasks = () => (getSettings().tasks ??= {});

/* ───────── mensagens agendadas (persistentes) ───────── */
export async function addTask({ jid, text, at, by }) {
  if (!text || !(at > Date.now())) throw new Error('Data/hora inválida ou já passou');
  if (Object.values(tasks()).filter(t => t.status === 'PENDENTE' && t.jid === jid).length >= 20) throw new Error('Limite de 20 agendamentos por chat');
  const id = uid('AG'); tasks()[id] = { id, jid, text: String(text).slice(0, 2000), at, by, status: 'PENDENTE', attempts: 0 };
  await saveSettings(); return tasks()[id];
}
export const listTasks = jid => Object.values(tasks()).filter(t => t.status === 'PENDENTE' && (!jid || t.jid === jid)).sort((a, b) => a.at - b.at);
export async function cancelTask(id, jid) {
  const t = tasks()[String(id).toUpperCase()];
  if (!t || t.status !== 'PENDENTE' || (jid && t.jid !== jid)) throw new Error('Agendamento não encontrado');
  t.status = 'CANCELADO'; await saveSettings(); return t;
}

/** Ao reiniciar, recupera tarefas em atraso (até 24h); mais antigas ficam PERDIDO e não são enviadas. */
export async function runDueTasks(sock, now = Date.now()) {
  let sent = 0;
  for (const t of Object.values(tasks())) {
    if (t.status !== 'PENDENTE' || t.at > now) continue;
    if (now - t.at > DAY) { t.status = 'PERDIDO'; continue; }
    try { await sock.sendMessage(t.jid, { text: formatarMensagem('MENSAGEM AGENDADA', [t.text], { frase: false, gratis: false }) }); t.status = 'ENVIADO'; t.sentAt = now; sent++; }
    catch { if (++t.attempts >= 3) t.status = 'FALHOU'; }
  }
  await saveSettings(); return sent;
}

/* ───────── alugueres: expiração e avisos (não desliga sessões de ninguém) ───────── */
export async function runRentalChecks(sock, notifyOwner = async () => {}, now = Date.now()) {
  const events = [];
  for (const r of listRentals(x => x.state === 'ACTIVO')) {
    const jid = r.phone + '@s.whatsapp.net';
    if (now >= r.expiry) {
      r.state = 'EXPIRADO'; r.history.push({ ts: now, state: 'EXPIRADO', by: 'SISTEMA' });
      await sock.sendMessage(jid, { text: formatarMensagem('ALUGUER EXPIRADO', [`ID: ${r.id}`, `Plano: ${r.plan}`, 'Contacta o dono para renovar.'], { gratis: false }) }).catch(() => {});
      await Promise.resolve(notifyOwner(`⏰ Aluguer expirado: ${r.id} (+${r.phone}, plano ${r.plan})`)).catch(() => {});
      events.push(['expirado', r.id]);
    } else {
      const left = r.expiry - now;
      for (const [flag, lim] of [['d1', DAY], ['d3', 3 * DAY]]) {
        if (left <= lim && !r.warned[flag]) {
          r.warned.d1 = r.warned.d1 || flag === 'd1'; r.warned.d3 = true;
          await sock.sendMessage(jid, { text: formatarMensagem('AVISO DE ALUGUER', [`ID: ${r.id}`, `Plano: ${r.plan}`, `Faltam ${daysLeft(r, now)} dia(s).`, 'Renova com o dono para não perder o acesso.'], { gratis: false }) }).catch(() => {});
          events.push(['aviso', r.id]); break;
        }
      }
    }
  }
  if (events.length) await save('rentals');
  return events;
}

/* ───────── fecho/abertura automática de grupos (.f.auto) ───────── */
const lastTry = new Map();
export async function runFauto(sock, now = Date.now()) {
  const changes = [];
  for (const jid of Object.keys(db('groups'))) {
    const cfg = getGroup(jid);
    if (!cfg.fauto?.on) continue;
    const closed = inClosedWindow(nowHM(now), cfg.fauto.close, cfg.fauto.open), want = closed ? 'closed' : 'open';
    if (cfg.fautoState === want) continue;
    if (now - (lastTry.get(jid) ?? 0) < 60e3) continue;   // não insistir em falhas
    lastTry.set(jid, now);
    try {
      await sock.groupSettingUpdate(jid, closed ? 'announcement' : 'not_announcement');
      cfg.fautoState = want; changes.push([jid, want]);
      await sock.sendMessage(jid, { text: formatarMensagem(closed ? 'GRUPO FECHADO' : 'GRUPO ABERTO', [closed ? `Reabre às ${cfg.fauto.open}.` : `Fecha às ${cfg.fauto.close}.`], { frase: false, gratis: false }) }).catch(() => {});
    } catch { /* sem permissões: tenta de novo mais tarde */ }
  }
  if (changes.length) await saveGroups();
  return changes;
}

/* ───────── ciclo ───────── */
let timer = null, busy = false;
export function start(getSock, { notifyOwner = async () => {}, intervalMs = 30_000 } = {}) {
  stop();
  const tick = async () => {
    const sock = getSock(); if (!sock || busy) return;
    busy = true;
    try { await runDueTasks(sock); await runRentalChecks(sock, notifyOwner); await runFauto(sock); }
    catch (e) { console.error('[scheduler]', e.message); }
    finally { busy = false; }
  };
  timer = setInterval(tick, intervalMs); timer.unref?.(); tick();
  return timer;
}
export function stop() { if (timer) clearInterval(timer); timer = null; }
