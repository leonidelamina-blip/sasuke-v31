import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config.js';
import { db, save } from './database.js';
import { getOrder, setState, listOrders } from './orders.js';
import { parseMoney, sameMoney, round2 } from './utils.js';
import { tokenMatches, createRateLimiter } from './security.js';

const run = promisify(execFile);
export const normRef = r => String(r ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ledger = () => { const t = db('transactions'); t.history ??= []; t.received ??= {}; t.refs ??= {}; return t; };

/* ───────── extracção (heurística — NÃO é prova de pagamento) ───────── */
export function parseProofText(text) {
  const t = String(text ?? '').slice(0, 4000);
  let ref = null;
  const labeled = t.match(/(?:confirmad[oa]|refer[eê]ncia|\bref\b\.?|id\s*(?:da\s*)?(?:transa[cç][aã]o)?|transaction\s*id|\btxn\b)[\s:#.\-]*([A-Z0-9]{6,16})\b/i);
  if (labeled && /\d/.test(labeled[1]) && /[A-Za-z]/.test(labeled[1])) ref = normRef(labeled[1]);
  if (!ref) {
    for (const tok of t.match(/\b[A-Z0-9]{8,14}\b/g) ?? []) if (/\d/.test(tok) && /[A-Z]/.test(tok)) { ref = tok; break; }
  }
  let amount = null;
  const lab = t.match(/(?:valor|montante|transferiste|enviaste|pagaste|amount)[^\d]{0,25}(\d[\d.,]*)/i);
  const mt = t.match(/(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:MT|MZN|MTn)\b/i);
  amount = parseMoney(lab?.[1] ?? mt?.[1]);
  let date = null;
  const d = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (d) {
    const [dd, mm] = [Number(d[1]), Number(d[2])], yy = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) date = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return { ref, amount, date };
}

let ocrLang;
async function tesseractLang() {
  if (ocrLang) return ocrLang;
  try { const { stdout } = await run('tesseract', ['--list-langs']); ocrLang = /\bpor\b/.test(stdout) ? 'por+eng' : 'eng'; }
  catch { ocrLang = 'eng'; }
  return ocrLang;
}

/** OCR com o binário `tesseract` (apt install tesseract-ocr tesseract-ocr-por). */
export async function ocrImage(buffer) {
  const sharp = (await import('sharp')).default;
  const base = path.join(config.root, 'temp'); await fsp.mkdir(base, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(base, 'ocr-'));
  try {
    const png = path.join(dir, 'in.png');
    await sharp(buffer, { limitInputPixels: 50e6 }).rotate().grayscale().normalise()
      .resize({ width: 1800 }).sharpen().png().toFile(png);
    const { stdout } = await run('tesseract', [png, 'stdout', '-l', await tesseractLang(), '--psm', '6'], { timeout: 25_000, maxBuffer: 2e6 });
    return stdout;
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('OCR_INDISPONIVEL');
    throw new Error('OCR_FALHOU');
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

/* ───────── registo financeiro independente ───────── */
export function registerReceived({ ref, amount, date = null, sender = null, source = 'manual' }) {
  ref = normRef(ref); amount = round2(amount);
  if (ref.length < 6) throw new Error('Referência inválida (mín. 6 caracteres)');
  if (!(amount > 0)) throw new Error('Valor inválido');
  const l = ledger();
  if (l.received[ref]) throw new Error('Referência já registada');
  return (l.received[ref] = { ref, amount, date, sender, source, ts: Date.now(), usedBy: null });
}
export const findReceived = ref => ledger().received[normRef(ref)] ?? null;

/** Compara o comprovativo com o registo independente. Nunca aprova só por causa de uma imagem. */
export function evaluateProof(order, proof) {
  const l = ledger(), ref = normRef(proof.ref);
  if (!ref) return { status: 'ANALISE', reasons: ['SEM_REFERENCIA'] };
  if (l.refs[ref] && l.refs[ref] !== order.id) return { status: 'BLOQUEADO', reasons: ['REFERENCIA_REUTILIZADA'] };
  const entry = l.received[ref];
  if (!entry) return { status: 'ANALISE', reasons: ['SEM_CONFIRMACAO_INDEPENDENTE'] };
  if (entry.usedBy && entry.usedBy !== order.id) return { status: 'BLOQUEADO', reasons: ['REFERENCIA_REUTILIZADA'] };
  if (!sameMoney(entry.amount, order.value)) return { status: 'ANALISE', reasons: ['VALOR_INCOMPATIVEL'] };
  if (proof.amount != null && !sameMoney(proof.amount, order.value)) return { status: 'ANALISE', reasons: ['VALOR_DO_COMPROVATIVO_DIFERENTE'] };
  return { status: 'APROVAR', reasons: [] };
}

/** Anexa o comprovativo a uma encomenda aberta. Guarda só ref/valor/data (nunca texto de SMS). */
export async function applyProof(orderId, proof, by = 'SISTEMA') {
  const o = getOrder(orderId);
  if (!o) throw new Error('Encomenda não encontrada');
  if (!['PENDENTE', 'EM ANÁLISE'].includes(o.state)) throw new Error(`Encomenda ${o.state}: não aceita comprovativo`);
  const v = evaluateProof(o, proof), l = ledger(), ref = normRef(proof.ref);
  if (v.status === 'BLOQUEADO') return v;
  if (ref) l.refs[ref] = o.id;
  o.proof = { ref: ref || null, amount: proof.amount ?? null, date: proof.date ?? null, at: Date.now(), reasons: v.reasons };
  if (v.status === 'APROVAR') {
    l.received[ref].usedBy = o.id;
    await setState(o.id, 'APROVADO', { by, note: 'Confirmado no registo financeiro' });
  } else if (o.state === 'PENDENTE') {
    await setState(o.id, 'EM ANÁLISE', { by, note: v.reasons.join(',') });
  }
  await Promise.all([save('orders'), save('transactions')]);
  return v;
}

/** Regista um pagamento recebido e aprova encomendas que já aguardavam esta referência. */
export async function registerAndReconcile(payment) {
  const entry = registerReceived(payment);
  const approved = [];
  for (const o of listOrders(x => x.state === 'EM ANÁLISE' && x.proof?.ref === entry.ref)) {
    const v = await applyProof(o.id, { ref: entry.ref, amount: o.proof.amount, date: o.proof.date }).catch(() => null);
    if (v?.status === 'APROVAR') approved.push(getOrder(o.id));
  }
  await save('transactions');
  return { entry, approved };
}

/* ───────── webhook opcional (ex.: app de reencaminhamento de SMS do dono) ───────── */
export function startWebhook({ port, host = '0.0.0.0', onApproved = () => {} }) {
  const limiter = createRateLimiter({ max: 30, windowMs: 60_000 });
  const server = http.createServer((req, res) => {
    const end = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || req.url !== '/pagamento') return end(404, { ok: false });
    if (!limiter.hit('wh')) return end(429, { ok: false });
    if (!tokenMatches(req.headers['x-token'], db('settings').tokenHash)) return end(401, { ok: false });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        const { entry, approved } = await registerAndReconcile({ ref: j.ref, amount: parseMoney(j.amount), date: j.date ?? null, sender: j.sender ?? null, source: 'webhook' });
        for (const o of approved) await Promise.resolve(onApproved(o)).catch(() => {});
        end(200, { ok: true, ref: entry.ref, approved: approved.length });
      } catch (e) { end(400, { ok: false, error: e.message }); }
    });
  });
  server.listen(port, host);
  return server;
}
