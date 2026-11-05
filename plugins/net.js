import dns from 'node:dns/promises';
import net from 'node:net';
import { isPrivateIp, isSafeUrl } from './security.js';

const defaultResolve = async host => (await dns.lookup(host, { all: true })).map(r => r.address);

async function assertPublic(urlStr, resolve) {
  if (!isSafeUrl(urlStr)) throw new Error('URL não permitida');
  const host = new URL(urlStr).hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : await resolve(host);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('Destino privado ou inválido');
}

/**
 * Obtém conteúdo remoto com protecções anti-SSRF: valida URL e IPs (também a cada redirecionamento),
 * limita redirecionamentos, tempo e tamanho. Nota: não elimina por completo o risco de DNS rebinding
 * entre a validação e a ligação — por isso o conteúdo nunca é executado nem reenviado em bruto.
 */
export async function safeFetch(url, { fetchImpl = fetch, resolve = defaultResolve, maxBytes = 1_000_000, timeoutMs = 8000, maxRedirects = 3 } = {}) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublic(current, resolve);
    const res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'SasukeBot/1.0' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).href; continue; }
    const chunks = []; let size = 0, truncated = false;
    if (res.body) {
      for await (const ch of res.body) {
        size += ch.length;
        if (size > maxBytes) { chunks.push(ch.subarray(0, ch.length - (size - maxBytes))); truncated = true; break; }
        chunks.push(ch);
      }
    }
    return { status: res.status, url: current, contentType: res.headers.get('content-type') || '', body: Buffer.concat(chunks).toString('utf8'), truncated };
  }
  throw new Error('Demasiados redirecionamentos');
}

export function parseMeta(html) {
  const pick = re => html.match(re)?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 300);
  const decode = s => s?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return {
    title: decode(pick(/<title[^>]*>([\s\S]*?)<\/title>/i)),
    description: decode(pick(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']*)["']/i)
      ?? pick(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:og:)?description["']/i)),
    image: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i)
  };
}
