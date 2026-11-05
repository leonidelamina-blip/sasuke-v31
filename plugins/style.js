import config from '../config.js';
import { getSettings } from './database.js';

export const CATEGORIAS = [
  'COMPRAS & MEGAS', 'COMANDOS GERAIS', 'MULTIMÉDIA', 'PESQUISA',
  'ADMINISTRAÇÃO DE GRUPOS', 'SEGURANÇA', 'AUTOMAÇÃO', 'SISTEMA DE ALUGUER',
  'ADMINISTRAÇÃO DO FUNDADOR', 'INTELIGÊNCIA ARTIFICIAL'
];

export const frasesFrias = [
  'Quem hesita, perde.',
  'A noite é longa, mas a minha lâmina é maior.',
  'Não preciso de sorte. Preciso de resultados.',
  'O silêncio também é uma resposta.',
  'Quem não evolui, é esquecido.',
  'Poder sem controlo é só barulho.',
  'Não perco tempo com quem não decide.',
  'Os fracos pedem sorte. Os fortes criam-na.',
  'A dor ensina o que o conforto esconde.',
  'Observa primeiro. Age depois.'
];

export const emojiMap = {
  ping: '⚡', menu: '📜', dono: '👑', criador: '👑', owner: '👑', tempo: '🌤️',
  sasuke: '🩸', abre: '🔓', fecha: '🔒', kick: '👢', compra: '💰', comprovativo: '🧾',
  megas: '📦', fig: '🖼️', sticker: '🖼️', todos: '📢', nanoadd: '📊', bemvindo: '👋',
  'anti-link': '🔗', ban: '🔨'
};
export const DEFAULT_EMOJI = '🔥';
/** Emoji do comando escrito; se não existir, o do nome canónico; senão 🔥. */
export const emojiFor = (typed, canonical) => emojiMap[typed] ?? emojiMap[canonical] ?? DEFAULT_EMOJI;

export const gerarFraseAleatoria = () => frasesFrias[Math.floor(Math.random() * frasesFrias.length)];

const LINE = '━'.repeat(32);
const HAS_EMOJI = /^\p{Extended_Pictographic}/u;

function corpo(linhas) {
  const arr = Array.isArray(linhas) ? linhas : [linhas];
  return arr.flatMap(l => String(l).split('\n')).filter(l => l.trim() !== '')
    .map(l => (HAS_EMOJI.test(l) ? `┃ ${l}` : `┃ 🩸 ${l}`));
}

/** Construtor central do template SASUKE. Tudo o que o bot envia passa por aqui. */
export function formatarMensagem(titulo, linhas = [], { frase = true, gratis, emoji = '🩸' } = {}) {
  const free = gratis ?? getSettings().freeMode === true;
  const donoLocal = config.ownerNumber.replace(/^258/, '');
  const out = [LINE, '', `${emoji} ${String(titulo).toUpperCase()}`, ''];
  const body = corpo(linhas);
  if (body.length) out.push(...body, '');
  if (frase) out.push('🩸 FRASE:', `"${gerarFraseAleatoria()}"`, '');
  out.push(LINE, `🩸 ${config.shortName} • ${config.edition}`,
    `┃ 👑 Dono: ${config.ownerName} - ${donoLocal}`,
    `┃ 🩸 Aluguer: wa.me/${config.ownerNumber}`, LINE, '⛩️🩸');
  if (free) out.push('', '🩸 CANAL OFICIAL:', config.channelUrl);
  return out.join('\n');
}

export const sasukeBox = formatarMensagem;
export const sasuke = (texto, opts) => formatarMensagem('SASUKE', [texto], opts);
export const formatarErro = (msg) => formatarMensagem('ERRO', [msg], { emoji: '⛓️' });
export const formatarSucesso = (msg) => formatarMensagem('CONCLUÍDO', [msg], { emoji: '👁️' });
