# MLB Standings

On-air standings graphics for Jomboy Media shows. One HTML file gives you the
operator window *and* the OBS overlay, with four graphics on it:

- **AL Standings** — all three divisions, W-L / GB / L10
- **NL Standings** — same
- **AL Wild Card** — the wild card race with a dashed line under the three spots
- **NL Wild Card** — same

The graphic is otherwise unchanged from the separate `AL_Standings` /
`NL_Standings` / `*_WildCard_Standings` files it replaces: a 1920×1080
transparent canvas with a 528×1004 panel pinned to the right, 38px down. Same
Rift type, same gold `#c8a84b`, same slide-in and row build. Drop-in swap for
the four Browser Sources you had before.

The one deliberate change: the header reads **AL Standings** / **NL Standings**
rather than spelling out "American League Standings". Spelled out, it wrapped to
two lines of 54px inside a 72px header, so the second line crossed the gold rule
and sat on top of the EAST row. One line also matches the wild card panels, so
all four now share the same header geometry.

Numbers come live from the MLB StatsAPI and re-fetch every 30 minutes. A refresh
that lands while a graphic is on air swaps the numbers in place — it does not
replay the reveal animation.

---

## Live version

Hosted on GitHub Pages, so there is nothing to download and OBS can point at a
URL instead of a file path:

**<https://robsjomboy.github.io/MLB_Standings/>**

Every push to `main` republishes it, usually within a minute.

Two things get better on the hosted version than on a local file: the **Copy**
button actually works (the clipboard API is blocked on `file://`), and the OBS
URL it generates is a plain `https://` link you can paste on any machine instead
of a path that only resolves on yours.

The local file still works exactly as before — double-click it. Use whichever
suits you; they are the same file.

---

## Running the show

### 1. Open the control window

Open **<https://robsjomboy.github.io/MLB_Standings/>** (or double-click your local
`MLB_Standings.html`). That is the operator window: four buttons, a live preview,
and the connection panels.

The preview is not a mock-up — it is the same 1920×1080 markup the overlay uses,
scaled down in place. What you see is what is going out.

Keys: `1`–`4` take a graphic, `0` or `Esc` clears, `[` toggles, `←` `→` step
through. Clicking the graphic that is already up clears it.

### 2. Point OBS at the output

An OBS Browser Source is its own browser, so it cannot hear the control window
directly — something has to carry state between them.

1. In the control window, copy the **OBS URL** from the *OBS output* panel.
2. Add a **Browser Source**, **1920×1080**, leave **Local file unchecked**, and
   paste that URL in.

That's it — the source mirrors the preview, and catches up on load, so starting
OBS after the control window still comes up on the right graphic.

Copy the URL from the control window rather than typing it, so every route it
knows about comes along. The topic and relay are remembered between sessions; if
you change either, re-copy the URL, since both are baked into the query string.

That URL carries **three** ways for the overlay to follow along, in order of
preference:

| Route | When it carries the show |
| --- | --- |
| `&ws=` the Companion module | OBS on this machine. Local, instant, no internet. **Best.** |
| `&relay=` your own relay | OBS on another machine. Your Cloudflare account — see [`relay/`](relay/DEPLOY.md). |
| `&topic=` an ntfy.sh topic | Last resort, and the only one that isn't yours. |

Any one alone is enough, and they cannot contradict each other — every message is
absolute state stamped with a sequence number, so whichever arrives second is
either identical or newer.

If OBS is on this machine, the module route means **the show does not depend on
the internet at all**.

### Your own relay

ntfy.sh is a free public instance and it went down hard during this build. The
`relay/` folder is a ~90-line Cloudflare Worker that does the same job on your own
account — free plan, no card, permanent URL. Paste its URL into the **Relay** box
and hit **Use Relay**; it is remembered and rides along in the copied OBS URL.

