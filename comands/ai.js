import { ask, AIError } from '../plugins/ai.js';
import { createRateLimiter } from '../plugins/security.js';
import { getQuotedText } from '../plugins/utils.js';

const limiter = createRateLimiter({ max: 5, windowMs: 60_000 });

export default [
  { name: 'ia', cat: 'INTELIGÊNCIA ARTIFICIAL', level: 4, desc: 'Pergunta à IA (explica, resume, ajuda com código, ideias)', usage: '.ia pergunta  (responde a uma mensagem para resumir/explicar)', run: async c => {
    const quoted = getQuotedText(c.m.message);
    if (!c.text && !quoted) return c.fail('Uso: .ia <pergunta>. Podes também responder a uma mensagem com .ia resume.');
    if (!limiter.hit(c.phone || c.jid)) return c.fail('Limite: 5 pedidos por minuto.');
    try {
      const answer = await (c.deps?.ask ?? ask)(c.text || 'Resume e explica o texto do contexto.', { context: quoted, withStore: true });
      return c.send('IA', answer.split('\n'), { frase: false });
    } catch (e) { return c.fail(e instanceof AIError ? e.message : 'Falha ao contactar a IA.'); }
  } }
];
