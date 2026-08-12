const { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } = require('@companion-module/base')
const { WebSocketServer } = require('ws')

/*
 * The pages are browsers, and a browser can only ever be a WebSocket *client*.
 * So this module runs the server and the pages dial in. Two kinds do:
 *
 *   role 'control' — the operator window
 *   role 'output'  — the OBS overlay
 *
 * Each announces itself with {type:'hello', role}. That distinction is the whole
 * design, because the two get different traffic:
 *
 *   Relative actions ('toggle', 'next', a second press meaning clear) go ONLY to
 *   control windows. Absolute state ({graphic, visible, seq}) is broadcast to
 *   everyone. If overlays resolved relative actions themselves they would each
 *   compute their own answer and drift apart from the operator window — which is
 *   exactly what absolute-state-on-the-wire exists to prevent.
 *
 * So there is always exactly one resolver: the control window when one is
 * connected, otherwise this module. Its answer is then broadcast as state.
 *
 * An overlay connected here needs no internet at all. ntfy stays as the fallback
 * for an OBS running on a different machine, and for reaching an overlay when
 * this module isn't running.
 */

const GRAPHICS = [
	{ id: 'al', label: 'AL Standings' },
	{ id: 'nl', label: 'NL Standings' },
	{ id: 'alwc', label: 'AL Wild Card' },
	{ id: 'nlwc', label: 'NL Wild Card' },
]
const ORDER = GRAPHICS.map((g) => g.id)
const labelFor = (id) => (GRAPHICS.find((g) => g.id === id) || {}).label || ''

const EMPTY = {
	graphic: null,
	visible: false,
	seq: 0,
	label: '',
	updated: '',
	dataOk: false,
	ntfy: false,
}

class MLBStandingsInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.clients = new Set() // every dialled-in page; ws.role says which kind
		this.state = { ...EMPTY }

		this.initActions()
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()
		this.startServer()
	}

	async destroy() {
		this.stopServer()
	}

	async configUpdated(config) {
		const portChanged = this.config?.port !== config.port
		this.config = config
		if (portChanged) {
			this.stopServer()
			this.startServer()
		}
		this.pushVariables()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'How this connects',
				value:
					'This module listens on a port. Open <code>MLB_Standings.html</code>, and under ' +
					'<b>Stream Deck — Bitfocus Companion</b> enter <code>ws://127.0.0.1:&lt;port&gt;</code> ' +
					'and hit Connect. If the page runs on another machine, use this machine\'s IP ' +
					'instead of 127.0.0.1.',
			},
			{
				type: 'number',
				id: 'port',
				label: 'Listen port',
				width: 6,
				default: 8100,
				min: 1024,
				max: 65535,
			},
			{
				type: 'static-text',
				id: 'ntfyinfo',
				width: 12,
				label: 'ntfy topic (optional fallback)',
				value:
					'An OBS overlay on <b>this</b> machine should dial straight into this module — add ' +
					'<code>&amp;ws=127.0.0.1:&lt;port&gt;</code> to its Browser Source URL and it needs no ' +
					'internet at all. This topic is only the fallback: for an OBS on a <i>different</i> ' +
					'machine, or for reaching an overlay while this module is not running. ' +
					'ntfy.sh is a free public relay and does go down, so prefer the socket.',
			},
			{
				type: 'textinput',
				id: 'topic',
				label: 'ntfy topic',
				width: 12,
				default: '',
			},
		]
	}

	/* ---------------------------------------------------------------- *
	 * socket
	 * ---------------------------------------------------------------- */
	startServer() {
		const port = Number(this.config?.port) || 8100
		try {
			this.wss = new WebSocketServer({ port })
		} catch (e) {
			this.updateStatus(InstanceStatus.ConnectionFailure, `Could not listen on ${port}`)
			return
		}

		this.updateStatus(InstanceStatus.Connecting, `Listening on ${port} — waiting for a page to dial in`)

		this.wss.on('connection', (ws) => {
			// A page that never says hello is assumed to be a control window —
			// that is the safe default, since the alternative would feed relative
			// actions to something that must not resolve them.
			ws.role = 'control'
			this.clients.add(ws)
			this.reportLinks()

			ws.on('message', (raw) => {
				let msg
				try {
					msg = JSON.parse(raw.toString())
				} catch (e) {
					return
				}
				if (!msg) return

				if (msg.type === 'hello') {
					ws.role = msg.role === 'output' ? 'output' : 'control'
					this.log('info', `MLB Standings ${ws.role} connected`)
					this.reportLinks()
					// Hand a page that has just loaded the current picture, so an
					// overlay opened mid-show comes up on the right graphic without
					// waiting for the next press. This is what the ntfy catch-up
					// read does remotely; over the socket it is immediate.
					if (this.state.graphic || this.state.visible) this.sendState(ws, this.state)
					return
				}

				// Only a resolver's state is authoritative. An overlay echoes state
				// back after applying it; taking that as truth would let it talk
				// over the operator window.
				if (msg.type === 'state' && ws.role === 'control') {
					this.applyState(msg)
					this.broadcastState(ws) // everyone else, including the overlays
				}
			})

			ws.on('close', () => {
				this.clients.delete(ws)
				this.reportLinks()
			})

			ws.on('error', () => {})
		})

		this.wss.on('error', (err) => {
			this.updateStatus(
				InstanceStatus.ConnectionFailure,
				err.code === 'EADDRINUSE' ? `Port ${port} is already in use` : String(err.message || err)
			)
		})
	}

	stopServer() {
		for (const ws of this.clients) {
			try {
				ws.close()
			} catch (e) {}
		}
		this.clients.clear()
		try {
			if (this.wss) this.wss.close()
		} catch (e) {}
		this.wss = null
	}

	/* ---------------------------------------------------------------- *
	 * who is connected
	 * ---------------------------------------------------------------- */
	live(role) {
		return [...this.clients].filter((ws) => ws.readyState === 1 && (!role || ws.role === role))
	}

	reportLinks() {
		const controls = this.live('control').length
		const outputs = this.live('output').length

		if (!controls && !outputs) {
			this.updateStatus(InstanceStatus.Connecting, 'Nothing connected — waiting')
		} else if (!controls) {
			// Usable: this module resolves the actions itself and drives the overlay.
			this.updateStatus(InstanceStatus.Ok, `Overlay only (${outputs}) — no control window`)
		} else {
			this.updateStatus(
				InstanceStatus.Ok,
				`Control window connected${outputs ? ` · ${outputs} overlay${outputs > 1 ? 's' : ''}` : ''}`
			)
		}

		this.pushVariables()
		this.checkFeedbacks()
		this.broadcastLinks(outputs)
	}

	applyState(msg) {
		this.state = { ...EMPTY, ...msg }
		this.pushVariables()
		this.checkFeedbacks()
	}

	/* Tell the control windows how many overlays are on this socket, so they stop
	   crying "OBS not syncing" over a dead ntfy relay that nothing needs.
	   Deliberately not part of the state message: this must never be able to move
	   what is on screen. */
	broadcastLinks(outputs) {
		const msg = JSON.stringify({ type: 'links', overlays: outputs })
		for (const ws of this.live('control')) {
			try {
				ws.send(msg)
			} catch (e) {}
		}
	}

	/* ---------------------------------------------------------------- *
	 * sending

	 * With the control window up it is the authority: send the relative action
	 * and let it work out and echo back the result. Without it, resolve the
	 * action here and put the answer on the ntfy topic ourselves.
	 * ---------------------------------------------------------------- */
	send(action, extra = {}) {
		const controls = this.live('control')

		// A control window is the resolver. Hand it the relative action and let it
		// tell us what that worked out to; its state push is what reaches the
		// overlays, so we deliberately do not resolve it here as well.
		if (controls.length) {
			const msg = JSON.stringify({ type: 'action', action, ...extra })
			for (const ws of controls) {
				try {
					ws.send(msg)
				} catch (e) {
					this.log('error', `Send failed: ${e.message}`)
				}
			}
			return
		}

		// No control window: this module is the resolver.
		const outputs = this.live('output')
		if (outputs.length || this.config?.topic) {
			this.resolveAndBroadcast(action, extra)
			return
		}

		this.log(
			'warn',
			'Nothing connected — open MLB_Standings.html and connect it, point the ' +
				'overlay at this module, or set an ntfy topic in this instance\'s config.'
		)
	}

	sendState(ws, state) {
		try {
			ws.send(
				JSON.stringify({
					type: 'state',
					graphic: state.graphic,
					visible: state.visible,
					seq: state.seq,
					label: state.label || labelFor(state.graphic),
				})
			)
		} catch (e) {}
	}

	/* Push the current picture to every client except the one that reported it. */
	broadcastState(except) {
		for (const ws of this.live()) {
			if (ws !== except) this.sendState(ws, this.state)
		}
	}

	resolve(action, extra) {
		const s = this.state
		switch (action) {
			case 'take':
				if (!extra.graphic) return null
				// a second press on the graphic already up clears it
				if (s.visible && s.graphic === extra.graphic) return { graphic: s.graphic, visible: false }
				return { graphic: extra.graphic, visible: true }
			case 'show':
				return extra.graphic ? { graphic: extra.graphic, visible: true } : null
			case 'hide':
				return { graphic: s.graphic, visible: false }
			case 'toggle':
				if (extra.graphic) return this.resolve('take', extra)
				return s.visible ? { graphic: s.graphic, visible: false } : { graphic: s.graphic || ORDER[0], visible: true }
			case 'next':
			case 'prev': {
				const dir = action === 'next' ? 1 : -1
				const at = ORDER.indexOf(s.graphic)
				const idx = at < 0 ? (dir > 0 ? 0 : ORDER.length - 1) : (at + dir + ORDER.length) % ORDER.length
				return { graphic: ORDER[idx], visible: true }
			}
			default:
				return null // 'refresh' only means anything to the page
		}
	}

	/* With no control window this module resolves the action, then gets the answer
	   out by whatever routes exist. The socket is tried first and on its own is
	   enough — that is the point of letting overlays dial in, and it keeps working
	   when ntfy.sh is unreachable. */
	async resolveAndBroadcast(action, extra) {
		const next = this.resolve(action, extra)
		if (!next) return

		this.applyState({
			...next,
			seq: Date.now(),
			label: labelFor(next.graphic),
			dataOk: this.state.dataOk,
			updated: this.state.updated,
		})
		this.broadcastState()

		if (!this.config?.topic) return

		// Only worth the round trip for an overlay that isn't on this socket.
		try {
			const resp = await fetch(`https://ntfy.sh/${encodeURIComponent(this.config.topic)}`, {
				method: 'POST',
				body: JSON.stringify({
					type: 'state',
					graphic: this.state.graphic,
					visible: this.state.visible,
					seq: this.state.seq,
					label: this.state.label,
					from: 'companion',
				}),
			})
			if (!resp.ok) throw new Error('HTTP ' + resp.status)
		} catch (e) {
			// Not fatal when an overlay is already on the socket, so keep it quiet.
			const via = this.live('output').length ? 'info' : 'error'
			this.log(via, `ntfy publish failed (${e.message})`)
		}
	}

	/* ---------------------------------------------------------------- *
	 * variables
	 * ---------------------------------------------------------------- */
	initVariables() {
		this.setVariableDefinitions([
			{ variableId: 'graphic', name: 'Graphic on air (or last one shown)' },
			{ variableId: 'graphic_id', name: 'Graphic id (al / nl / alwc / nlwc)' },
			{ variableId: 'on_air', name: 'Something is on air' },
			{ variableId: 'status', name: 'One-line status for a button' },
			{ variableId: 'data_updated', name: 'When the standings data last refreshed' },
			{ variableId: 'connected', name: 'Control window is connected' },
			{ variableId: 'overlays', name: 'OBS overlays dialled into this module' },
			{ variableId: 'relay', name: 'Control window is relaying to OBS over ntfy' },
		])
		this.pushVariables()
	}

	pushVariables() {
		const s = this.state
		const label = s.label || labelFor(s.graphic)
		let updated = '—'
		if (s.updated) {
			const d = new Date(s.updated)
			if (!isNaN(d)) updated = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
		}

		this.setVariableValues({
			graphic: label || '—',
			graphic_id: s.graphic || '—',
			on_air: s.visible ? 'yes' : 'no',
			status: s.visible && label ? label : 'OFF AIR',
			data_updated: updated,
			connected: this.live('control').length ? 'yes' : 'no',
			overlays: this.live('output').length,
			relay: s.ntfy ? 'yes' : 'no',
		})
	}

	/* ---------------------------------------------------------------- *
	 * actions
	 * ---------------------------------------------------------------- */
	initActions() {
		const graphicOption = {
			type: 'dropdown',
			label: 'Graphic',
			id: 'graphic',
			default: 'al',
			choices: GRAPHICS.map((g) => ({ id: g.id, label: g.label })),
		}

		this.setActionDefinitions({
			take: {
				name: 'Take a graphic to air (press again to clear it)',
				options: [graphicOption],
				callback: (a) => this.send('take', { graphic: a.options.graphic }),
			},
			show: {
				name: 'Show a graphic (never clears)',
				options: [graphicOption],
				callback: (a) => this.send('show', { graphic: a.options.graphic }),
			},
			hide: {
				name: 'Clear off screen',
				options: [],
				callback: () => this.send('hide'),
			},
			toggle: {
				name: 'Toggle whatever is up',
				options: [],
				callback: () => this.send('toggle'),
			},
			next: {
				name: 'Step to the next graphic',
				options: [],
				callback: () => this.send('next'),
			},
			prev: {
				name: 'Step to the previous graphic',
				options: [],
				callback: () => this.send('prev'),
			},
			refresh: {
				name: 'Refresh the standings data now',
				options: [],
				callback: () => this.send('refresh'),
			},
		})
	}

	/* ---------------------------------------------------------------- *
	 * feedbacks
	 * ---------------------------------------------------------------- */
	initFeedbacks() {
		const red = combineRgb(180, 35, 28)
		const green = combineRgb(30, 140, 60)
		const white = combineRgb(255, 255, 255)

		this.setFeedbackDefinitions({
			graphic_on_air: {
				type: 'boolean',
				name: 'This graphic is on air',
				defaultStyle: { bgcolor: red, color: white },
				options: [
					{
						type: 'dropdown',
						label: 'Graphic',
						id: 'graphic',
						default: 'al',
						choices: GRAPHICS.map((g) => ({ id: g.id, label: g.label })),
					},
				],
				callback: (fb) => this.state.visible && this.state.graphic === fb.options.graphic,
			},
			on_air: {
				type: 'boolean',
				name: 'Any graphic is on air',
				defaultStyle: { bgcolor: red, color: white },
				options: [],
				callback: () => this.state.visible,
			},
			connected: {
				type: 'boolean',
				name: 'Control window is connected',
				defaultStyle: { bgcolor: green, color: white },
				options: [],
				callback: () => this.live('control').length > 0,
			},
			overlay_linked: {
				type: 'boolean',
				name: 'An OBS overlay is dialled into this module',
				defaultStyle: { bgcolor: green, color: white },
				options: [],
				callback: () => this.live('output').length > 0,
			},
			data_ok: {
				type: 'boolean',
				name: 'Standings data failed to load',
				defaultStyle: { bgcolor: combineRgb(190, 120, 0), color: combineRgb(0, 0, 0) },
				options: [],
				callback: () => this.live('control').length > 0 && !this.state.dataOk,
			},
		})
	}

	/* ---------------------------------------------------------------- *
	 * presets
	 * ---------------------------------------------------------------- */
	initPresets() {
		const white = combineRgb(255, 255, 255)
		const navy = combineRgb(13, 31, 45)
		const base = { size: '14', color: white, bgcolor: navy }
		const presets = {}

		// One button per graphic — lights red while that one is on air, and a
		// second press clears it, which is how the control window behaves too.
		GRAPHICS.forEach((g) => {
			presets[`take_${g.id}`] = {
				type: 'button',
				category: 'Graphics',
				name: `Take ${g.label}`,
				style: { ...base, text: g.label.replace(' ', '\\n') },
				steps: [{ down: [{ actionId: 'take', options: { graphic: g.id } }], up: [] }],
				feedbacks: [{ feedbackId: 'graphic_on_air', options: { graphic: g.id } }],
			}
		})

		presets['hide'] = {
			type: 'button',
			category: 'Graphics',
			name: 'Clear off screen',
			style: { ...base, text: 'CLEAR\\nOFF', bgcolor: combineRgb(60, 20, 18) },
			steps: [{ down: [{ actionId: 'hide', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'on_air', options: {} }],
		}
		presets['toggle'] = {
			type: 'button',
			category: 'Graphics',
			name: 'Toggle what is up',
			style: { ...base, text: 'TOGGLE' },
			steps: [{ down: [{ actionId: 'toggle', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'on_air', options: {} }],
		}
		presets['next'] = {
			type: 'button',
			category: 'Graphics',
			name: 'Next graphic',
			style: { ...base, text: 'NEXT' },
			steps: [{ down: [{ actionId: 'next', options: {} }], up: [] }],
			feedbacks: [],
		}
		presets['prev'] = {
			type: 'button',
			category: 'Graphics',
			name: 'Previous graphic',
			style: { ...base, text: 'PREV' },
			steps: [{ down: [{ actionId: 'prev', options: {} }], up: [] }],
			feedbacks: [],
		}

		presets['status'] = {
			type: 'button',
			category: 'Status',
			name: 'What is on air',
			style: { ...base, size: '7', text: '$(mlb:status)' },
			steps: [{ down: [{ actionId: 'hide', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'on_air', options: {} }],
		}
		presets['link'] = {
			type: 'button',
			category: 'Status',
			name: 'Control window connected',
			style: { ...base, size: '7', text: 'CONTROL\\n$(mlb:connected)' },
			steps: [{ down: [], up: [] }],
			feedbacks: [{ feedbackId: 'connected', options: {} }],
		}
		presets['overlay'] = {
			type: 'button',
			category: 'Status',
			name: 'Overlay dialled in',
			style: { ...base, size: '7', text: 'OVERLAY\\n$(mlb:overlays)' },
			steps: [{ down: [], up: [] }],
			feedbacks: [{ feedbackId: 'overlay_linked', options: {} }],
		}
		presets['refresh'] = {
			type: 'button',
			category: 'Status',
			name: 'Refresh the data',
			style: { ...base, size: '7', text: 'REFRESH\\n$(mlb:data_updated)' },
			steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'data_ok', options: {} }],
		}

		this.setPresetDefinitions(presets)
	}
}

runEntrypoint(MLBStandingsInstance, [])
