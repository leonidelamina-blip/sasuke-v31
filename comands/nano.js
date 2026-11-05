import { db, save } from '../plugins/database.js';
import { formatarMensagem } from '../plugins/style.js';

const F = 'ADMINISTRAÇÃO DO FUNDADOR';
const norm = k => k.trim().toLowerCase().replace(/\s+/g, ' ');

/** Resposta automática sem prefixo: devolve o texto formatado ou null. */
export function nanoReply(text) {
  const key = norm(text || '').replace(/[.!?]+$/g, '');
  if (!key || key.length > 40) return null;
  const store = db('nano');
  if (!Object.hasOwn(store, key)) return null;
  return formatarMensagem(key.toUpperCase(), String(store[key]).split('\n'));
}

export default [
  { name: 'nanoadd', cat: F, level: 1, desc: 'Adiciona resposta automática', usage: '.nanoadd tabela | conteúdo', run: async c => {
    const i = c.text.indexOf('|');
    if (i < 1) return c.fail('Formato: .nanoadd tabela | conteúdo');
    const key = norm(c.text.slice(0, i)), val = c.text.slice(i + 1).trim();
    if (!key || !val) return c.fail('Formato: .nanoadd tabela | conteúdo');
    if (key.length > 40) return c.fail('A chave pode ter no máximo 40 caracteres.');
    if (val.length > 4000) return c.fail('O conteúdo pode ter no máximo 4000 caracteres.');
    if (key === '__proto__') return c.fail('Chave inválida.');
    const store = db('nano');
    const existed = Object.hasOwn(store, key);
    store[key] = val;
    await save('nano');
    return c.ok(`Entrada "${key}" ${existed ? 'actualizada' : 'adicionada'}.`);
  } },
  { name: 'nanodel', cat: F, level: 1, desc: 'Remove resposta automática', usage: '.nanodel tabela', run: async c => {
    const key = norm(c.text);
    const store = db('nano');
    if (!key || !Object.hasOwn(store, key)) return c.fail('Entrada não encontrada.');
    delete store[key];
    await save('nano');
    return c.ok(`Entrada "${key}" removida.`);
  } },
  { name: 'listanano', cat: F, level: 1, desc: 'Lista as respostas automáticas', run: c => {
    const keys = Object.keys(db('nano'));
    return c.send('NANO DATABASE', keys.length ? keys.map(k => `• ${k}`) : ['Sem entradas. Usa .nanoadd']);
  } }
];
