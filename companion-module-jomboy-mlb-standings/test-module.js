/* Drives the Companion module for real: stubs @companion-module/base, boots the
   instance, dials in a WebSocket client the way the control window does, and
   checks the action/state protocol plus the no-control-window ntfy fallback. */

const path = require('path')
const MOD = __dirname

let Captured = null
const calls = { status: [], logs: [], vars: {}, feedbackChecks: 0 }

class InstanceBase {
	updateStatus(s, m) { calls.status.push([s, m]) }
	log(l, m) { calls.logs.push([l, m]) }
	setVariableDefinitions(d) { this.varDefs = d }
	setVariableValues(v) { Object.assign(calls.vars, v) }
	setActionDefinitions(a) { this.actions = a }
	setFeedbackDefinitions(f) { this.feedbacks = f }
	setPresetDefinitions(p) { this.presets = p }
	checkFeedbacks() { calls.feedbackChecks++ }
}

const fake = {
	InstanceBase,
	InstanceStatus: { Ok: 'ok', Connecting: 'connecting', ConnectionFailure: 'fail' },
	combineRgb: (r, g, b) => (r << 16) | (g << 8) | b,
	runEntrypoint: (cls) => { Captured = cls },
}

const basePath = require.resolve('@companion-module/base', { paths: [MOD] })
require.cache[basePath] = { id: basePath, filename: basePath, loaded: true, exports: fake, children: [], paths: [] }

require(path.join(MOD, 'main.js'))

const WebSocket = require(require.resolve('ws', { paths: [MOD] }))

