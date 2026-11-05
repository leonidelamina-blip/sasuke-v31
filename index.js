import readline from 'node:readline/promises';
import pino from 'pino';
import * as baileys from '@whiskeysockets/baileys';
import config from './config.js';
import { findCommand, commands } from './commands/index.js';
import { nanoReply } from './commands/nano.js';
import { autoReply } from './commands/automation.js';
import { processProof } from './commands/commerce.js';
import { ocrImage, startWebhook } from './plugins/payments.js';
import { openOrdersOf } from './plugins/orders.js';
import { makeGetMedia } from './plugins/baileys.js';
import * as scheduler from './plugins/scheduler.js';
import { db, save, getGroup, saveGroups, getSettings, flush } from './plugins/database.js';
import { emojiFor, formatarMensagem, formatarErro, formatarSucesso } from './plugins/style.js';
import {
  addStrike, can, createDedupe, createRateLimiter, getLevel, isBotAdmin, isForeign, moderate,
  participantMatches, resolvePhone, toPhone, LEVEL
} from './plugins/security.js';
import { getText, normalizePhone, unwrap } from './plugins/utils.js';

const makeWASocket = baileys.default ?? baileys.makeWASocket;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

const logger = pino({ level: 'silent' });
const log = (...a) => console.log(new Date().toISOString(), ...a);
const seen = createDedupe();
const limiter = createRateLimiter(config.rate);
const nanoLimiter = createRateLimiter({ max: 3, windowMs: 10_000 });
const warnLimiter = createRateLimiter({ max: 1, windowMs: 60_000 });
const metaCache = new Map();

async function getMeta(sock, jid, fresh = false) {
  const hit = metaCache.get(jid);
  if (!fresh && hit && Date.now() - hit.t < 60_000) return hit.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { meta, t: Date.now() });
  return meta;
}

async function askNumber() {
  if (config.botNumber) return normalizePhone(config.botNumber, config.defaultCountryCode);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const n = normalizePhone(await rl.question('📱 Número do WhatsApp do bot (com indicativo, ex: 258872698781): '), config.defaultCountryCode);
      if (n) return n;
      console.log('Número inválido. Usa apenas dígitos, com indicativo internacional.');
    }
  } finally { rl.close(); }
}

let currentSock = null;
let servicesStarted = false;
const ownerJid = () => `${config.ownerNumber}@s.whatsapp.net`;
const notifyOwner = async text => { try { await currentSock?.sendMessage(ownerJid(), { text }); } catch { /* dono indisponível */ } };

let pairingDone = false;
let generation = 0;
let retry = 0;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
  pairingDone = false;      // cada nova ligação pode precisar de um código novo
  const gen = ++generation;  // ignora temporizadores de ligações antigas
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, auth: state, logger, printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false, syncFullHistory: false
  });

  currentSock = sock;
  sock.ev.on('creds.update', saveCreds);

  const pair = async () => {
    if (gen !== generation || state.creds.registered || pairingDone) return;
    pairingDone = true;
    try {
      const number = await askNumber();
      const code = await sock.requestPairingCode(number);
      console.log(`\n🩸 CÓDIGO DE PAREAMENTO: ${code.match(/.{1,4}/g).join('-')}`);
      console.log('WhatsApp > Aparelhos ligados > Ligar com número de telefone\n');
    } catch (e) { pairingDone = false; log('Falha ao gerar código:', e.message); }
  };
  if (!state.creds.registered) setTimeout(pair, 6000);   // alternativa caso o evento "qr" não chegue

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) await pair();
    if (connection === 'open') {
      retry = 0; log(`✅ ${config.botName} online`);
      if (!servicesStarted) {
        servicesStarted = true;
        scheduler.start(() => currentSock, { notifyOwner });
        if (config.webhookPort) {
          startWebhook({ port: config.webhookPort, onApproved: o => currentSock?.sendMessage(`${o.client}@s.whatsapp.net`,
            { text: formatarMensagem('PAGAMENTO CONFIRMADO', [`ID: ${o.id}`, 'A tua encomenda será processada.'], { gratis: false }) }) });
          log(`Webhook de pagamentos na porta ${config.webhookPort}`);
        }
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log('Sessão terminada. Apaga a pasta "sessao" e inicia de novo.'); process.exit(1);
      }
      const wait = Math.min(30_000, 2000 * 2 ** retry++);
      log(`Ligação fechada (${code ?? '?'}). A reconectar em ${wait / 1000}s...`);
      setTimeout(() => start().catch(e => log('Erro ao reconectar:', e.message)), wait);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try { await handle(sock, m); } catch (e) { log('Erro na mensagem:', e.message); }
    }
  });

  sock.ev.on('group-participants.update', async ev => {
    try { await onParticipants(sock, ev); } catch (e) { log('Erro participantes:', e.message); }
  });
}

