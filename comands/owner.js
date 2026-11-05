import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { formatarMensagem } from '../plugins/style.js';
import { getSettings, saveSettings } from '../plugins/database.js';
import { formatPhone, getContextInfo, unwrap } from '../plugins/utils.js';

const F = 'ADMINISTRAÇÃO DO FUNDADOR';
const MAX_PHOTO = 5 * 1024 * 1024;

export function ownerCardText() {
  return formatarMensagem('FUNDADOR', [
    `👑 FUNDADOR: ${config.ownerFullName}`, `📱 WhatsApp: ${formatPhone(config.ownerNumber)}`,
    `📧 E-mail: ${config.ownerEmail}`, `🤖 BOT: ${config.botName}`, `📢 CANAL: ${config.channelUrl}`
  ], { gratis: false });
}

async function ownerPhoto(sock) {
  if (fs.existsSync(config.ownerPhotoPath)) return { image: fs.readFileSync(config.ownerPhotoPath) };
  try {
    const url = await sock.profilePictureUrl(config.ownerNumber + '@s.whatsapp.net', 'image');
    if (url) return { image: { url } };
  } catch { /* privacidade/indisponível */ }
  return null;
}

export default [
  { name: 'dono', aliases: ['criador', 'owner'], cat: 'COMANDOS GERAIS', level: 4, desc: 'Cartão do fundador', run: async c => {
    const caption = ownerCardText();
    const photo = await ownerPhoto(c.sock);
    if (photo) {
      try { return await c.sock.sendMessage(c.jid, { ...photo, caption }, { quoted: c.m }); } catch { /* cai para texto */ }
    }
    return c.reply(caption);
  } },

  { name: 'donofoto', cat: F, level: 1, desc: 'Define a fotografia oficial do fundador', usage: 'Envia/responde a uma imagem com .donofoto', run: async c => {
    const content = unwrap(c.m.message);
    let target = null;
    if (content?.imageMessage) target = c.m;
    else {
      const ci = getContextInfo(content);
      if (unwrap(ci?.quotedMessage)?.imageMessage) {
        target = { key: { remoteJid: c.jid, id: ci.stanzaId, participant: ci.participant, fromMe: false }, message: ci.quotedMessage };
      }
    }
    if (!target) return c.fail('Envia uma imagem com a legenda .donofoto, ou responde a uma imagem com .donofoto');
    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
    const buf = await downloadMediaMessage(target, 'buffer', {}, { logger: c.logger, reuploadRequest: c.sock.updateMediaMessage });
    if (!buf?.length || buf.length > MAX_PHOTO) return c.fail('Imagem inválida ou superior a 5 MB.');
    fs.mkdirSync(path.dirname(config.ownerPhotoPath), { recursive: true });
    fs.writeFileSync(config.ownerPhotoPath, buf);
    return c.ok('Fotografia oficial do fundador actualizada.');
  } },

  { name: 'modo-gratis', cat: F, level: 1, desc: 'Mostra o canal oficial nas mensagens', usage: '.modo-gratis on|off', run: async c => {
    const a = (c.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(a)) return c.send('MODO GRÁTIS', [`Estado: ${getSettings().freeMode ? 'ACTIVO' : 'INACTIVO'}`, 'Usa .modo-gratis on|off']);
    getSettings().freeMode = a === 'on';
    await saveSettings();
    return c.ok(`Modo grátis ${a === 'on' ? 'activado' : 'desactivado'}.`);
  } }
];
