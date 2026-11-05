import config from '../config.js';
import { CATEGORIAS } from '../plugins/style.js';
import { can, LEVEL_NAME } from '../plugins/security.js';
import { calc, describeWeather, fmtUptime, normalizeText, toNum } from '../plugins/utils.js';
import { db } from '../plugins/database.js';

const G = 'COMANDOS GERAIS';

/** Comandos visíveis para um nível de acesso. */
export const visibleFor = (commands, level) => commands.filter(c => !c.hidden && can(level, c.level));

function menu(c) {
  const vis = visibleFor(c.commands, c.level);
  const cats = CATEGORIAS.map(n => ({ n, list: vis.filter(x => x.cat === n) })).filter(x => x.list.length);
  const p = c.prefix;
  const arg = normalizeText(c.text || '');

  if (!arg) {
    const lines = [`Prefixo: ${p}  |  Comandos: ${vis.length}`, `Acesso: ${LEVEL_NAME[c.level]}`,
      ...cats.map((x, i) => `${i + 1}. ${x.n} (${x.list.length})`),
      `Usa ${p}menu <número> ou ${p}menu tudo`];
    return c.send('MENU PRINCIPAL', lines);
  }
  const show = arg === 'tudo' ? cats
    : cats.filter((x, i) => String(i + 1) === arg || normalizeText(x.n).includes(arg));
  if (!show.length) return c.fail(`Categoria não encontrada. Usa ${p}menu para ver a lista.`);
  const lines = show.flatMap(x => ['', `【 ${x.n} 】`, ...x.list.map(k => `${p}${k.name} — ${k.desc}`)]);
  return c.send(show.length === 1 ? show[0].n : 'TODOS OS COMANDOS', lines, { frase: false });
}

async function tempo(c) {
  const city = c.text || 'Maputo';
  if (city.length > 60) return c.fail('Nome de cidade demasiado longo.');
  try {
    const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt`,
      { signal: AbortSignal.timeout(8000) })).json();
    const g = geo.results?.[0];
    if (!g) return c.fail(`Cidade "${city}" não encontrada.`);
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`,
      { signal: AbortSignal.timeout(8000) })).json();
    const cur = w.current;
    return c.send('TEMPO', [`🌍 ${g.name}, ${g.country ?? ''}`.trim(), `🌡️ ${cur.temperature_2m} °C — ${describeWeather(cur.weather_code)}`,
      `💧 Humidade: ${cur.relative_humidity_2m}%`, `💨 Vento: ${cur.wind_speed_10m} km/h`, 'Fonte: Open-Meteo']);
  } catch {
    return c.fail('Serviço de meteorologia indisponível. Tenta mais tarde.');
  }
}

export default [
  { name: 'menu', aliases: ['menu-interativo', 'v7', 'imenu', 'ajuda'], cat: G, level: 4,
    desc: 'Lista os comandos disponíveis para ti', run: menu },
  { name: 'ping', cat: G, level: 4, desc: 'Latência e tempo activo', run: c => {
    const lat = Math.max(0, Date.now() - toNum(c.m.messageTimestamp) * 1000);
    return c.send('PING', [`Latência: ${lat} ms`, `Activo há: ${fmtUptime(process.uptime())}`]);
  } },
  { name: 'perfil', cat: G, level: 4, desc: 'O teu perfil e nível de acesso', run: c => {
    const u = db('users')[c.phone] || {};
    return c.send('PERFIL', [`Número: ${c.phone ? '+' + c.phone : 'desconhecido'}`, `Nível: ${LEVEL_NAME[c.level]}`,
      `Comandos usados: ${u.cmds ?? 0}`, u.firstSeen ? `Primeiro contacto: ${new Date(u.firstSeen).toLocaleDateString('pt-PT', { timeZone: config.timezone })}` : 'Primeiro contacto: agora']);
  } },
  { name: 'sasuke', cat: G, level: 4, desc: 'Estado do sistema', run: c =>
    c.send('MANGEKYŌ SHARINGAN', ['👁️ Sistema activo', `Activo há: ${fmtUptime(process.uptime())}`, `Comandos carregados: ${c.commands.length}`, `Versão: ${config.shortName}`]) },
  { name: 'tempo', cat: 'PESQUISA', level: 4, desc: 'Meteorologia (padrão: Maputo)', usage: '.tempo [cidade]', run: tempo },
  { name: 'calcula', cat: 'PESQUISA', level: 4, desc: 'Calculadora', usage: '.calcula (2+3)*4', run: c => {
    if (!c.text) return c.fail('Ex: .calcula (2+3)*4');
    try { return c.send('CÁLCULO', [`${c.text} = ${calc(c.text)}`], { frase: false }); }
    catch (e) { return c.fail(e.message); }
  } },
];
