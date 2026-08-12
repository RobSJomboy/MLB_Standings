/* The point of the change: an overlay dials into the module and follows along
   with no internet. This drives the real module with a fake control window and a
   fake overlay on one socket server and checks the routing rules:

     - relative actions reach control windows only
     - absolute state reaches everyone else
     - an overlay's own echo is ignored, so it can't talk over the operator
     - with no control window the module resolves and still drives the overlay
     - an overlay that connects late is handed the current picture
*/

const path = require('path')
const MOD = __dirname

let Captured = null
const calls = { logs: [], vars: {}, status: [] }

class InstanceBase {
	updateStatus(s, m) { calls.status.push(m) }
	log(l, m) { calls.logs.push([l, m]) }
	setVariableDefinitions(d) { this.varDefs = d }
	setVariableValues(v) { Object.assign(calls.vars, v) }
	setActionDefinitions(a) { this.actions = a }
	setFeedbackDefinitions(f) { this.feedbacks = f }
	setPresetDefinitions(p) { this.presets = p }
	checkFeedbacks() {}
}

const basePath = require.resolve('@companion-module/base', { paths: [MOD] })
require.cache[basePath] = {
	id: basePath, filename: basePath, loaded: true, children: [], paths: [],
	exports: {
		InstanceBase,
		InstanceStatus: { Ok: 'ok', Connecting: 'connecting', ConnectionFailure: 'fail' },
		combineRgb: (r, g, b) => (r << 16) | (g << 8) | b,
		runEntrypoint: (cls) => { Captured = cls },
	},
}
require(path.join(MOD, 'main.js'))
const WebSocket = require(require.resolve('ws', { paths: [MOD] }))

const PORT = 8131
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '   got: ' + JSON.stringify(extra)}`)
	if (!cond) failures++
}

/* A stand-in page. Records everything the module sends it. */
function page(role) {
	const p = { role, got: [], sock: null }
	return new Promise((resolve) => {
		const s = new WebSocket(`ws://127.0.0.1:${PORT}`)
		p.sock = s
		s.on('message', (raw) => p.got.push(JSON.parse(raw.toString())))
		s.on('open', () => {
			s.send(JSON.stringify({ type: 'hello', role }))
			setTimeout(() => resolve(p), 150)
		})
	})
}
const actions = (p) => p.got.filter((m) => m.type === 'action')
const states = (p) => p.got.filter((m) => m.type === 'state')
const lastState = (p) => states(p).slice(-1)[0]

;(async () => {
	const inst = new Captured()
	await inst.init({ port: PORT, topic: '' })

	/* ---- control window + overlay both dialled in ---- */
	const control = await page('control')
	const overlay = await page('output')
	await wait(150)

	check('module counts one control and one overlay',
		calls.vars.connected === 'yes' && calls.vars.overlays === 1, calls.vars)
	check('status names both', /control window/i.test(calls.status.slice(-1)[0]) && /overlay/i.test(calls.status.slice(-1)[0]),
		calls.status.slice(-1)[0])
	check('feedback: overlay linked', inst.feedbacks.overlay_linked.callback() === true)

	/* ---- a Stream Deck press ---- */
	inst.actions.take.callback({ options: { graphic: 'alwc' } })
	await wait(200)

	check('relative action goes to the control window', actions(control).length === 1 &&
		actions(control)[0].action === 'take' && actions(control)[0].graphic === 'alwc', actions(control))
	check('relative action does NOT go to the overlay', actions(overlay).length === 0, actions(overlay))

	/* ---- control window resolves and reports back ---- */
	control.sock.send(JSON.stringify({
		type: 'state', graphic: 'alwc', visible: true, seq: 1000,
		label: 'AL Wild Card', dataOk: true, ntfy: false,
	}))
	await wait(200)

	check('overlay is told the resolved state', lastState(overlay) &&
		lastState(overlay).graphic === 'alwc' && lastState(overlay).visible === true, states(overlay))
	check('the reporting control window is not echoed its own state',
		states(control).length === 0, states(control))
	check('module mirror tracks it', calls.vars.graphic_id === 'alwc' && calls.vars.on_air === 'yes', calls.vars)

	/* ---- the overlay must not be able to talk over the operator ---- */
	const beforeGraphic = calls.vars.graphic_id
	overlay.sock.send(JSON.stringify({ type: 'state', graphic: 'nl', visible: true, seq: 9999, label: 'NL Standings' }))
	await wait(200)
	check('state pushed BY an overlay is ignored', calls.vars.graphic_id === beforeGraphic, calls.vars.graphic_id)
	check('and is not relayed to the control window', states(control).length === 0, states(control))

	/* ---- an overlay joining late gets caught up ---- */
	const late = await page('output')
	await wait(250)
	check('a late overlay is handed the current picture', lastState(late) &&
		lastState(late).graphic === 'alwc' && lastState(late).visible === true, states(late))

	/* ---- control window closes: module becomes the resolver ---- */
	control.sock.close()
	await wait(300)
	check('module reports overlay-only', calls.vars.connected === 'no' && calls.vars.overlays === 2, calls.vars)
	check('status says overlay only', /overlay only/i.test(calls.status.slice(-1)[0]), calls.status.slice(-1)[0])

	const overlayStatesBefore = states(overlay).length
	inst.actions.take.callback({ options: { graphic: 'nl' } })
	await wait(300)
	check('with no control window the module resolves and drives the overlay',
		states(overlay).length === overlayStatesBefore + 1 &&
		lastState(overlay).graphic === 'nl' && lastState(overlay).visible === true, states(overlay).slice(-2))
	check('no ntfy configured and none needed — nothing logged as an error',
		!calls.logs.some((l) => l[0] === 'error'), calls.logs.filter((l) => l[0] === 'error'))

	// second press on the live graphic clears it, resolved module-side
	inst.actions.take.callback({ options: { graphic: 'nl' } })
	await wait(300)
	check('module-side second press clears it', lastState(overlay).visible === false, lastState(overlay))

	/* ---- a page that never says hello is treated as a control window ---- */
	const silent = await new Promise((resolve) => {
		const s = new WebSocket(`ws://127.0.0.1:${PORT}`)
		const p = { got: [], sock: s }
		s.on('message', (raw) => p.got.push(JSON.parse(raw.toString())))
		s.on('open', () => setTimeout(() => resolve(p), 200))
	})
	await wait(150)
	inst.actions.hide.callback({})
	await wait(200)
	check('a page that never announced itself gets relative actions (safe default)',
		actions(silent).length === 1 && actions(silent)[0].action === 'hide', silent.got)

	overlay.sock.close(); late.sock.close(); silent.sock.close()
	await wait(200)
	await inst.destroy()
	console.log(failures ? `\n${failures} FAILURE(S)` : '\nall routing checks passed')
	process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('harness blew up:', e); process.exit(1) })
