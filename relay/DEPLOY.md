# Deploying the relay (once, ~3 minutes)

This replaces ntfy.sh with a relay on your own Cloudflare account. Free plan, no
card.

## Already deployed it for the Trade Snapshot?

Then you are done — **paste that same `https://…workers.dev` URL** into the
**Relay** box on the control page and skip the rest of this file. Rooms are
namespaced by the topic name, so one relay serves every Jomboy graphic without
them ever seeing each other's traffic. This `worker.js` is byte-identical to the
one in `mlb_stats/relay/`.

## Otherwise

```bash
cd relay
npx wrangler login     # opens a browser; make a free account if you don't have one
npx wrangler deploy
```

The last command prints a URL like:

```
https://jomboy-relay.<your-subdomain>.workers.dev
```

That URL is the relay. Paste it into the **Relay** box in the *OBS output* panel
and hit **Use Relay** — it is remembered, and it rides along in the copied OBS
URL, so the Browser Source picks it up automatically.

Check it is alive by opening the URL in a browser. It should answer:

```json
{"ok":true,"service":"jomboy-relay","usage":"POST or GET /r/<room>"}
```

## Redeploying

Change `worker.js`, run `npx wrangler deploy` again. The URL stays the same.

## What it costs

Nothing at this volume. The free plan covers 100,000 requests a day; a three-hour
show with a Browser Source on a WebSocket is a few hundred. Durable Objects
hibernate while idle, so a room between graphics costs nothing.

## The contract

| | |
| --- | --- |
| `POST /r/<room>` | body is the state JSON — stores it and pushes to everyone |
| `GET /r/<room>` | the last state (polling fallback / catch-up) |
| `GET /r/<room>` + `Upgrade: websocket` | live push, and the current state on connect |
| `GET /` | health check |

The stored-last-state part is what matters on air: an OBS Browser Source that
gets refreshed mid-show is handed the graphic that is currently up the moment it
reconnects, instead of sitting blank until the next button press.
