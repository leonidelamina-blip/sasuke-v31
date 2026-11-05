import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';

let dir = process.env.SASUKE_DB_DIR || path.join(config.root, 'database');
const cache = new Map();
const chains = new Map();

/** Muda a pasta das bases de dados (usado nos testes). */
export function setDir(d) { dir = d; cache.clear(); chains.clear(); }

/** Devolve o objecto em memória de uma base (carrega do disco na 1ª vez). */
export function db(name, fallback = {}) {
  if (!cache.has(name)) {
    let data;
    const file = path.join(dir, name + '.json');
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      if (e.code !== 'ENOENT') {            // existe mas está ilegível: guarda cópia antes de recomeçar
        try { fs.copyFileSync(file, `${file}.corrupto-${Date.now()}`); console.error(`[db] ${name}.json ilegível; cópia guardada. A recomeçar vazio.`); } catch { /* sem permissões */ }
      }
      data = structuredClone(fallback);
    }
    cache.set(name, data);
  }
  return cache.get(name);
}

/** Guarda de forma atómica (ficheiro temporário + rename), com fila por ficheiro. */
export function save(name) {
  if (!cache.has(name)) return Promise.resolve();
  const file = path.join(dir, name + '.json');
  const prev = chains.get(name) || Promise.resolve();
  const next = prev.then(async () => {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(cache.get(name), null, 2));
    await fsp.rename(tmp, file);
  }).catch(e => console.error('[db] erro ao guardar', name, e.message));
  chains.set(name, next);
  return next;
}

export const flush = () => Promise.all([...chains.values()]);

const GROUP_DEFAULTS = () => ({
  welcome: false, bye: false, antilink: false, soadmin: false,
  antiestrangeiros: false, anticoncorrencia: false, autoremover: false, strikes: {}, fauto: null, fautoState: null,
  concorrencia: [], muted: [], banned: []
});

export function getGroup(jid) {
  const g = db('groups');
  if (!g[jid]) g[jid] = GROUP_DEFAULTS();
  else for (const [k, v] of Object.entries(GROUP_DEFAULTS())) if (!(k in g[jid])) g[jid][k] = v;
  return g[jid];
}
export const saveGroups = () => save('groups');

export const getSettings = () => db('settings');
export const saveSettings = () => save('settings');

/** Identificador único legível, ex.: ORD-LX3K2A9F1B */
export const uid = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
