import config from '../config.js';
import { formatarMensagem } from '../plugins/style.js';
import { isSafeUrl } from '../plugins/security.js';
import { safeFetch, parseMeta } from '../plugins/net.js';
import { getContextInfo, normalizePhone, unwrap } from '../plugins/utils.js';

const P = 'PESQUISA';
/** Dependências substituíveis nos testes. */
export const deps = { fetch: (...a) => fetch(...a), safeFetch: (...a) => safeFetch(...a) };

const json = async (url, ms = 8000) => {
  const r = await deps.fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const normUrl = s => (/^https?:\/\//i.test(s) ? s : 'https://' + s);

export function safeJson(obj, max = 3000) {
  const s = JSON.stringify(obj, (k, v) => typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + `…[${v.length}]` : v?.type === 'Buffer' || v instanceof Uint8Array ? '[binário]' : v, 2);
  return s.length > max ? s.slice(0, max) + '\n…' : s;
}

export default [
  { name: 'google-search', cat: P, level: 4, desc: 'Pesquisa na web (Google Custom Search)', usage: '.google-search termo', run: async c => {
    if (!c.text) return c.fail('Uso: .google-search <termo>');
    if (!config.googleKey || !config.googleCx) return c.fail('Pesquisa não configurada. O dono tem de definir GOOGLE_API_KEY e GOOGLE_CX (Custom Search JSON API).');
    try {
      const j = await json(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(config.googleKey)}&cx=${encodeURIComponent(config.googleCx)}&num=5&q=${encodeURIComponent(c.text.slice(0, 200))}`);
      const items = j.items ?? [];
      if (!items.length) return c.fail('Sem resultados.');
      return c.send('PESQUISA', items.flatMap((i, n) => [`${n + 1}. ${i.title}`, i.link, (i.snippet || '').replace(/\s+/g, ' ').slice(0, 140)]), { frase: false });
    } catch { return c.fail('Serviço de pesquisa indisponível.'); }
  } },
  { name: 'cep', cat: P, level: 4, desc: 'Consulta CEP (Brasil, via ViaCEP)', usage: '.cep 01001000', run: async c => {
    const cep = (c.args[0] || '').replace(/\D/g, '');
    if (cep.length !== 8) return c.fail('Uso: .cep <8 dígitos>. O CEP é o código postal do Brasil.');
    try {
      const j = await json(`https://viacep.com.br/ws/${cep}/json/`);
      if (j.erro) return c.fail('CEP não encontrado.');
      return c.send('CEP', [`${j.cep}`, `${j.logradouro || '—'}`, `${j.bairro || '—'}`, `${j.localidade}/${j.uf}`], { frase: false });
    } catch { return c.fail('Serviço de CEP indisponível.'); }
  } },
  { name: 'link', cat: P, level: 4, desc: 'Encurta um link (is.gd)', usage: '.link https://...', run: async c => {
    if (!c.args[0]) return c.fail('Uso: .link <url>');
    const url = normUrl(c.args[0]); if (!isSafeUrl(url)) return c.fail('URL inválida ou não permitida.');
    try {
      const j = await json(`https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`);
      return j.shorturl ? c.send('LINK ENCURTADO', [j.shorturl], { frase: false }) : c.fail(j.errormessage || 'Não foi possível encurtar.');
    } catch { return c.fail('Serviço de encurtamento indisponível.'); }
  } },
  { name: 'gerar-link', cat: P, level: 4, desc: 'Gera link wa.me', usage: '.gerar-link 258840000001 [mensagem]', run: c => {
    const n = normalizePhone(c.args[0] || ''); if (!n) return c.fail('Uso: .gerar-link <número com indicativo> [mensagem]');
    const msg = c.args.slice(1).join(' ');
    return c.send('LINK WHATSAPP', [`https://wa.me/${n}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`], { frase: false });
  } },
  { name: 'metadados', cat: P, level: 4, desc: 'Título e dados de um link (com protecção anti-SSRF)', usage: '.metadados https://...', run: async c => {
    if (!c.args[0]) return c.fail('Uso: .metadados <url>');
    const url = normUrl(c.args[0]); if (!isSafeUrl(url)) return c.fail('URL inválida ou não permitida.');
    try {
      const r = await deps.safeFetch(url), meta = /html/i.test(r.contentType) ? parseMeta(r.body) : {};
      return c.send('METADADOS', [`Estado: ${r.status}`, `Tipo: ${r.contentType.split(';')[0] || '—'}`, `URL final: ${r.url}`,
        ...(meta.title ? [`Título: ${meta.title}`] : []), ...(meta.description ? [`Descrição: ${meta.description}`] : []), ...(r.truncated ? ['(conteúdo truncado)'] : [])], { frase: false });
    } catch (e) { return c.fail(/privado|permitida/.test(e.message) ? 'Destino não permitido.' : 'Não foi possível obter o endereço.'); }
  } },
  { name: 'raw', cat: P, level: 3, desc: 'Estrutura técnica da mensagem respondida', run: c => {
    const ci = getContextInfo(unwrap(c.m.message)), obj = ci?.quotedMessage ?? unwrap(c.m.message);
    return c.reply('```' + safeJson(obj) + '```');
  } }
];
