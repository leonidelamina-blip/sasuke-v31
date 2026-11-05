import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDir } from '../plugins/database.js';
import { formatarMensagem, formatarErro, formatarSucesso } from '../plugins/style.js';

export const tmpDb = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sasuke-')); setDir(d); return d; };

/** Contexto falso que regista tudo o que o comando envia. */
export function fakeCtx(over = {}) {
  const out = [], notes = [];
  const c = {
    out, notes, isGroup: false, sender: '', notifyOwner: async t => { notes.push(t); }, getMedia: async () => null, jid: '120@g.us', prefix: '.', text: '', args: [], level: 4, phone: '258840000001', commands: [],
    m: { key: { id: 'X', remoteJid: '120@g.us' }, message: {}, messageTimestamp: Math.floor(Date.now() / 1000) },
    sock: { user: { id: '258872698781:1@s.whatsapp.net' }, sendMessage: async (j, content) => { out.push(content); return {}; },
      profilePictureUrl: async () => { throw new Error('sem foto'); }, groupParticipantsUpdate: async () => {}, groupSettingUpdate: async () => {} },
    reply: async t => { out.push({ text: t }); },
    send: async (t, l, o = {}) => { out.push({ text: formatarMensagem(t, l, o), mentions: o.mentions }); },
    ok: async m => { out.push({ text: formatarSucesso(m) }); },
    fail: async m => { out.push({ text: formatarErro(m) }); },
    ...over
  };
  c.args = over.args ?? c.text.split(/\s+/).filter(Boolean);
  return c;
}
