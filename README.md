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

## Running the show

### 1. Open the control window

Double-click `MLB_Standings.html`. That is the operator window: four buttons, a
live preview, and the connection panels.

The preview is not a mock-up — it is the same 1920×1080 markup the overlay uses,
scaled down in place. What you see is what is going out.

Keys: `1`–`4` take a graphic, `0` or `Esc` clears, `[` toggles, `←` `→` step
through. Clicking the graphic that is already up clears it.

### 2. Point OBS at the output

An OBS Browser Source is its own browser, so it cannot hear the control window
directly. They talk over an [ntfy.sh](https://ntfy.sh) topic instead.

1. In the control window, copy the **OBS URL** from the *OBS output* panel.
2. Add a **Browser Source**, **1920×1080**, leave **Local file unchecked**, and
   paste that URL in.

That's it. The source listens on the same topic and mirrors the preview. It also
catches up on load, so starting OBS after the control window still comes up on
the right graphic.

The topic is remembered between sessions. If you change it, re-copy the OBS URL —
it has the topic baked into the query string.

> The topic is just a shared channel name on a public relay, and the only thing
> that crosses it is which of the four graphics is up. Nothing sensitive.

### 3. Optional: Stream Deck

See [the Companion module](companion-module-jomboy-mlb-standings/) below.

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
`Control window is connected`, `Standings data failed to load`.

The per-graphic feedback is what makes a Stream Deck button go red while its own
graphic is up, so the surface matches the control window.

### Variables

`$(mlb:graphic)`, `$(mlb:graphic_id)`, `$(mlb:on_air)`, `$(mlb:status)`,
`$(mlb:data_updated)`, `$(mlb:connected)`, `$(mlb:relay)`.

### Running without the control window

Normally the control window is open — it is where the preview is. If you want
the Stream Deck to drive the overlay with that window closed, put the same ntfy
topic in the module's config and it will publish state to the topic itself.

---

## How the pieces talk

```
Stream Deck → Companion → [WebSocket] → control window → [ntfy topic] → OBS overlay
                                             ↑
                                        preview lives here
```

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

Traffic on the topic is per-press only — nothing is published on a timer. A
chatty topic gets rate limited, and a rate-limited topic means the overlay stops
hearing anything mid-show. The stall watchdog in the page is a local timer that
reconnects a dead stream; it makes no requests of its own.

---

## Files

| Path | What |
| --- | --- |
| `MLB_Standings.html` | The whole thing — control window and overlay. League logos are embedded, so it needs no local assets. |
| `companion-module-jomboy-mlb-standings/` | The Companion module |

### URL parameters

| Param | Effect |
| --- | --- |
| `?output=1` | Overlay mode: transparent, graphic only, no UI |
| `&topic=…` | Which ntfy topic to listen on (or relay to) |
| `&ws=…` | Overlay only: also dial a Companion module directly |
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
