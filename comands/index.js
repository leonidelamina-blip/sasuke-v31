import general from './general.js';
import owner from './owner.js';
import group from './group.js';
import admin from './admin.js';
import nano from './nano.js';
import commerce from './commerce.js';
import rentals from './rentals.js';
import media from './media.js';
import utility from './utility.js';
import ai from './ai.js';
import automation from './automation.js';

/** Traduz recusas típicas do WhatsApp em mensagens úteis (outros erros seguem para o registo de erros). */
export function friendlyError(e) {
  const code = e?.data ?? e?.output?.statusCode, msg = String(e?.message ?? '');
  if (code === 403 || /forbidden|not-authorized|not authorized/i.test(msg)) return 'O WhatsApp recusou a operação. Confirma que o bot é administrador do grupo.';
  if (code === 404 || /not-in-group|item-not-found|not found/i.test(msg)) return 'O WhatsApp não encontrou o alvo (já saiu do grupo?).';
  if (code === 429 || /rate-overlimit|too many|overlimit/i.test(msg)) return 'O WhatsApp limitou os pedidos. Tenta daqui a pouco.';
  if (/timed out|timeout|connection closed/i.test(msg)) return 'A ligação ao WhatsApp falhou momentaneamente. Tenta de novo.';
  return null;
}
const withErrors = run => async c => {
  try { return await run(c); }
  catch (e) { const f = friendlyError(e); if (f) return c.fail(f); throw e; }
};

export const commands = [...general, ...owner, ...group, ...admin, ...nano, ...commerce, ...rentals, ...media, ...utility, ...ai, ...automation]
  .map(cmd => ({ ...cmd, run: withErrors(cmd.run) }));

export function buildIndex(list = commands) {
  const map = new Map();
  for (const cmd of list) {
    for (const n of [cmd.name, ...(cmd.aliases || [])]) {
      if (map.has(n)) throw new Error(`Comando duplicado: ${n}`);
      map.set(n, cmd);
    }
  }
  return map;
}
export const index = buildIndex();
export const findCommand = name => index.get(name);