const PORT = 8123
const TOPIC = 'jomboy-modtest-' + Math.random().toString(36).slice(2, 8)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, cond, extra) {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '   ' + JSON.stringify(extra)}`)
	if (!cond) failures++
}

;(async () => {
	const inst = new Captured()
	await inst.init({ port: PORT, topic: '' })

	check('action definitions exist', Object.keys(inst.actions).length === 7, Object.keys(inst.actions))
	check('feedback definitions exist', Object.keys(inst.feedbacks).length === 5, Object.keys(inst.feedbacks))
	check('presets include one per graphic + extras', Object.keys(inst.presets).length === 4 + 4 + 4, Object.keys(inst.presets).length)
	check('starts OFF AIR', calls.vars.status === 'OFF AIR', calls.vars)

	/* ---- the control window dials in ---- */
	const client = new WebSocket(`ws://127.0.0.1:${PORT}`)
	const received = []
	client.on('message', (raw) => received.push(JSON.parse(raw.toString())))
	await new Promise((r) => client.on('open', r))
	client.send(JSON.stringify({ type: 'hello', role: 'control' }))
	await wait(150)

	check('module reports the control window connected', calls.vars.connected === 'yes', calls.vars.connected)

	/* ---- Companion presses "take AL Wild Card" ---- */
	inst.actions.take.callback({ options: { graphic: 'alwc' } })
	await wait(120)
	const acts = received.filter((m) => m.type === 'action')
	check('take is sent down as a relative action', acts.length === 1 &&
		acts[0].action === 'take' && acts[0].graphic === 'alwc', received)
	check('control window is also told the overlay count',
		received.some((m) => m.type === 'links' && m.overlays === 0), received)

	/* ---- the page echoes its resolved state back up ---- */
	client.send(JSON.stringify({
		type: 'state', graphic: 'alwc', visible: true, seq: Date.now(),
		label: 'AL Wild Card', updated: new Date().toISOString(), dataOk: true, ntfy: true,
	}))
	await wait(120)
	check('state push updates variables', calls.vars.graphic === 'AL Wild Card' && calls.vars.on_air === 'yes', calls.vars)
	check('relay variable reflects the page', calls.vars.relay === 'yes', calls.vars.relay)
	check('feedback: that graphic is on air',
		inst.feedbacks.graphic_on_air.callback({ options: { graphic: 'alwc' } }) === true)
	check('feedback: a different graphic is not on air',
		inst.feedbacks.graphic_on_air.callback({ options: { graphic: 'al' } }) === false)
	check('feedback: something is on air', inst.feedbacks.on_air.callback() === true)
	check('feedback: data ok means no warning', inst.feedbacks.data_ok.callback() === false)

	/* ---- resolve() is what the fallback path relies on ---- */
	check('resolve: second press on the live graphic clears it',
		JSON.stringify(inst.resolve('take', { graphic: 'alwc' })) === JSON.stringify({ graphic: 'alwc', visible: false }),
		inst.resolve('take', { graphic: 'alwc' }))
	check('resolve: taking a different graphic swaps to it',
		JSON.stringify(inst.resolve('take', { graphic: 'nl' })) === JSON.stringify({ graphic: 'nl', visible: true }))
	check('resolve: show never clears',
		JSON.stringify(inst.resolve('show', { graphic: 'alwc' })) === JSON.stringify({ graphic: 'alwc', visible: true }))
	// state.graphic is 'alwc' (index 2), so next is 'nlwc' (index 3)
	check('resolve: next steps forward',
		JSON.stringify(inst.resolve('next', {})) === JSON.stringify({ graphic: 'nlwc', visible: true }),
		inst.resolve('next', {}))
	check('resolve: prev steps back',
		JSON.stringify(inst.resolve('prev', {})) === JSON.stringify({ graphic: 'nl', visible: true }),
		inst.resolve('prev', {}))
	check('resolve: hide keeps the graphic but drops it off air',
		JSON.stringify(inst.resolve('hide', {})) === JSON.stringify({ graphic: 'alwc', visible: false }))

	const savedGraphic = inst.state.graphic
	inst.state.graphic = 'nlwc'
	check('resolve: next wraps off the end back to the first',
		JSON.stringify(inst.resolve('next', {})) === JSON.stringify({ graphic: 'al', visible: true }),
		inst.resolve('next', {}))
	inst.state.graphic = null
	check('resolve: next from nothing starts at the first graphic',
		JSON.stringify(inst.resolve('next', {})) === JSON.stringify({ graphic: 'al', visible: true }))
	check('resolve: prev from nothing starts at the last graphic',
		JSON.stringify(inst.resolve('prev', {})) === JSON.stringify({ graphic: 'nlwc', visible: true }))
	inst.state.graphic = savedGraphic

	/* ---- control window closes; the ntfy fallback takes over ---- */
	client.close()
	await wait(250)
	check('module notices the window went away', calls.vars.connected === 'no', calls.vars.connected)
	check('feedback: control window no longer connected', inst.feedbacks.connected.callback() === false)

	const warnsBefore = calls.logs.filter((l) => l[0] === 'warn').length
	inst.actions.take.callback({ options: { graphic: 'al' } })
	await wait(200)
	check('with no window and no topic it warns instead of failing silently',
		calls.logs.filter((l) => l[0] === 'warn').length === warnsBefore + 1,
		calls.logs.slice(-2))

	inst.config.topic = TOPIC
	inst.actions.take.callback({ options: { graphic: 'nlwc' } })
	await wait(3000)
	check('fallback resolves and mirrors locally even with the relay unreachable',
		calls.vars.graphic_id === 'nlwc' && calls.vars.on_air === 'yes', calls.vars)

	// The relay leg can only be checked when ntfy.sh is actually reachable.
	try {
		const resp = await fetch(`https://ntfy.sh/${TOPIC}/json?poll=1&since=10m`, { signal: AbortSignal.timeout(8000) })
		const text = await resp.text()
		const msgs = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
			.filter((m) => !m.event || m.event === 'message')
			.map((m) => { try { return JSON.parse(m.message) } catch (e) { return null } })
			.filter(Boolean)
		check('the overlay would see absolute state on the topic',
			msgs.length === 1 && msgs[0].type === 'state' && msgs[0].graphic === 'nlwc' &&
			msgs[0].visible === true && typeof msgs[0].seq === 'number', msgs)
	} catch (e) {
		console.log(`SKIP  relay leg — ntfy.sh unreachable (${e.message})`)
	}

	await inst.destroy()
	console.log(failures ? `\n${failures} FAILURE(S)` : '\nall module checks passed')
	process.exit(failures ? 1 : 0)
})().catch((e) => { console.error('harness blew up:', e); process.exit(1) })
