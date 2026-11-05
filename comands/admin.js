import { getGroup, saveGroups } from '../plugins/database.js';
import { changeMembers, getTarget, isProtected } from './group.js';
import { resolvePhone, toPhone } from '../plugins/security.js';
import config from '../config.js';

const S = 'SEGURANÇA';
const onoff = (c) => ((c.args[0] || '').toLowerCase());

function toggle(name, field, label, desc, extra = '') {
  return { name, cat: S, level: 3, group: true, desc, usage: `.${name} on|off`, run: async c => {
    const cfg = getGroup(c.jid), a = onoff(c);
    if (!['on', 'off'].includes(a)) return c.send(label, [`Estado: ${cfg[field] ? 'ACTIVO' : 'INACTIVO'}`, `Usa .${name} on|off`, extra].filter(Boolean));
    cfg[field] = a === 'on';
    await saveGroups();
    return c.ok(`${label} ${a === 'on' ? 'activado' : 'desactivado'}.`);
  } };
}

const phoneOf = (c, jid) => resolvePhone(jid, c.meta.participants) || toPhone(jid);

export default [
  toggle('anti-link', 'antilink', 'ANTI-LINK', 'Apaga links de não-admins', 'Requer bot administrador.'),
  toggle('antiestrangeiros', 'antiestrangeiros', 'ANTI-ESTRANGEIROS', 'Remove entradas de números fora dos países permitidos', `Permitidos: +${config.allowedCountryCodes.join(', +')}`),
  toggle('bemvindo', 'welcome', 'BOAS-VINDAS', 'Mensagem de boas-vindas com foto'),
  toggle('saida', 'bye', 'MENSAGEM DE SAÍDA', 'Mensagem quando alguém sai'),
  toggle('so-admin', 'soadmin', 'SÓ-ADMIN', 'Só administradores usam comandos'),

  { name: 'anticoncorrencia', cat: S, level: 3, group: true, desc: 'Apaga mensagens com termos proibidos', usage: '.anticoncorrencia on|off|add termo|del termo|lista', run: async c => {
    const cfg = getGroup(c.jid), a = onoff(c), term = c.args.slice(1).join(' ').trim().toLowerCase();
    if (a === 'on' || a === 'off') { cfg.anticoncorrencia = a === 'on'; await saveGroups(); return c.ok(`Anti-concorrência ${a === 'on' ? 'activado' : 'desactivado'}.`); }
    if (a === 'add' && term) { if (!cfg.concorrencia.includes(term)) cfg.concorrencia.push(term); await saveGroups(); return c.ok(`Termo "${term}" adicionado.`); }
    if (a === 'del' && term) { cfg.concorrencia = cfg.concorrencia.filter(t => t !== term); await saveGroups(); return c.ok(`Termo "${term}" removido.`); }
    return c.send('ANTI-CONCORRÊNCIA', [`Estado: ${cfg.anticoncorrencia ? 'ACTIVO' : 'INACTIVO'}`, `Termos: ${cfg.concorrencia.join(', ') || 'nenhum'}`, 'Usa: on | off | add termo | del termo']);
  } },

  { name: 'ban', cat: S, level: 3, group: true, botAdmin: true, desc: 'Remove e impede o regresso', usage: '.ban @membro', run: async c => {
    const t = getTarget(c); if (!t) return c.fail('Marca, responde ou escreve o número.');
    if (isProtected(c, t)) return c.fail('Alvo protegido.');
    const cfg = getGroup(c.jid), ph = phoneOf(c, t);
    if (ph && !cfg.banned.includes(ph)) cfg.banned.push(ph);
    await saveGroups();
    const r = await changeMembers(c, [t], 'remove').catch(e => ({ ok: false, reason: e.message }));
    return c.send('BANIDO', [`@${toPhone(t)}`, r.ok ? 'Removido do grupo.' : `Banimento registado, mas não consegui removê-lo agora: ${r.reason}.`], { mentions: [t] });
  } },
  { name: 'desban', cat: S, level: 3, group: true, desc: 'Retira um banimento', usage: '.desban número', run: async c => {
    const ph = (c.args[0] || '').replace(/\D/g, ''), cfg = getGroup(c.jid);
    if (!cfg.banned.includes(ph)) return c.fail('Número não está banido.');
    cfg.banned = cfg.banned.filter(x => x !== ph); await saveGroups();
    return c.ok('Banimento retirado.');
  } },
  { name: 'mutar', cat: S, level: 3, group: true, botAdmin: true, desc: 'Apaga as mensagens de um membro', usage: '.mutar @membro', run: async c => {
    const t = getTarget(c); if (!t) return c.fail('Marca, responde ou escreve o número.');
    if (isProtected(c, t)) return c.fail('Alvo protegido.');
    const cfg = getGroup(c.jid), ph = phoneOf(c, t);
    if (!ph) return c.fail('Não foi possível identificar o número real deste membro.');
    if (!cfg.muted.includes(ph)) cfg.muted.push(ph);
    await saveGroups();
    return c.send('MUTADO', [`@${toPhone(t)}`], { mentions: [t] });
  } },
  { name: 'desmutar', cat: S, level: 3, group: true, desc: 'Devolve a voz a um membro', usage: '.desmutar @membro', run: async c => {
    const t = getTarget(c); if (!t) return c.fail('Marca, responde ou escreve o número.');
    const cfg = getGroup(c.jid), ph = phoneOf(c, t);
    cfg.muted = cfg.muted.filter(x => x !== ph); await saveGroups();
    return c.ok('Membro desmutado.');
  } }
];
