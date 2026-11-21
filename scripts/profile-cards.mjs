// Genera 4 tarjetas SVG (tema dark de GitHub) para el README de perfil:
//   wakatime/github-stats.svg · languages.svg · week.svg · editors.svg
// Fuentes:
//   - WakaTime stats PUBLICAS (sin rango en la URL = rango publico del perfil, p.ej. "Last Year")
//   - Shareable JSON de WakaTime "Coding Activity" (rango propio, p.ej. Last 7 Days)
//   - GitHub REST + GraphQL (GITHUB_TOKEN del workflow)
// Sin dependencias (Node 18+). Si una tarjeta falla, conserva su SVG anterior y avisa.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = process.env;
const WAKA_USER = env.WAKATIME_USERNAME;
const GH_LOGIN = env.GITHUB_LOGIN;
const GH_TOKEN = env.GITHUB_TOKEN;
const WEEK_URL = env.WEEK_SHARE_URL;
const GOAL_H = Number(env.YEARLY_GOAL_HOURS ?? 400);
const OUT = env.OUT_DIR ?? 'wakatime';
const RETRIES = Number(env.RETRIES ?? 5);
const RETRY_DELAY_MS = Number(env.RETRY_DELAY_MS ?? 15000);
const TEST = { stats: env.WAKATIME_STATS_FILE, week: env.WEEK_FILE, gh: env.GITHUB_FILE }; // pruebas offline

// ---------- Paleta GitHub dark ----------
const C = { bg: '#0d1117', sub: '#151b23', track: '#21262d', border: '#3d444d', fg: '#f0f6fc', mut: '#9198a1',
  blue: '#4493f8', green: '#3fb950', orange: '#f0883e', purple: '#a371f7' };
const LANG = { 'C#': '#3fb950', TypeScript: '#4493f8', JavaScript: '#f1e05a', JSON: '#8b949e', Markdown: '#a5d6ff',
  SQL: '#e38c00', Binary: '#6e7681', Other: '#768390', CSHTML: '#a371f7', HTML: '#e34c26', CSS: '#d2a8ff',
  Bash: '#89e051', Python: '#79c0ff', 'VB.NET': '#945db7', Prisma: '#39c5cf', YAML: '#cb171e', XML: '#6ea8fe' };
const EXTRA = ['#3fb950', '#f1e05a', '#8b949e', '#d2a8ff'];
const lc = (n) => LANG[n] ?? '#8b949e';
const EDITOR_COLOR = { 'Visual Studio': C.purple, 'VS Code': C.blue, 'Claude Code': C.orange };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const hhmm = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
const hm = (sec) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (m === 60) return `${h + 1} hrs 0 mins`; return h ? `${h} hr${h > 1 ? 's' : ''} ${m} mins` : `${m} mins`; };
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

// ---------- Carga de datos ----------
function parseJsonLike(text) {
  try { return JSON.parse(text); } catch { /* quizas JSONP */ }
  const m = text.trim().match(/^[\w$.]+\(([\s\S]*)\);?$/);
  if (m) return JSON.parse(m[1]);
  throw new Error('Respuesta no es JSON: ' + text.slice(0, 120));
}
async function getJson(url, headers = {}) {
  for (let i = 1; i <= RETRIES; i++) {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'profile-cards', ...headers } });
    if (res.status === 202) { console.log(`202 calculando (intento ${i}/${RETRIES}) ${url}`); await sleep(RETRY_DELAY_MS); continue; }
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}: ${body.slice(0, 200)}`);
    return parseJsonLike(body);
  }
  throw new Error(`202 persistente en ${url}`);
}
async function loadStats() {
  if (TEST.stats) return JSON.parse(readFileSync(TEST.stats, 'utf8')).data;
  if (!WAKA_USER) throw new Error('Falta WAKATIME_USERNAME');
  // Sin rango => rango publico del perfil
  return (await getJson(`https://wakatime.com/api/v1/users/${encodeURIComponent(WAKA_USER)}/stats`)).data;
}
async function loadWeek() {
  if (TEST.week) return JSON.parse(readFileSync(TEST.week, 'utf8')).data;
  if (!WEEK_URL) throw new Error('Falta WEEK_SHARE_URL (Shareable JSON "Coding Activity")');
  return (await getJson(WEEK_URL)).data;
}
async function loadGithub() {
  if (TEST.gh) return JSON.parse(readFileSync(TEST.gh, 'utf8'));
  if (!GH_LOGIN) throw new Error('Falta GITHUB_LOGIN');
  const headers = { Accept: 'application/vnd.github+json', ...(GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {}) };
  const rest = await getJson(`https://api.github.com/users/${encodeURIComponent(GH_LOGIN)}`, headers);
  const out = { followers: rest.followers, repos: rest.public_repos, since: new Date(rest.created_at).getUTCFullYear(), commits: null, prs: null, issues: null };
  if (GH_TOKEN) {
    try {
      const q = `query($l:String!){user(login:$l){contributionsCollection{totalCommitContributions totalPullRequestContributions totalIssueContributions}}}`;
      const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { ...headers, 'User-Agent': 'profile-cards', 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { l: GH_LOGIN } }) });
      const j = await res.json();
      const cc = j?.data?.user?.contributionsCollection;
      if (!res.ok || !cc) throw new Error(JSON.stringify(j?.errors ?? j).slice(0, 200));
      out.commits = cc.totalCommitContributions; out.prs = cc.totalPullRequestContributions; out.issues = cc.totalIssueContributions;
    } catch (e) { console.log(`::warning::GraphQL de GitHub no disponible (commits/PRs/issues se muestran como —): ${e.message}`); }
  }
  return out;
}