**Already deployed it for the Trade Snapshot? Reuse that URL.** The worker here is
byte-identical, and rooms are namespaced by topic name, so one relay serves every
Jomboy graphic without them seeing each other's traffic.

It also does something ntfy can't: the room **keeps the last state**, so a Browser
Source that OBS refreshes mid-show comes straight back up on the graphic that is
currently live instead of sitting blank until the next press.

Deploy notes are in [`relay/DEPLOY.md`](relay/DEPLOY.md). To check the worker
against the contract the pages rely on, run it locally and point the harness at
it:

```bash
cd relay && npx wrangler dev --port 8788
```

```bash
node relay/test-relay.js
```

> Whichever remote route you use, the identifier is just a channel name and the
> only thing crossing it is which of the four graphics is up. Nothing sensitive —
> though a relay on your own account isn't public the way an ntfy topic is.

### 3. Optional: Stream Deck

See [the Companion module](companion-module-jomboy-mlb-standings/) below.

---

## On a Windows PC

Nothing here is Mac-only. The graphics are a web page, and the Companion module
is pure JavaScript — no native binaries, no compiled dependencies, nothing to
build. The same repo runs as-is on Windows.

### Just OBS, nothing to install

1. Open **<https://robsjomboy.github.io/MLB_Standings/>** in Chrome or Edge.
2. Copy the **OBS URL** from the *OBS output* panel.
3. In OBS: **Sources → + → Browser**. Set **Width 1920**, **Height 1080**, leave
   **Local file unchecked**, paste the URL, OK.

Drive it from the browser tab. On this path the overlay follows over a remote
route, so it depends on something outside the machine being up. Two ways to fix
that, either of which is better than relying on ntfy.sh:

- **Deploy your own relay** ([`relay/DEPLOY.md`](relay/DEPLOY.md)) — still remote,
  but yours, and it works across machines.
- **Add Companion** (below) — nothing leaves the PC. You do **not** need a Stream
  Deck for this; Companion just acts as the local relay between the tab and OBS.

### With Companion (Stream Deck, and local sync that needs no internet)

1. **Get the files.** On the repo page: **Code → Download ZIP**, then extract —
   or `git clone https://github.com/RobSJomboy/MLB_Standings.git`.
2. Put it somewhere stable, e.g. `C:\Users\<you>\Documents\companion-dev\`.
   After extracting you want a folder that *directly contains*
   `companion-module-jomboy-mlb-standings`. A GitHub ZIP unpacks to
   `MLB_Standings-main\`, and that folder is exactly the right thing to point at.
3. **This setting is in the Companion _launcher_ window, not the web UI.** That's
   the small desktop window you get when Companion starts (if it's hidden, click
   the Companion icon in the system tray).
   - Click the **cog in the top-right** to open Advanced Settings
   - Find the **Developer** section
   - **Select** your folder — `C:\Users\<you>\Documents\companion-dev\MLB_Standings-main`,
     the **parent** of the module folder, *not* the module folder itself
   - Turn **Enable Developer Modules** on — easy to miss, and nothing loads
     without it
   - Close the window and **Launch GUI**
4. **Connections → +** → search *MLB Standings* (Jomboy Media) → add it.
   **Label the connection `mlb`**, or the bundled presets that use `$(mlb:…)`
   come up blank.

If *MLB Standings* isn't in that list, Companion never loaded the module — it is
almost always the path pointing one level too deep, or the Enable toggle being
off. Companion picks up changes to a developer module while running, so you don't
need to restart it once the path is right.
6. In the control window, under *Stream Deck — Bitfocus Companion*, enter
   `ws://127.0.0.1:8100` and hit **Connect**.
7. Re-copy the **OBS URL** — it now carries `&ws=` too — and paste it into the
   Browser Source. Buttons for the Stream Deck are under **Buttons → Presets →
   MLB Standings**.

You do not need to install Node.js: Companion ships its own runtime, which is
what runs the module.

### Windows notes

