/* Exercises the real worker (wrangler dev on 8788) against the contract the
   pages rely on — including the part that matters on air: a Browser Source that
   connects late must be handed the graphic currently up. */
const WebSocket = require(require.resolve('ws', { paths: [require('path').join(__dirname, '..', 'companion-module-jomboy-mlb-standings')] }))
const BASE = 'http://127.0.0.1:8788'
const ROOM = 'jomboy-standings-test'
const wait = (ms) => new Promise(r => setTimeout(r, ms))
let fail = 0
const check = (n, c, x) => { console.log(`${c?'PASS':'FAIL'}  ${n}${c?'':'   got: '+JSON.stringify(x)}`); if(!c) fail++ }
const post = (body) => fetch(`${BASE}/r/${ROOM}`, { method:'POST', body: JSON.stringify(body) })

;(async () => {
  const health = await (await fetch(BASE + '/')).json()
  check('health check identifies the relay', health.service === 'jomboy-relay', health)

  // live subscriber
  const got = []
  const sock = new WebSocket(`ws://127.0.0.1:8788/r/${ROOM}`)
  sock.on('message', (m) => got.push(JSON.parse(m.toString())))
  await new Promise(r => sock.on('open', r))
  await wait(200)

  const r1 = await post({ type:'state', graphic:'alwc', visible:true, seq:1001, label:'AL Wild Card' })
  const j1 = await r1.json()
  check('POST is accepted and reports who it reached', j1.ok === true && j1.sent === 1, j1)
  await wait(300)
  check('the live subscriber was pushed the state',
    got.length === 1 && got[0].graphic === 'alwc' && got[0].visible === true, got)

  // GET returns last state (poll fallback)
  const last = await (await fetch(`${BASE}/r/${ROOM}`, { cache:'no-store' })).json()
  check('GET returns the stored last state', last && last.graphic === 'alwc', last)

  // a late subscriber must be caught up on connect — the OBS-refresh case
  const late = []
  const sock2 = new WebSocket(`ws://127.0.0.1:8788/r/${ROOM}`)
  sock2.on('message', (m) => late.push(JSON.parse(m.toString())))
  await new Promise(r => sock2.on('open', r))
  await wait(400)
  check('a late subscriber is handed the current graphic on connect',
    late.length === 1 && late[0].graphic === 'alwc', late)

  // both subscribers get the next push
  await post({ type:'state', graphic:'nl', visible:true, seq:1002, label:'NL Standings' })
  await wait(300)
  check('both subscribers get the next push',
    got.slice(-1)[0].graphic === 'nl' && late.slice(-1)[0].graphic === 'nl', { got: got.slice(-1), late: late.slice(-1) })

  // rooms are isolated — this is what lets one relay serve every graphic
  const other = []
  const sock3 = new WebSocket(`ws://127.0.0.1:8788/r/some-other-show`)
  sock3.on('message', (m) => other.push(JSON.parse(m.toString())))
  await new Promise(r => sock3.on('open', r))
  await wait(300)
  await post({ type:'state', graphic:'al', visible:false, seq:1003 })
  await wait(300)
  check('a different room hears nothing of ours', other.length === 0, other)

  // clients only listen; inbound is ignored not trusted
  sock.send(JSON.stringify({ type:'state', graphic:'HACKED', visible:true, seq:9999 }))
  await wait(300)
  const after = await (await fetch(`${BASE}/r/${ROOM}`, { cache:'no-store' })).json()
  check('state sent BY a subscriber is ignored, not stored', after.graphic === 'al', after)

  // bad room name falls through to the service banner rather than erroring
  const weird = await (await fetch(`${BASE}/r/not a valid room!`)).json()
  check('an invalid room name returns the banner, not a crash', weird.ok === true, weird)

  ;[sock, sock2, sock3].forEach(s => s.close())
  await wait(200)
  console.log(fail ? `\n${fail} FAILURE(S)` : '\nall relay checks passed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('harness blew up:', e); process.exit(1) })
