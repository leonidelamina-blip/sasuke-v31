import config from '../config.js';
import { getContextInfo, unwrap } from '../plugins/utils.js';
import { isOwnerPhone, resolvePhone, toPhone } from '../plugins/security.js';

const A = 'ADMINISTRAÇÃO DE GRUPOS';
const WHY = { 403: 'o WhatsApp recusou (o alvo é administrador/dono ou o bot não tem permissão)', 404: 'o membro não está no grupo', 408: 'o membro saiu há pouco', 409: 'o membro já estava nessa situação' };

/** O WhatsApp devolve o resultado por membro (status) sem lançar erro: temos de o ler. */
export async function changeMembers(c, jids, action) {
  const res = await c.sock.groupParticipantsUpdate(c.jid, jids, action);
  const bad = (Array.isArray(res) ? res : []).filter(r => r && r.status !== undefined && String(r.status) !== '200');
  return { ok: bad.length === 0, reason: bad.length ? (WHY[Number(bad[0].status)] ?? `código ${bad[0].status}`) : null };
}

/** Alvo: menção, mensagem respondida ou número escrito. */
export function getTarget(c) {
  const ci = getContextInfo(unwrap(c.m.message));
  const d = (c.args[0] || '').replace(/\D/g, '');
  return ci?.mentionedJid?.[0] || ci?.participant || (d.length >= 10 ? d + '@s.whatsapp.net' : null);
}

/** Impede acções contra o fundador ou contra o próprio bot. */
export function isProtected(c, jid) {
  const phone = resolvePhone(jid, c.meta?.participants);
  const mine = [c.sock.user?.id, c.sock.user?.lid].filter(Boolean).map(toPhone);
  return isOwnerPhone(phone) || mine.includes(toPhone(jid));
}

const setting = (name, value, title, msg, desc) => ({
  name, cat: A, level: 3, group: true, botAdmin: true, desc,
  run: async c => { await c.sock.groupSettingUpdate(c.jid, value); return c.send(title, [msg]); }
});

const member = (name, action, title, desc) => ({
  name, cat: A, level: 3, group: true, botAdmin: true, desc, usage: `.${name} @membro`,
  run: async c => {
    const t = getTarget(c);
    if (!t) return c.fail('Marca, responde ou escreve o número do membro.');
    if (action === 'remove' && isProtected(c, t)) return c.fail('Alvo protegido.');
    const r = await changeMembers(c, [t], action);
    if (!r.ok) return c.fail(`Não foi possível: ${r.reason}.`);
    return c.send(title, [`@${toPhone(t)}`], { mentions: [t] });
  }
});

export default [
  setting('abre', 'not_announcement', 'GRUPO ABERTO', 'Todos podem escrever.', 'Abre o grupo a todos'),
  setting('fecha', 'announcement', 'GRUPO FECHADO', 'Só administradores podem escrever.', 'Só admins podem escrever'),
  { name: 'grupo', cat: A, level: 4, group: true, desc: 'Informação do grupo', run: c => c.send('GRUPO', [
    `Nome: ${c.meta.subject}`, `Membros: ${c.meta.participants.length}`,
    `Administradores: ${c.meta.participants.filter(p => p.admin).length}`,
    `Escrita: ${c.meta.announce ? 'só admins' : 'todos'}`]) },
  member('kick', 'remove', 'MEMBRO REMOVIDO', 'Remove um membro'),
  member('promover', 'promote', 'PROMOVIDO', 'Promove a administrador'),
  member('rebaixar', 'demote', 'REBAIXADO', 'Remove o estatuto de administrador'),
  { name: 'hidetag', cat: A, level: 3, group: true, desc: 'Marca todos sem listar', usage: '.hidetag texto', run: c => {
    if (!c.text) return c.fail('Escreve a mensagem. Ex: .hidetag Atenção');
    return c.sock.sendMessage(c.jid, { text: c.text, mentions: c.meta.participants.map(p => p.id) });
  } },
  { name: 'todos', cat: A, level: 3, group: true, desc: 'Marca todos os membros', usage: '.todos [mensagem]', run: c =>
    c.send(c.text || 'ATENÇÃO', c.meta.participants.map(p => `@${toPhone(p.id)}`), { mentions: c.meta.participants.map(p => p.id) }) },
  { name: 'limpar', cat: A, level: 3, group: true, botAdmin: true, desc: 'Apaga a mensagem respondida', usage: 'Responde a uma mensagem com .limpar', run: async c => {
    const ci = getContextInfo(unwrap(c.m.message));
    if (!ci?.stanzaId) return c.fail('Responde à mensagem que queres apagar com .limpar');
    await c.sock.sendMessage(c.jid, { delete: { remoteJid: c.jid, fromMe: false, id: ci.stanzaId, participant: ci.participant } });
  } },
  { name: 'mudar-nome-grupo', cat: A, level: 3, group: true, botAdmin: true, desc: 'Altera o nome do grupo', usage: '.mudar-nome-grupo Novo nome', run: async c => {
    if (!c.text || c.text.length > 100) return c.fail('Indica um nome (máx. 100 caracteres).');
    await c.sock.groupUpdateSubject(c.jid, c.text);
    return c.ok('Nome do grupo alterado.');
  } }
];