- **Firewall.** The module listens on 8100. Loopback (`127.0.0.1`) traffic isn't
  filtered, so a same-machine setup normally raises no prompt. If Windows does
  ask when Companion starts, allowing it on private networks is enough.
- **A module on a *different* machine.** The module listens on every interface,
  so `ws://<that-pc-lan-ip>:8100` reaches it — but **not from the hosted
  `https://` page**. Browsers only exempt `localhost` from the rule against
  plaintext `ws://` on a secure page; a LAN address gets blocked as mixed
  content. For that layout either use the ntfy topic, or open your local copy of
  `MLB_Standings.html` instead of the hosted URL.
- **Function keys.** On laptops where F-keys default to media controls, the
  `F9`/`F10` shortcuts need `Fn`. The `1`–`4`, `0` and `Esc` keys don't.
- **Fonts.** Rift and the UI faces load over the web; there is nothing to
  install locally.

---

## The Companion module

`companion-module-jomboy-mlb-standings/` lets a Stream Deck take these graphics
through [Bitfocus Companion](https://bitfocus.io/companion).

It is a **developer module**, not in the Companion store:

1. Companion → **Settings → Developer modules path** → point it at the
   *parent* directory (the one holding `companion-module-jomboy-mlb-standings`),
   not the module folder itself.
2. Restart Companion, then add a **Jomboy Media / MLB Standings** connection.
3. Name the connection **`mlb`** — the bundled presets reference variables as
   `$(mlb:status)`, so a different label leaves those buttons blank.
4. In the control window, under *Stream Deck — Bitfocus Companion*, enter
   `ws://127.0.0.1:8100` and hit **Connect**.

`node_modules` has to exist next to `main.js`; it is committed here so the module
runs as-is.

The module ships with two test harnesses that stub Companion and drive the real
socket, so the routing rules can be checked without launching anything:

```bash
node companion-module-jomboy-mlb-standings/test-routing.js
```

`test-routing.js` covers the control/overlay split; `test-module.js` covers the
actions, feedbacks and the resolver. Both print PASS/FAIL per check.

**Direction matters:** the module runs the WebSocket server and the browser page
dials in to it. A browser can only ever be a WebSocket client, so it cannot work
the other way around.

### Actions

| Action | What it does |
| --- | --- |
| Take a graphic to air | Takes it; pressing the same one again clears it |
| Show a graphic | Takes it and never clears — safe for a "this one, always" button |
| Clear off screen | Slides whatever is up back off |
| Toggle whatever is up | Re-takes the last graphic, or clears it |
| Step to next / previous | Cycles AL → NL → AL WC → NL WC |
| Refresh the standings data | Re-fetches from the StatsAPI now |

### Feedbacks

`This graphic is on air` (per graphic), `Any graphic is on air`,
`Control window is connected`, `An OBS overlay is dialled into this module`,
`Standings data failed to load`.

The per-graphic feedback is what makes a Stream Deck button go red while its own
graphic is up, so the surface matches the control window.

### Variables

`$(mlb:graphic)`, `$(mlb:graphic_id)`, `$(mlb:on_air)`, `$(mlb:status)`,
`$(mlb:data_updated)`, `$(mlb:connected)`, `$(mlb:overlays)`, `$(mlb:relay)`.

### Running without the control window

Normally the control window is open — it is where the preview is. But it isn't
required: with an overlay dialled into the module, the Stream Deck drives the
graphics on its own, because the module resolves the actions itself when no
control window is connected. Setting an ntfy topic in the module's config adds
the remote route as well.

---

## How the pieces talk

Both the control window and the OBS overlay dial into the Companion module. On
one machine that means nothing leaves it:

```
Stream Deck → Companion module ──[WebSocket]──→ control window   (resolves, previews)
                    │                                  │
                    │←─────────── state ───────────────┘   └─[your relay]─→ OBS elsewhere
                    └──[WebSocket]──→ OBS overlay              └─[ntfy]────→ last resort
```

The two get different traffic, and that split is the whole design:

- **Relative actions** — `toggle`, `next`, a second press meaning *clear* — go
  **only to control windows**. If overlays resolved those themselves they would
  each compute their own answer and drift apart from the operator window.
- **Absolute state** is broadcast to everyone.

So there is always exactly one resolver: the control window when one is
connected, otherwise the module. An overlay only ever listens, and the module
ignores state pushed *by* an overlay, so it can never talk over the operator.

An overlay that connects mid-show is handed the current picture immediately, so
it comes up on the right graphic without waiting for the next press.

Everything that crosses a wire is **absolute state** — `{graphic, visible, seq}`,
never "toggle". Relative actions are resolved to absolute state by exactly one
side before they go anywhere. That is what keeps a duplicated, delayed, or
out-of-order message from leaving the Stream Deck lit differently from what is
actually on screen.

Two consequences worth knowing:

- The control window is the authority while it is connected. The module forwards
  actions to it and takes its word for the result.
- The overlay only ever listens. It never publishes, so it cannot argue with the
  operator window.

Traffic on the remote routes is **per-press only** — nothing is published on a
timer. A chatty ntfy topic gets rate limited, and a rate-limited topic means the
overlay stops hearing anything mid-show. The watchdogs in the page are local
timers that reconnect a dead stream; they make no requests of their own. The relay
chip likewise updates off each press rather than polling, because the overlay
holds its own live socket and idle probing would buy nothing.

The control window publishes to the relay **or** ntfy, not both — sending to both
on every press would double the traffic on the one transport that rate-limits.
ntfy is used when no relay is set, or when a relay POST has just failed.

### Files

| Path | What |
| --- | --- |
| `MLB_Standings.html` | Control window and overlay, logos embedded |
| `index.html` | Redirect so the bare Pages URL works |
| `companion-module-jomboy-mlb-standings/` | The Companion module, plus its two test harnesses |
| `relay/` | The Cloudflare Worker relay, its deploy notes and contract test |

---

### URL parameters

| Param | Effect |
| --- | --- |
| `?output=1` | Overlay mode: transparent, graphic only, no UI |
| `&topic=…` | Which ntfy topic to listen on (or relay to) |
| `&ws=…` | Overlay only: dial a Companion module directly |
| `&relay=…` | Your own relay's base URL |
| `&graphic=al&show` | Overlay only: come up on one graphic and stay there |

---

## Data

`https://statsapi.mlb.com/api/v1/standings` — `regularSeason` for the divisions,
`wildCard` for the wild card races. If the wild card endpoint is unavailable the
page derives the race from the division standings instead: it drops the division
leaders, sorts by win percentage, and measures games back off the last wild card
spot.

### Team logos

Cap marks come from `mlbstatic.com` in **team colour** — the `team-cap-on-light`
set. The `team-cap-on-dark` set that this originally used is flat white for all
30 clubs, which is why the Reds' C, the Phillies' P and the Nationals' W were
coming out as plain white letters.

Five caps are a single dark ink with nothing brighter than channel 72 anywhere in
the mark, so in colour they would disappear against dark video. Those keep the
white version:

| Team | Cap ink |
| --- | --- |
| Tigers | `#0A2240` navy |
| Yankees | `#132448` navy |
| White Sox | black (the SVG ships with no fill at all) |
| Padres | `#2F241D` brown |
| Athletics | `#003831` dark green |

The other 25 clubs get their colour. If a colour mark ever fails to load it falls
back to the white one, and only hides itself if that fails too — so a bad asset
never leaves a gap in the row.

The darkest mark still in colour is the Royals' `#004687` blue. It reads fine
over most backgrounds; if it ever gets lost on air, add `118` to `DARK_CAPS` in
`MLB_Standings.html` and it will switch to white with everything else.
