import config from '../config.js';
import { db } from './database.js';

export class AIError extends Error {}
export const aiConfigured = () => !!(config.ai.url && config.ai.key && config.ai.model);
export const imageAiConfigured = () => !!(config.ai.imageUrl && config.ai.key && config.ai.imageModel);

const BASE_SYSTEM = 'És o SASUKE, assistente de um bot de WhatsApp. Responde em português de Portugal, de forma directa, curta e útil (máx. 1500 caracteres). Não inventes factos, preços nem dados; se não souberes, diz que não sabes.';

/** Para ajudar clientes: usa APENAS a informação que o dono registou na Nano Database. */
export function storeContext(max = 3000) {
  const entries = Object.entries(db('nano')).map(([k, v]) => `## ${k}\n${v}`).join('\n\n');
  return entries ? `Informação oficial da loja (usa apenas isto para preços e condições; nunca inventes):\n${entries}`.slice(0, max) : '';
}

async function post(url, body, fetchImpl, timeoutMs) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.key}` }, body: JSON.stringify(body) });
  } catch { throw new AIError('Serviço de IA indisponível. Tenta mais tarde.'); }
  if (res.status === 401 || res.status === 403) throw new AIError('Chave da API de IA inválida.');
  if (res.status === 429) throw new AIError('Limite da API de IA atingido. Tenta mais tarde.');
  if (!res.ok) throw new AIError(`Serviço de IA devolveu erro ${res.status}.`);
  try { return await res.json(); } catch { throw new AIError('Resposta inválida do serviço de IA.'); }
}

/** API compatível com "chat completions" (OpenAI e vários fornecedores). */
export async function ask(prompt, { context = '', withStore = false, fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  if (!aiConfigured()) throw new AIError('IA não configurada. O dono tem de definir AI_API_URL, AI_API_KEY e AI_MODEL.');
  const system = [BASE_SYSTEM, withStore ? storeContext() : ''].filter(Boolean).join('\n\n');
  const user = context ? `Contexto:\n${context.slice(0, 4000)}\n\nPedido: ${prompt}` : prompt;
  const j = await post(config.ai.url, { model: config.ai.model, temperature: 0.4, max_tokens: 800,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user.slice(0, 6000) }] }, fetchImpl, timeoutMs);
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AIError('A IA não devolveu resposta.');
  return text.trim().slice(0, 3500);
}

/** Geração de imagem (formato OpenAI "images", resposta b64_json). */
export async function generateImage(prompt, { fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  if (!imageAiConfigured()) throw new AIError('Geração de imagem não configurada (AI_IMAGE_URL, AI_IMAGE_MODEL, AI_API_KEY).');
  const j = await post(config.ai.imageUrl, { model: config.ai.imageModel, prompt: prompt.slice(0, 1000), n: 1, size: '512x512', response_format: 'b64_json' }, fetchImpl, timeoutMs);
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new AIError('O serviço de imagem não devolveu uma imagem.');
  return Buffer.from(b64, 'base64');
}
