# kenku-web-remote

A mobile web remote for the [Kenku FM](https://www.kenku.fm/) soundboard. Host it
on your LAN (e.g. in Portainer), open it on your phone, and tap your soundboard
buttons during a session. Shows what's currently playing, tap again to stop a
sound, and a **Stop all** button to kill everything at once.

The app is a tiny Node/Fastify server that serves a mobile-first web UI **and
proxies** to Kenku FM's remote API. The proxy matters: Kenku's remote server
sends no CORS headers, so a phone browser can't call it directly — the container
talks to Kenku, the phone only talks to the container.

## Prerequisites: enable the Kenku remote

1. In Kenku FM open **Settings → Remote**.
2. Enable the remote control server.
3. Set the **host to `0.0.0.0`** (not the default `127.0.0.1`) so other devices —
   including the Docker container — can reach it over your LAN. Leave the port at
   `3333` unless you have a reason to change it.
4. Note your computer's LAN IP (e.g. `192.168.1.20`). You'll point the app at
   `http://<that-ip>:3333`.

## Run in Portainer

1. In Portainer create a **Stack** and paste the contents of
   [`docker-compose.yml`](./docker-compose.yml) (or point it at this Git repo).
2. Set the `KENKU_URL` environment variable to your computer's Kenku address,
   e.g. `http://192.168.1.20:3333`.
   - If Kenku runs on the **same host** as Docker, the default
     `http://host.docker.internal:3333` works because the stack maps
     `host.docker.internal` to the host gateway.
3. Deploy, then open `http://<portainer-host>:8787` on your phone.

> Tip: "Add to Home Screen" in your phone browser gives you a full-screen,
> app-like launcher.

## Run locally (dev)

```bash
npm install
KENKU_URL=http://127.0.0.1:3333 npm start
# open http://localhost:8787
```

## Configuration

| Variable    | Default                            | Description                             |
| ----------- | ---------------------------------- | --------------------------------------- |
| `KENKU_URL` | `http://host.docker.internal:3333` | Base URL of the Kenku FM remote server. |
| `SOUNDBOARDS` | _(all)_                          | Comma-separated soundboard titles to show, e.g. `Combat,Ambience`. Case-insensitive; unset shows everything. |
| `PORT`      | `8787`                             | Port the web app listens on.            |
| `HOST`      | `0.0.0.0`                          | Interface the web app binds to.         |

## Favourites

Tap the star on a sound to add or remove it from a **Favourites** row at the
top. Favourites are saved in that browser only, so
each phone keeps its own list.

## How it works

The browser talks only to this server; the server forwards to Kenku:

| App endpoint                   | Kenku endpoint                |
| ------------------------------ | ----------------------------- |
| `GET /api/soundboard`          | `GET /v1/soundboard`          |
| `GET /api/soundboard/playback` | `GET /v1/soundboard/playback` |
| `PUT /api/soundboard/play`     | `PUT /v1/soundboard/play`     |
| `PUT /api/soundboard/stop`     | `PUT /v1/soundboard/stop`     |

The UI polls `/api/soundboard/playback` every 5s to keep the now-playing
highlight current, and pauses polling entirely while the tab is hidden (phone
locked / app backgrounded). Tapping a button refreshes playback immediately, so
your own actions never wait for the poll.

## Exporting sounds from Discord

`scripts/export-discord-sounds.mjs` downloads every soundboard sound from a
Discord server so you can add them to Kenku. Your bot must be a member of the
server; no special permissions are needed.

```bash
DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run export-discord-sounds
```

Sounds that have a Discord emoji are named like `Airhorn 📯.mp3`. The web remote
shows a trailing emoji in a sound's title large on its button, with the name as
the label, so you can also add one by hand by editing the title in Kenku.

Files land in `./discord-sounds` (or pass another folder as an argument).
Get the guild ID by enabling Developer Mode in Discord, then right-clicking the
server icon and choosing **Copy Server ID**.

## Troubleshooting

- **Connected, but "No soundboards found".** Kenku's remote only returns
  *soundboards* (and the sounds inside them). Make sure you have at least one
  Soundboard created in the Kenku app with sounds in it. If it's still empty
  right after launching Kenku, its remote view may not be ready yet —
  **restarting the Kenku app** fixes it. To see the raw response, run from the
  Portainer host: `docker exec kenku-web-remote wget -qO- http://<kenku-ip>:3333/v1/soundboard`.
- **Logs show `proxying to http://host.docker.internal:3333` after you set
  `KENKU_URL`.** The stack didn't pick up your variable. Confirm it's named
  exactly `KENKU_URL` in the Portainer stack, then **re-deploy the stack** (not
  just restart the container) so the compose file is re-read.
- **`502` / "Could not reach Kenku FM".** The container can't reach Kenku.
  Check, in order: Kenku's remote is enabled and bound to `0.0.0.0`; `KENKU_URL`
  points at the Kenku machine's LAN IP (not the phone's, not the Portainer
  host's); and the host firewall allows inbound `3333` (Windows Firewall often
  needs an allow rule). The `502` body's `detail` field distinguishes the cause:
  `ECONNREFUSED` = reachable but nothing listening on that address;
  `ENOTFOUND`/timeout = wrong IP or blocked.
- **Changes not showing on the phone.** The browser caches `app.js`/`styles.css`.
  Hard-refresh (pull-to-refresh, or close and reopen the tab) after redeploying.

## Notes & limitations

- **No auth.** Anyone on your LAN who can reach the app can control your
  soundboard. That's fine for a home network; don't expose port 8787 to the
  internet.
- **Soundboard only.** Kenku also exposes playlist (background music) endpoints;
  those aren't wired up here yet, but the proxy pattern extends to them easily.
- Soundboard background images only render if Kenku reports them as `http(s)`
  URLs; local file paths are skipped and the button shows its solid colour.
