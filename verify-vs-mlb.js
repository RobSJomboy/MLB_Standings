#!/usr/bin/env node
/*
 * Daily cross-check against MLB's own published bracket.
 *
 *   node verify-vs-mlb.js
 *
 * The graphics compute seeding themselves — the standings feed has no seed
 * field — so the thing worth checking is whether that computation still agrees
 * with what MLB publishes. Two independent claims are compared:
 *
 *   1. the six seeds per league
 *   2. who owns each head-to-head tiebreaker
 *
 * MLB states both on the playoff picture page, which makes it a real second
 * opinion rather than a restatement of the same feed.
 *
 * Note this does NOT reimplement the tiebreakers. It lifts the live functions
 * out of MLB_Standings.html and runs those, so a passing run says something
 * about the code that actually goes to air. Reimplementing would only prove the
 * copy agrees with itself.
 */

const fs = require('fs')
const path = require('path')

const PAGE = 'https://www.mlb.com/news/mlb-playoff-picture-and-bracket-2026'
const SRC = path.join(__dirname, 'MLB_Standings.html')

/* ── lift the real logic out of the page ───────────────────────────────── */
function loadLogic() {
  const html = fs.readFileSync(SRC, 'utf8')
  const slice = (from, to) => {
    const a = html.indexOf(from)
    const b = html.indexOf(to, a)
    if (a < 0 || b < 0) throw new Error(`could not find ${from.slice(0, 40)}… in MLB_Standings.html`)
    return html.slice(a, b)
  }

  const src = [
    slice('const DIVISIONS = {', '\n\n'),
    slice('function wins(tr)', 'function dash('),
    slice('function pctOf(t) {', 'const gamesLeft ='),
    'module.exports = { DIVISIONS, pctOf, buildTiebreakIndex, tiebreak, sortSeeded, setData: (d) => { data = d } };',
  ].join('\n')

  const m = { exports: {} }
  // `data` is module-level in the page; give it the same shape here.
  new Function('module', 'exports', 'let data = null;\n' + src)(m, m.exports)
  return m.exports
}

/* ── MLB's published claims ────────────────────────────────────────────── */
async function fetchMLB() {
  const r = await fetch(PAGE, { signal: AbortSignal.timeout(25000) })
  if (!r.ok) throw new Error('MLB page HTTP ' + r.status)
  const body = (await r.text()).replace(/\\n/g, '\n').replace(/\\"/g, '"')

  const seeds = {}
  for (const [lg, key] of [['AL', 103], ['NL', 104]]) {
    const m = body.match(new RegExp(`\\*\\*${lg} playoff teams:\\*\\*([^\\n]+)`))
    if (m) {
      seeds[key] = m[1]
        .split(',')
        // the list sits inside a JSON string, so trailing quote/brace debris is normal
        .map((s) => s.replace(/\([^)]*\)/g, '').replace(/[*"\\]/g, '').trim())
        .filter(Boolean)
    }
  }

  // "Win tiebreaker vs.: X, Y" / "Lose tiebreaker vs.: Z"
  const owns = []
  const re = /\*\*([A-Z][A-Za-z\- ]+?) \((?:1st|2nd|3rd|4th|5th)[^)]*\)\*\*\s*\n+\*\s+\*\*Win tiebreaker vs\.:\*\*([^\n]*)/g
  let m
  while ((m = re.exec(body))) {
    const team = m[1].trim()
    m[2].split(',').map((s) => s.trim()).filter((s) => s && s !== 'N/A')
      .forEach((loser) => owns.push([team, loser.replace(/\([^)]*\)/g, '').trim()]))
  }
  return { seeds, owns }
}

/* ── the same picture, computed from the feed ──────────────────────────── */
async function computeFromFeed(L) {
  const season = new Date().getFullYear()
  const get = async (u) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error('statsapi HTTP ' + r.status)
    return r.json()
  }

  const [std, sched] = await Promise.all([
    get(`https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${season}` +
        `&standingsTypes=regularSeason&hydrate=team,division`),
    get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=R` +
        `&startDate=${season}-01-01&endDate=${season}-12-31` +
        `&fields=dates,games,teams,away,home,team,id,score,status,abstractGameState`),
  ])

  const results = []
  ;(sched.dates || []).forEach((d) => (d.games || []).forEach((g) => {
    const a = (g.teams || {}).away || {}, h = (g.teams || {}).home || {}
    if (!a.team || !h.team) return
    if ((g.status || {}).abstractGameState === 'Final' &&
        typeof a.score === 'number' && typeof h.score === 'number') {
      results.push([a.team.id, h.team.id, a.score, h.score])
    }
  }))

  const data = { div: std.records, results, tb: null }
  L.setData(data)
  L.buildTiebreakIndex()

  const seeds = {}
  for (const lg of [103, 104]) {
    const all = [], leaders = []
    L.DIVISIONS[lg].forEach((div) => {
      const rec = std.records.find((r) => r.division && r.division.id === div.id)
      if (!rec) return
      const sorted = L.sortSeeded(rec.teamRecords)
      leaders.push(sorted[0])
      sorted.forEach((t) => all.push(t))
    })
    const ids = new Set(leaders.map((t) => t.team.id))
    const rest = L.sortSeeded(all.filter((t) => !ids.has(t.team.id)))
    seeds[lg] = L.sortSeeded(leaders).concat(rest.slice(0, 3))
  }

  const index = new Map()
  std.records.forEach((r) => r.teamRecords.forEach((t) => index.set(t.team.teamName, t)))
  return { seeds, index }
}

/* ── compare ───────────────────────────────────────────────────────────── */
;(async () => {
  const L = loadLogic()
  const [mlb, mine] = await Promise.all([fetchMLB(), computeFromFeed(L)])

  let bad = 0
  const line = (ok, s) => { console.log(`${ok ? 'OK  ' : 'DIFF'}  ${s}`); if (!ok) bad++ }

  console.log('\n── seeds ──')
  for (const [lg, label] of [[103, 'AL'], [104, 'NL']]) {
    const ours = mine.seeds[lg].map((t) => t.team.teamName)
    const theirs = mlb.seeds[lg]
    if (!theirs) { line(false, `${label}: could not read MLB's list (page layout changed?)`); continue }
    ours.forEach((n, i) => line(n === theirs[i], `${label} seed ${i + 1}: ours ${n} / MLB ${theirs[i] || '—'}`))
  }

  console.log('\n── head-to-head tiebreaker ownership ──')
  if (!mlb.owns.length) line(false, "could not read MLB's tiebreaker blocks (page layout changed?)")
  mlb.owns.forEach(([winner, loser]) => {
    const a = mine.index.get(winner), b = mine.index.get(loser)
    if (!a || !b) return line(false, `${winner} over ${loser}: unknown club name`)
    const r = L.tiebreak(a, b)
    // cmp < 0 means `a` is ahead, i.e. a owns it
    line(r.cmp < 0, `${winner} over ${loser}  (ours: ${r.cmp < 0 ? winner : r.cmp > 0 ? loser : 'unresolved'}${r.why ? ' on ' + r.why : ''})`)
  })

  console.log(bad ? `\n${bad} DIFFERENCE(S) — look before trusting the graphic on air.`
                  : '\nEverything agrees with MLB.')
  process.exit(bad ? 1 : 0)
})().catch((e) => { console.error('\nverify failed:', e.message); process.exit(2) })