async function handle(sock, m) {
  if (!m.message || m.key.fromMe || m.key.remoteJid === 'status@broadcast') return;
  if (seen(m.key.id)) return;
  const jid = m.key.remoteJid;
  const isGroup = jid.endsWith('@g.us');
  const content = unwrap(m.message);
  const text = getText(content).trim();
  const meta = isGroup ? await getMeta(sock, jid) : null;
  const participants = meta?.participants ?? [];

  const rawSender = isGroup ? m.key.participant : jid;
  const alt = m.key.participantAlt || m.key.senderPn || m.key.remoteJidAlt;
  const phone = resolvePhone(rawSender, participants) || (alt ? resolvePhone(alt) : '');
  const me = participants.find(p => participantMatches(p, rawSender, phone));
  const level = getLevel({ phone, isGroupAdmin: !!me?.admin });
  const botIsAdmin = isGroup && isBotAdmin(meta, sock.user);
  if (getSettings().botOff && level !== LEVEL.OWNER) return;   // .bot off

  const reply = (t, opts = {}) => sock.sendMessage(jid, { text: t, ...opts }, { quoted: m });
  const base = {
    sock, m, jid, isGroup, meta, phone, level, botIsAdmin, logger, commands, sender: rawSender, prefix: config.prefix,
    reply, notifyOwner, getMedia: makeGetMedia({ sock, m, jid, logger }),
    send: (title, lines, o = {}) => reply(formatarMensagem(title, lines, o), o.mentions ? { mentions: o.mentions } : {}),
    ok: msg => reply(formatarSucesso(msg)),
    fail: msg => reply(formatarErro(msg))
  };

  // Moderação de grupo (antes de qualquer comando)
  if (isGroup) {
    const cfg = getGroup(jid);
    const reason = moderate(cfg, { text, level, phone });
    if (reason && botIsAdmin) {
      await sock.sendMessage(jid, { delete: m.key }).catch(() => {});
      if (['link', 'concorrencia'].includes(reason) && cfg.autoremover && phone) {
        if (addStrike(cfg, phone) >= 3) {
          delete cfg.strikes[phone];
          await sock.groupParticipantsUpdate(jid, [rawSender], 'remove').catch(() => {});
          await sock.sendMessage(jid, { text: formatarMensagem('AUTO-REMOVER', [`@${toPhone(rawSender)} removido: 3 infracções em 24h.`], { frase: false }), mentions: [rawSender] });
        }
        await saveGroups();
      }
      if (reason === 'link' && warnLimiter.hit(jid + phone)) {
        await sock.sendMessage(jid, { text: formatarMensagem('ANTI-LINK', [`@${toPhone(rawSender)}, links não são permitidos aqui.`], { frase: false }), mentions: [rawSender] });
      }
      return;
    }
    if (cfg.soadmin && level > LEVEL.ADMIN && text.startsWith(config.prefix)) return;
  }

  // Respostas automáticas Nano (sem prefixo)
  if (!text.startsWith(config.prefix)) {
    // Comprovativo automático (só no privado e se o dono activou .auto-comprovativo)
    if (content?.imageMessage && !isGroup && phone && getSettings().autoProof && openOrdersOf(phone).length && limiter.hit('proof' + phone)) {
      try {
        const media = await base.getMedia(['image']);
        await processProof({ ...base, text: '', args: [] }, await ocrImage(media.buffer), null);
      } catch { /* OCR indisponível: o cliente pode usar .verificarsms */ }
      return;
    }
    const r = nanoReply(text) ?? (text ? autoReply(text) && formatarMensagem('SASUKE', autoReply(text).split('\n'), { frase: false }) : null);
    if (r && nanoLimiter.hit(jid)) await sock.sendMessage(jid, { text: r }, { quoted: m });
    return;
  }

  const rest = text.slice(config.prefix.length).trim();
  const sp = rest.search(/\s/);
  const typed = (sp < 0 ? rest : rest.slice(0, sp)).toLowerCase();
  const body = sp < 0 ? '' : rest.slice(sp).trim();
  const cmd = typed && findCommand(typed);
  if (!cmd) return;

  const ctx = { ...base, text: body, args: body.split(/\s+/).filter(Boolean), cmd };

  if (cmd.group && !isGroup) return ctx.fail('Este comando só funciona em grupos.');
  if (!can(level, cmd.level)) return ctx.fail('Sem permissão para este comando.');
  if (cmd.botAdmin && !botIsAdmin) return ctx.fail('Preciso de ser administrador do grupo para isto.');
  if (!limiter.hit(phone || jid)) {
    if (warnLimiter.hit('rl' + (phone || jid))) await ctx.fail('Muitos comandos seguidos. Aguarda uns segundos.');
    return;
  }

  // Reacção (uma vez por comando; falhas não interrompem)
  sock.sendMessage(jid, { react: { text: emojiFor(typed, cmd.name), key: m.key } }).catch(() => {});

  try {
    await cmd.run(ctx);
    if (phone) {
      const u = db('users')[phone] ??= { firstSeen: Date.now(), cmds: 0 };
      u.cmds++; u.lastSeen = Date.now(); u.name = m.pushName || u.name;
      save('users');
    }
  } catch (e) {
    log(`Erro em .${cmd.name}:`, e.message);
    await ctx.fail('Falha ao executar o comando.').catch(() => {});
  }
}

