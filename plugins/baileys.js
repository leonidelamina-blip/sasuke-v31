import { getContextInfo, unwrap } from './utils.js';

const KINDS = { image: 'imageMessage', video: 'videoMessage', sticker: 'stickerMessage' };

/** Devolve uma função que obtém media da mensagem actual ou da respondida. */
export function makeGetMedia({ sock, m, jid, logger, maxBytes = 15 * 1024 * 1024 }) {
  return async (types) => {
    const content = unwrap(m.message);
    let target = null, type = null;
    for (const t of types) if (content?.[KINDS[t]]) { target = m; type = t; break; }
    if (!target) {
      const ci = getContextInfo(content), q = unwrap(ci?.quotedMessage);
      for (const t of types) if (q?.[KINDS[t]]) {
        target = { key: { remoteJid: jid, id: ci.stanzaId, participant: ci.participant, fromMe: false }, message: ci.quotedMessage };
        type = t; break;
      }
    }
    if (!target) return null;
    const info = unwrap(target.message)[KINDS[type]];
    const declared = Number(info.fileLength?.toNumber?.() ?? info.fileLength ?? 0);
    if (declared > maxBytes) throw new Error('Ficheiro demasiado grande');
    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
    const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
    if (buffer.length > maxBytes) throw new Error('Ficheiro demasiado grande');
    return { buffer, type, mimetype: info.mimetype, seconds: Number(info.seconds ?? 0) };
  };
}
