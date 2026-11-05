import { getGroup, getSettings, saveGroups, saveSettings } from '../plugins/database.js';
import { addTask, cancelTask, listTasks } from '../plugins/scheduler.js';
import { fmtDateTime, normalizeText, parseWhen, validHM } from '../plugins/utils.js';

const A = 'AUTOMAÇÃO';
const norm = s => normalizeText(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const rules = () => (getSettings().autoresponder ??= []);

/** Respostas por palavra/frase contida na mensagem (sem prefixo). Devolve texto ou null. */
export function autoReply(text) {
  const n = ' ' + norm(text || '') + ' ';
  if (n.length < 3) return null;
  return rules().find(r => n.includes(' ' + r.trigger + ' '))?.reply ?? null;
}

const toggleSetting = (name, key, label, desc) => ({ name, cat: A, level: 1, desc, usage: `.${name} on|off`, run: async c => {
  const a = (c.args[0] || '').toLowerCase(), s = getSettings();
  if (!['on', 'off'].includes(a)) return c.send(label, [`Estado: ${s[key] ? 'ACTIVO' : 'INACTIVO'}`, `Usa .${name} on|off`]);
  s[key] = a === 'on'; await saveSettings(); return c.ok(`${label} ${a === 'on' ? 'activado' : 'desactivado'}.`);
} });

export default [
  toggleSetting('auto-comprovativo', 'autoProof', 'AUTO-COMPROVATIVO', 'Lê automaticamente imagens de comprovativo enviadas no privado'),

  { name: 'auto-responder', cat: A, level: 1, desc: 'Respostas automáticas por palavra-chave', usage: '.auto-responder add gatilho | resposta  |  del gatilho  |  lista', run: async c => {
    const sub = (c.args[0] || '').toLowerCase(), rest = c.text.slice(c.args[0]?.length ?? 0).trim();
    if (sub === 'add') {
      const i = rest.indexOf('|'), trigger = norm(rest.slice(0, i)), reply = rest.slice(i + 1).trim();
      if (i < 1 || !trigger || !reply) return c.fail('Uso: .auto-responder add gatilho | resposta');
      if (trigger.length > 40 || reply.length > 1000) return c.fail('Gatilho até 40 e resposta até 1000 caracteres.');
      const l = rules(), at = l.findIndex(r => r.trigger === trigger);
      if (at < 0 && l.length >= 50) return c.fail('Máximo de 50 regras.');
      if (at >= 0) l[at].reply = reply; else l.push({ trigger, reply });
      await saveSettings(); return c.ok(`Regra "${trigger}" guardada.`);
    }
    if (sub === 'del') {
      const t = norm(rest), l = rules(), at = l.findIndex(r => r.trigger === t);
      if (at < 0) return c.fail('Regra não encontrada.'); l.splice(at, 1); await saveSettings(); return c.ok('Regra removida.');
    }
    return c.send('AUTO-RESPONDER', rules().length ? rules().map(r => `• ${r.trigger}`) : ['Sem regras.', 'Usa: .auto-responder add gatilho | resposta']);
  } },

  { name: 'agendar-mensagem', aliases: ['agendar'], cat: A, level: 3, desc: 'Agenda uma mensagem neste chat', usage: '.agendar-mensagem 2026-11-10 14:30 | texto   (ou 30m | texto, 2h | texto)', run: async c => {
    if (!c.isGroup && c.level !== 1) return c.fail('No privado só o fundador pode agendar.');
    const i = c.text.indexOf('|'); if (i < 1) return c.fail('Uso: .agendar-mensagem <AAAA-MM-DD HH:MM | 30m | 2h | 14:30> | texto');
    const at = parseWhen(c.text.slice(0, i)), text = c.text.slice(i + 1).trim();
    if (!at || !text) return c.fail('Data/hora inválida. Ex: .agendar-mensagem 2026-11-10 14:30 | Olá!');
    try { const t = await addTask({ jid: c.jid, text, at, by: c.phone }); return c.ok(`Agendada ${t.id} para ${fmtDateTime(t.at)} (Maputo).`); }
    catch (e) { return c.fail(e.message); }
  } },
  { name: 'agendamentos', cat: A, level: 3, desc: 'Lista as mensagens agendadas deste chat', run: c => {
    const l = listTasks(c.jid); return c.send('AGENDAMENTOS', l.length ? l.map(t => `${t.id} • ${fmtDateTime(t.at)} • ${t.text.slice(0, 40)}`) : ['Nada agendado.']);
  } },
  { name: 'cancelar-agenda', cat: A, level: 3, desc: 'Cancela um agendamento', usage: '.cancelar-agenda ID', run: async c => {
    try { await cancelTask(c.args[0], c.jid); return c.ok('Agendamento cancelado.'); } catch (e) { return c.fail(e.message); }
  } },

  { name: 'auto-remover', cat: A, level: 3, group: true, desc: 'Remove quem acumula 3 infracções (link/concorrência) em 24h', usage: '.auto-remover on|off', run: async c => {
    const cfg = getGroup(c.jid), a = (c.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(a)) return c.send('AUTO-REMOVER', [`Estado: ${cfg.autoremover ? 'ACTIVO' : 'INACTIVO'}`, 'Remove à 3ª infracção em 24h (exige anti-link/anti-concorrência e bot admin).']);
    cfg.autoremover = a === 'on'; await saveGroups(); return c.ok(`Auto-remover ${a === 'on' ? 'activado' : 'desactivado'}.`);
  } },
  { name: 'f.auto', cat: A, level: 3, group: true, botAdmin: true, desc: 'Fecha e abre o grupo a horas fixas', usage: '.f.auto on 22:00 06:00  |  .f.auto off', run: async c => {
    const cfg = getGroup(c.jid), a = (c.args[0] || '').toLowerCase();
    if (a === 'off') { cfg.fauto = null; cfg.fautoState = null; await saveGroups(); return c.ok('Fecho automático desactivado.'); }
    if (a === 'on') {
      const [close, open] = [c.args[1], c.args[2]];
      if (!validHM(close) || !validHM(open) || close === open) return c.fail('Uso: .f.auto on <hora de fecho> <hora de abertura>. Ex: .f.auto on 22:00 06:00');
      cfg.fauto = { on: true, close, open }; cfg.fautoState = null; await saveGroups();
      return c.ok(`Fecha às ${close} e abre às ${open} (hora de Maputo).`);
    }
    return c.send('FECHO AUTOMÁTICO', cfg.fauto?.on ? [`ACTIVO: fecha ${cfg.fauto.close} • abre ${cfg.fauto.open}`] : ['INACTIVO', 'Usa .f.auto on 22:00 06:00']);
  } }
];