async function onParticipants(sock, { id: gid, participants, action }) {
  const cfg = getGroup(gid);
  const meta = await getMeta(sock, gid, true);
  const botAdmin = isBotAdmin(meta, sock.user);
  const mine = [sock.user?.id, sock.user?.lid].filter(Boolean).map(toPhone);

  for (const p of participants) {
    const jid = typeof p === 'string' ? p : p.id;
    const phone = resolvePhone(jid, meta.participants) || (p.phoneNumber ? toPhone(p.phoneNumber) : '');
    if (mine.includes(toPhone(jid))) continue;
    const tag = `@${toPhone(jid)}`;

    if (action === 'add') {
      if (botAdmin && phone && cfg.banned.includes(phone)) { await sock.groupParticipantsUpdate(gid, [jid], 'remove').catch(() => {}); continue; }
      if (botAdmin && cfg.antiestrangeiros && isForeign(phone)) {
        await sock.groupParticipantsUpdate(gid, [jid], 'remove').catch(() => {});
        await sock.sendMessage(gid, { text: formatarMensagem('ANTI-ESTRANGEIROS', [`${tag} removido: indicativo não permitido.`], { frase: false }), mentions: [jid] });
        continue;
      }
      if (cfg.welcome) {
        const caption = formatarMensagem('BEM-VINDO', [`${tag} entrou em ${meta.subject}.`, 'Lê as regras e respeita o grupo.'], { gratis: false });
        try {
          const url = await sock.profilePictureUrl(jid, 'image');
          await sock.sendMessage(gid, { image: { url }, caption, mentions: [jid] });
        } catch {
          await sock.sendMessage(gid, { text: caption, mentions: [jid] });
        }
      }
    } else if (action === 'remove' && cfg.bye) {
      await sock.sendMessage(gid, { text: formatarMensagem('SAÍDA', [`${tag} saiu do grupo.`], { gratis: false }), mentions: [jid] });
    }
  }
}

process.on('unhandledRejection', e => log('unhandledRejection:', e?.message ?? e));
process.on('uncaughtException', e => log('uncaughtException:', e?.message ?? e));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, async () => { await flush(); process.exit(0); });

start().catch(e => { log('Falha ao iniciar:', e.message); process.exit(1); });
