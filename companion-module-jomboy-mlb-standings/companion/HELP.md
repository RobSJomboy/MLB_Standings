# MLB Standings — Jomboy Media

Takes the AL / NL standings and wild card graphics to air from a Stream Deck.

## How it connects

This module runs a WebSocket server and the graphics pages dial into it — a
browser can only ever be a WebSocket client, so it cannot work the other way
around.

1. Set **Listen port** below (default `8100`).
2. Open the control window:
   <https://robsjomboy.github.io/MLB_Standings/>
3. Under **Stream Deck — Bitfocus Companion**, enter `ws://127.0.0.1:8100`
   and press **Connect**. If the page is on another machine, use this machine's
   IP instead of `127.0.0.1`.
4. Copy the **OBS URL** from the control window into a **1920×1080** Browser
   Source with **Local file unchecked**. That URL carries this module's address,
   so the overlay dials in too and needs no internet.

The **OBS output** panel in the control window states plainly whether a Browser
Source is connected. Trust that line over anything else.

> **Name this connection `mlb`.** The bundled presets reference variables as
> `$(mlb:…)`, so a different label leaves those buttons blank.

## ntfy topic (optional)

Only needed to reach an OBS on a *different* machine than the control window, or
to drive the overlay while this module is not running. Leave it blank for a
one-machine setup. Prefer the relay described in the project's `relay/` folder —
ntfy.sh is a free public instance and does go down.

## Actions

| Action | Notes |
| --- | --- |
| Take a graphic to air | Pressing the same one again clears it |
| Show a graphic | Takes it and never clears |
| Clear off screen | Slides whatever is up back off |
| Toggle whatever is up | Re-takes the last graphic, or clears it |
| Step to next / previous | Cycles AL → NL → AL WC → NL WC |
| Refresh the standings data | Re-fetches from the MLB StatsAPI now |

## Feedbacks

`This graphic is on air` (per graphic), `Any graphic is on air`,
`Control window is connected`, `An OBS overlay is dialled into this module`,
`Standings data failed to load`.

## Variables

`$(mlb:graphic)`, `$(mlb:graphic_id)`, `$(mlb:on_air)`, `$(mlb:status)`,
`$(mlb:data_updated)`, `$(mlb:connected)`, `$(mlb:overlays)`, `$(mlb:relay)`.

## If nothing happens

- Companion log says *"Nothing connected"* — the control window has not dialled
  in. Check the address and press **Connect**.
- Graphics change in the control window but not in OBS — the Browser Source URL
  is missing this module's address. Re-copy the **OBS URL** after connecting.
