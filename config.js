import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Carregador mínimo de .env (sem dependências)
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* sem .env */ }

const env = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

export default {
  root,
  botName: 'SASUKE V31 — GOD EDITION',
  shortName: 'SASUKE V31',
  edition: 'GOD EDITION',
  prefix: env('PREFIX', '.'),
  ownerNumber: env('OWNER_NUMBER', '258852223969'),
  ownerName: 'Leo',
  ownerFullName: 'LEONIDE ANTÓNIO LÂMINA',
  ownerEmail: 'leonidelamina.dev.2026@gmail.com',
  botNumber: env('BOT_NUMBER', ''),
  channelUrl: 'https://whatsapp.com/channel/0029VbBfoWhAO7RJaD9mXy2k',
  channelName: 'ʟᴀ ʟᴀᴍɪɴᴀ 𝑺𝑨𝑺𝑼𝑲𝑬 𝑩𝑶𝑻',
  defaultCountryCode: '258',
  allowedCountryCodes: env('ALLOWED_COUNTRY_CODES', '258').split(',').map(s => s.trim()).filter(Boolean),
  timezone: 'Africa/Maputo',
  rate: { max: 8, windowMs: 10_000 },
  ownerPhotoPath: path.join(root, 'assets', 'owner', 'fundador.jpg'),
  sessionDir: path.join(root, 'sessao'),
  ai: { url: env('AI_API_URL'), key: env('AI_API_KEY'), model: env('AI_MODEL'), imageUrl: env('AI_IMAGE_URL'), imageModel: env('AI_IMAGE_MODEL') },
  googleKey: env('GOOGLE_API_KEY'), googleCx: env('GOOGLE_CX'),
  webhookPort: Number(env('PAYMENT_WEBHOOK_PORT', '0'))
};
