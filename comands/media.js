import * as M from '../plugins/media.js';
import { generateImage, AIError } from '../plugins/ai.js';
import { createRateLimiter } from '../plugins/security.js';
import { getQuotedText } from '../plugins/utils.js';

const MM = 'MULTIMÉDIA';
const aiLimiter = createRateLimiter({ max: 3, windowMs: 60_000 });

/** No máximo 2 conversões pesadas em simultâneo (protege CPU/RAM). */
let active = 0;
async function slot(fn, c) {
  if (active >= 2) return c.fail('Estou ocupado com outras conversões. Tenta daqui a pouco.');
  active++;
  try { return await fn(); } finally { active--; }
}
const explain = e => e.message === 'FFMPEG_INDISPONIVEL' ? 'FFmpeg não está instalado no servidor.' : e instanceof AIError ? e.message : (e.message || 'Falha ao processar.');
const guard = fn => async c => { try { return await slot(() => fn(c), c); } catch (e) { return c.fail(explain(e)); } };
const send = (c, content) => c.sock.sendMessage(c.jid, content, { quoted: c.m });

const effect = (name, desc, fn) => ({ name, cat: MM, level: 4, desc, run: guard(async c => {
  const media = await c.getMedia(['image']);
  if (!media) return c.fail(`Envia uma imagem com a legenda .${name} (ou responde a uma imagem).`);
  return send(c, { image: await fn(media.buffer), caption: `✔ ${name}` });
}) });

const textArg = c => c.text || getQuotedText(c.m.message);

export default [
  { name: 'fig', aliases: ['sticker'], cat: MM, level: 4, desc: 'Imagem/vídeo curto → sticker', run: guard(async c => {
    const media = await c.getMedia(['image', 'video', 'sticker']);
    if (!media) return c.fail('Envia (ou responde a) uma imagem ou vídeo curto com .fig');
    if (media.type === 'sticker') return send(c, { sticker: media.buffer });
    if (media.type === 'video') {
      if (media.seconds > 10) return c.fail('O vídeo deve ter no máximo 10 segundos.');
      return send(c, { sticker: await M.videoToSticker(media.buffer) });
    }
    return send(c, { sticker: await M.toSticker(media.buffer) });
  }) },
  { name: 'toimage', aliases: ['toimg'], cat: MM, level: 4, desc: 'Sticker → imagem', run: guard(async c => {
    const media = await c.getMedia(['sticker']);
    if (!media) return c.fail('Responde a um sticker com .toimage');
    return send(c, { image: await M.stickerToImage(media.buffer) });
  }) },
  { name: 'hd', aliases: ['to-hd'], cat: MM, level: 4, desc: 'Amplia 2× com nitidez (não é IA generativa)', run: guard(async c => {
    const media = await c.getMedia(['image']);
    if (!media) return c.fail('Envia uma imagem com a legenda .hd (ou responde a uma imagem).');
    return send(c, { image: await M.hd(media.buffer), caption: '✔ Ampliada 2× com nitidez (interpolação, não reconstrução por IA).' });
  }) },
  { name: 'ia-fig', cat: MM, level: 4, desc: 'Gera uma imagem por IA e converte em sticker', usage: '.ia-fig gato astronauta', run: guard(async c => {
    if (!c.text) return c.fail('Descreve a imagem. Ex: .ia-fig gato astronauta');
    if (!aiLimiter.hit(c.phone || c.jid)) return c.fail('Limite: 3 imagens por minuto.');
    return send(c, { sticker: await M.toSticker(await generateImage(c.text)) });
  }) },
  { name: 'attp', cat: MM, level: 4, desc: 'Texto colorido animado → sticker', usage: '.attp texto', run: guard(async c => {
    const t = textArg(c); if (!t) return c.fail('Escreve um texto. Ex: .attp Sasuke');
    return send(c, { sticker: await M.attp(t) });
  }) },
  { name: 'ttp', cat: MM, level: 4, desc: 'Texto → sticker', usage: '.ttp texto', run: guard(async c => {
    const t = textArg(c); if (!t) return c.fail('Escreve um texto. Ex: .ttp Olá');
    return send(c, { sticker: await M.ttp(t) });
  }) },
  effect('blur', 'Desfoca a imagem', M.blur),
  effect('pixel', 'Pixeliza a imagem', M.pixel),
  effect('gray', 'Preto e branco', M.gray),
  effect('invert', 'Inverte as cores', M.invert)
];