// ---------- Piezas SVG ----------
const W = 430, H = 300;
const STYLE = `<style>
 text { font-family: 'Segoe UI', -apple-system, 'Noto Sans', Helvetica, Arial, sans-serif; fill: ${C.fg}; }
 .t { font-size: 14px; font-weight: 600 } .pill { font-size: 9.5px; font-weight: 600; fill: ${C.mut}; letter-spacing: .3px }
 .l { font-size: 12.5px } .v { font-size: 12.5px; font-weight: 600 } .v3 { font-size: 13px; font-weight: 600 }
 .m { font-size: 11.5px; fill: ${C.mut} } .m2 { font-size: 11px; fill: ${C.mut} }
 .axis { font-size: 9.5px; fill: ${C.mut} } .axis2 { font-size: 11px; font-weight: 600 }
 .big { font-size: 20px; font-weight: 700 } .big2 { font-size: 22px; font-weight: 700 }
</style>`;
const pill = (right, text) => { const w = text.length * 6.1 + 18;
  return `<rect x="${right - w}" y="18" width="${w}" height="20" rx="10" fill="none" stroke="${C.border}"/><text x="${right - w / 2}" y="32" text-anchor="middle" class="pill">${esc(text)}</text>`; };
const card = (title, src, inner, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label ?? title)}">
<title>${esc(label ?? title)}</title>${STYLE}
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="6" fill="${C.bg}" stroke="${C.border}"/>
<text x="20" y="33" class="t">${esc(title)}</text>${pill(W - 16, src)}
<line x1="0" x2="${W}" y1="50" y2="50" stroke="${C.border}"/>
${inner}
</svg>
`;
const ic = {
  followers: `<circle cx="6" cy="5" r="2.6"/><path d="M1.5 13.5c0-2.7 2-4.3 4.5-4.3s4.5 1.6 4.5 4.3"/><path d="M10.5 3.2a2.4 2.4 0 0 1 0 4.6M12.2 9.6c1.6.5 2.6 1.8 2.6 3.9"/>`,
  repo: `<path d="M3 2.5h10v11H5.5A2.5 2.5 0 0 1 3 11z"/><path d="M3 11h10"/>`,
  commit: `<circle cx="8" cy="8" r="3"/><path d="M1 8h4M11 8h4"/>`,
  pr: `<circle cx="4" cy="3.5" r="1.7"/><circle cx="4" cy="12.5" r="1.7"/><circle cx="12" cy="12.5" r="1.7"/><path d="M4 5.2v5.6M12 10.8V6a2 2 0 0 0-2-2H8.2M9.6 2.4 8 4l1.6 1.6"/>`,
  issue: `<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1" fill="${C.mut}"/>`,
  cal: `<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>`,
};
const icon = (k, x, y) => `<g transform="translate(${x},${y})" fill="none" stroke="${C.mut}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ic[k]}</g>`;
const ring = (cx, cy, r, sw, p, color = C.blue) => { const L = 2 * Math.PI * r;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.track}" stroke-width="${sw}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(L * p).toFixed(1)} ${L.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`; };

// ---------- Tarjetas ----------
function cardGithub(gh, stats) {
  const rows = [['followers', 'Followers', num(gh.followers)], ['repo', 'Public repos', num(gh.repos)],
    ['commit', 'Commits (last year)', num(gh.commits)], ['pr', 'Pull requests', num(gh.prs)],
    ['issue', 'Issues', num(gh.issues)], ['cal', 'Member since', String(gh.since)]];
  const body = rows.map(([k, l, v], i) => { const y = 76 + i * 33; return `${icon(k, 20, y - 12)}<text x="46" y="${y}" class="l">${l}</text><text x="214" y="${y}" class="v">${v}</text>`; }).join('\n');
  let goal = '';
  const total = stats?.total_seconds;
  if (total) { const p = Math.min(1, total / 3600 / GOAL_H);
    goal = `${ring(344, 150, 46, 10, p)}<text x="344" y="156" text-anchor="middle" class="big">${Math.round(p * 100)}%</text>
<text x="344" y="226" text-anchor="middle" class="m">Yearly coding goal</text><text x="344" y="242" text-anchor="middle" class="m2">${Math.floor(total / 3600)}h / ${GOAL_H}h</text>`; }
  return card('GitHub Stats', 'GITHUB + WAKATIME', body + '\n' + goal, `GitHub stats de ${GH_LOGIN ?? ''}`);
}

function cardLanguages(stats) {
  const all = (stats.languages ?? []).filter((l) => l.total_seconds > 0);
  const top = all.filter((l) => l.name !== 'Other').sort((a, b) => b.total_seconds - a.total_seconds).slice(0, 8);
  if (!top.length) throw new Error('stats.languages vacio (¿"Display languages publicly" activo?)');
  const max = top[0].total_seconds, sumAll = all.reduce((a, l) => a + l.total_seconds, 0);
  const rows = top.map((l, i) => { const y = 66 + i * 25, bw = 196 * (l.total_seconds / max);
    const pct = Number.isFinite(Number(l.percent)) ? Number(l.percent) : l.total_seconds / sumAll * 100;
    return `<text x="20" y="${y + 10}" class="l">${esc(trunc(l.name, 13))}</text><rect x="104" y="${y}" width="196" height="12" rx="6" fill="${C.track}"/><rect x="104" y="${y}" width="${bw.toFixed(1)}" height="12" rx="6" fill="${lc(l.name)}"/><text x="${W - 18}" y="${y + 10}" text-anchor="end" class="m">${hhmm(l.total_seconds)} | ${pct.toFixed(1)}%</text>`; }).join('\n');
  const range = stats.human_readable_range ?? 'selected range';
  const total = stats.human_readable_total ?? hm(sumAll);
  return card(`Top languages · ${range}`, 'WAKATIME', `${rows}\n<text x="${W / 2}" y="${H - 16}" text-anchor="middle" class="m">Total: ${esc(total)}</text>`);
}

function cardWeek(days) {
  const d7 = days.slice(-7).map((d) => ({ date: d.range.date, sec: Number(d.grand_total.total_seconds) || 0 }));
  if (!d7.length) throw new Error('El Shareable no trae dias');
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  d7.forEach((d) => { d.wd = WD[new Date(d.date + 'T12:00:00Z').getUTCDay()]; });
  const maxH = Math.max(...d7.map((d) => d.sec)) / 3600;
  const step = [0.25, 0.5, 1, 2, 4, 8].find((s) => maxH / s <= 4) ?? 8, axisMax = Math.max(step, Math.ceil(maxH / step) * step);
  const cx0 = 52, cw = W - cx0 - 16, top = 74, ch = 112, slot = cw / d7.length, bw = 30;
  let grid = '';
  for (let g = 0; g * step <= axisMax + 1e-9; g++) { const gy = top + ch - (g * step / axisMax) * ch, lab = g === 0 ? '0' : (step < 1 ? `${Math.round(g * step * 60)}m` : `${g * step}h`);
    grid += `<line x1="${cx0}" x2="${W - 16}" y1="${gy}" y2="${gy}" stroke="${C.border}" stroke-dasharray="${g ? '3 4' : ''}"/><text x="${cx0 - 8}" y="${gy + 3}" text-anchor="end" class="axis">${lab}</text>`; }
  const best = d7.reduce((a, b) => (b.sec > a.sec ? b : a));
  const bars = d7.map((d, i) => { const bx = cx0 + slot * i + (slot - bw) / 2, hh = Math.max(d.sec > 0 ? 2 : 0, (d.sec / 3600 / axisMax) * ch);
    return `<rect x="${bx.toFixed(1)}" y="${(top + ch - hh).toFixed(1)}" width="${bw}" height="${hh.toFixed(1)}" rx="3" fill="${d === best ? C.green : C.blue}"/>
<text x="${(bx + bw / 2).toFixed(1)}" y="${(top + ch - hh - 5).toFixed(1)}" text-anchor="middle" class="axis">${hhmm(d.sec)}</text>
<text x="${(bx + bw / 2).toFixed(1)}" y="${top + ch + 16}" text-anchor="middle" class="axis2">${d.wd}</text>`; }).join('\n');
  const total = d7.reduce((a, d) => a + d.sec, 0), avg = total / d7.length;
  return card('This week', 'WAKATIME', `${grid}\n${bars}
<line x1="40" x2="${W - 40}" y1="226" y2="226" stroke="${C.border}"/>
<text x="${W * 0.27}" y="248" text-anchor="middle" class="m2">Best day</text><text x="${W * 0.27}" y="268" text-anchor="middle" class="v3">${best.wd} · ${esc(hm(best.sec))}</text>
<text x="${W * 0.73}" y="248" text-anchor="middle" class="m2">Daily average</text><text x="${W * 0.73}" y="268" text-anchor="middle" class="v3">${esc(hm(avg))}</text>
<text x="${W / 2}" y="${H - 12}" text-anchor="middle" class="m2">Total: ${esc(hm(total))}</text>`, `Coding activity de los ultimos ${d7.length} dias`);
}

function cardEditors(stats) {
  const ed = (stats.editors ?? []).filter((e) => e.percent > 0).sort((a, b) => b.percent - a.percent);
  if (!ed.length) throw new Error('stats.editors vacio (¿"Display editors publicly" activo?)');
  let list = ed.slice(0, 4).map((e, i) => ({ name: e.name, p: Number(e.percent), col: EDITOR_COLOR[e.name] ?? EXTRA[i % EXTRA.length] }));
  const rest = ed.slice(4).reduce((a, e) => a + Number(e.percent), 0); if (rest > 0) list.push({ name: 'Others', p: rest, col: '#6e7681' });
  const sum = list.reduce((a, e) => a + e.p, 0); list = list.map((e) => ({ ...e, p: e.p / sum * 100 }));
  const R = 46, L = 2 * Math.PI * R; let acc = 0;
  const segs = list.map((e) => { const len = Math.max(0, L * e.p / 100 - 2); const s = `<circle cx="104" cy="140" r="${R}" fill="none" stroke="${e.col}" stroke-width="20" stroke-dasharray="${len.toFixed(1)} ${(L - len).toFixed(1)}" stroke-dashoffset="${(-acc).toFixed(1)}" transform="rotate(-90 104 140)"/>`; acc += L * e.p / 100; return s; }).join('');
  const leg = list.map((e, i) => `<circle cx="214" cy="${106 + i * 24}" r="5" fill="${e.col}"/><text x="228" y="${110 + i * 24}" class="l">${esc(trunc(e.name, 16))}</text><text x="${W - 18}" y="${110 + i * 24}" text-anchor="end" class="m">${Math.round(e.p)}%</text>`).join('');
  const os = (stats.operating_systems ?? []).filter((o) => o.percent > 0).sort((a, b) => b.percent - a.percent);
  const osSum = os.reduce((a, o) => a + Number(o.percent), 0) || 1; let ox = 0;
  const osCols = [C.blue, C.green, C.orange, C.purple];
  const osBar = os.slice(0, 4).map((o, i) => { const w = (W - 40) * Number(o.percent) / osSum; const s = `<rect x="${(20 + ox).toFixed(1)}" y="248" width="${w.toFixed(1)}" height="10" fill="${osCols[i]}"/>`; ox += w; return s; }).join('');
  const osLabels = os.slice(0, 2).map((o, i) => `<text x="${i ? W - 20 : 20}" y="276" ${i ? 'text-anchor="end" ' : ''}class="l">${esc(o.name)} <tspan class="m">${Math.round(Number(o.percent) / osSum * 100)}%</tspan></text>`).join('');
  const range = stats.human_readable_range ?? '';
  return card(`Editors & OS · ${range}`, 'WAKATIME', `${segs}<text x="104" y="136" text-anchor="middle" class="big2">${ed.length}</text><text x="104" y="152" text-anchor="middle" class="m2">editors</text>${leg}
<text x="20" y="238" class="m">Operating system</text>
<defs><clipPath id="osclip"><rect x="20" y="248" width="${W - 40}" height="10" rx="5"/></clipPath></defs><g clip-path="url(#osclip)">${osBar}</g>${osLabels}`);
}

// ---------- Main ----------
mkdirSync(OUT, { recursive: true });
const settle = async (p) => { try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; } };
const [stats, week, gh] = await Promise.all([settle(loadStats()), settle(loadWeek()), settle(loadGithub())]);
const jobs = [
  ['github-stats.svg', gh.ok ? () => cardGithub(gh.v, stats.ok ? stats.v : null) : null, gh.e],
  ['languages.svg', stats.ok ? () => cardLanguages(stats.v) : null, stats.e],
  ['week.svg', week.ok ? () => cardWeek(week.v) : null, week.e],
  ['editors.svg', stats.ok ? () => cardEditors(stats.v) : null, stats.e],
];
let okCount = 0;
for (const [file, build, srcErr] of jobs) {
  try {
    if (!build) throw srcErr;
    writeFileSync(`${OUT}/${file}`, build());
    console.log(`OK  ${OUT}/${file}`); okCount++;
  } catch (e) { console.log(`::warning::${file} NO actualizado (se conserva el anterior): ${e.message}`); }
}
if (okCount === 0) { console.error('::error::Ninguna tarjeta se pudo generar'); process.exit(1); }
