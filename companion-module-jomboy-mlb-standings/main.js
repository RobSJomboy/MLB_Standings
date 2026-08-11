const { InstanceBase, InstanceStatus, runEntrypoint, combineRgb } = require('@companion-module/base')
const { WebSocketServer } = require('ws')

/*
 * The control window is a browser page, and a browser can only ever be a
 * WebSocket *client*. So this module runs the server and the page dials in.
 * Companion sends actions down the socket; the page pushes its state back up
 * for variables and feedbacks.
 *
 * Everything on the wire that describes what is on screen is ABSOLUTE state
 * ({graphic, visible, seq}) — never "toggle". Only one side ever resolves a
 * relative action into absolute state, so a duplicated or out-of-order message
 * can't leave the Stream Deck lit differently from the output.
 *
 * If no control window is connected and an ntfy topic is configured, the module
 * publishes that absolute state to the topic itself, so a Stream Deck can still
 * drive the OBS overlay with the operator window closed.
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
		this.deck = null // the control window
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
				label: 'Working without the control window (optional)',
				value:
					'Fill in the same ntfy topic the control window uses and the Stream Deck will still ' +
					'drive the OBS overlay when that window is closed. Leave it blank to require the ' +
					'control window — which is the normal way to run the show, since it is where the ' +
					'preview lives.',
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

		this.updateStatus(InstanceStatus.Connecting, `Listening on ${port} — waiting for the control window`)

		this.wss.on('connection', (ws) => {
			this.deck = ws
			this.updateStatus(InstanceStatus.Ok, 'Control window connected')
			this.log('info', 'MLB Standings control window connected')
			// $(…:connected) is stale until this runs, and the page may not push
			// state for a while — so refresh it here, not just on the way out.
			this.pushVariables()
			this.checkFeedbacks()

			ws.on('message', (raw) => {
				let msg
				try {
					msg = JSON.parse(raw.toString())
				} catch (e) {
					return
				}
				if (msg && msg.type === 'state') this.applyState(msg)
			})

			ws.on('close', () => {
				if (this.deck === ws) {
					this.deck = null
					this.updateStatus(InstanceStatus.Connecting, 'Control window disconnected — waiting')
					this.pushVariables()
					this.checkFeedbacks()
				}
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
		try {
			if (this.deck) this.deck.close()
		} catch (e) {}
		try {
			if (this.wss) this.wss.close()
		} catch (e) {}
		this.deck = null
		this.wss = null
	}

	applyState(msg) {
		this.state = { ...EMPTY, ...msg }
		this.pushVariables()
		this.checkFeedbacks()
	}

	/* ---------------------------------------------------------------- *
	 * sending

	 * With the control window up it is the authority: send the relative action
	 * and let it work out and echo back the result. Without it, resolve the
	 * action here and put the answer on the ntfy topic ourselves.
	 * ---------------------------------------------------------------- */
	send(action, extra = {}) {
		if (this.deck && this.deck.readyState === 1) {
			try {
				this.deck.send(JSON.stringify({ type: 'action', action, ...extra }))
			} catch (e) {
				this.log('error', `Send failed: ${e.message}`)
			}
			return
		}

		if (this.config?.topic) {
			this.publishFallback(action, extra)
			return
		}

		this.log(
			'warn',
			'No control window connected — open MLB_Standings.html and connect it, ' +
				'or set an ntfy topic in this instance\'s config.'
		)
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

	async publishFallback(action, extra) {
		const next = this.resolve(action, extra)
		if (!next) return

		const payload = {
			type: 'state',
			graphic: next.graphic,
			visible: next.visible,
			seq: Date.now(),
			label: labelFor(next.graphic),
			from: 'companion',
		}

		try {
			const resp = await fetch(`https://ntfy.sh/${encodeURIComponent(this.config.topic)}`, {
				method: 'POST',
				body: JSON.stringify(payload),
			})
			if (!resp.ok) throw new Error('HTTP ' + resp.status)
			this.applyState({ ...payload, dataOk: this.state.dataOk, updated: this.state.updated })
		} catch (e) {
			this.log('error', `Could not publish to the ntfy topic: ${e.message}`)
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
			{ variableId: 'relay', name: 'Control window is relaying to OBS' },
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
			connected: this.deck ? 'yes' : 'no',
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
				callback: () => !!this.deck,
			},
			data_ok: {
				type: 'boolean',
				name: 'Standings data failed to load',
				defaultStyle: { bgcolor: combineRgb(190, 120, 0), color: combineRgb(0, 0, 0) },
				options: [],
				callback: () => !!this.deck && !this.state.dataOk,
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
