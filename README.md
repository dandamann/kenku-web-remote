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
| `PORT`      | `8787`                             | Port the web app listens on.            |
| `HOST`      | `0.0.0.0`                          | Interface the web app binds to.         |

## How it works

The browser talks only to this server; the server forwards to Kenku:

| App endpoint                   | Kenku endpoint                |
| ------------------------------ | ----------------------------- |
| `GET /api/soundboard`          | `GET /v1/soundboard`          |
| `GET /api/soundboard/playback` | `GET /v1/soundboard/playback` |
| `PUT /api/soundboard/play`     | `PUT /v1/soundboard/play`     |
| `PUT /api/soundboard/stop`     | `PUT /v1/soundboard/stop`     |

The UI polls `/api/soundboard/playback` every 1.5s to highlight what's playing.

## Notes & limitations

- **No auth.** Anyone on your LAN who can reach the app can control your
  soundboard. That's fine for a home network; don't expose port 8787 to the
  internet.
- **Soundboard only.** Kenku also exposes playlist (background music) endpoints;
  those aren't wired up here yet, but the proxy pattern extends to them easily.
- Soundboard background images only render if Kenku reports them as `http(s)`
  URLs; local file paths are skipped and the button shows its solid colour.
