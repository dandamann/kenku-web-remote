import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where Kenku FM's remote server lives. In Portainer this must point at the
// machine running Kenku, e.g. http://192.168.1.20:3333. host.docker.internal
// works on Docker Desktop; on Linux see docker-compose.yml's extra_hosts.
const KENKU_URL = (process.env.KENKU_URL || "http://host.docker.internal:3333").replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

// Optional comma-separated soundboard titles to show (case-insensitive). Unset
// or empty shows every soundboard.
const ONLY_BOARDS = (process.env.SOUNDBOARDS || "")
  .split(",")
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

// Optional local playback ("preview") of sounds in the browser. Kenku reports
// file:// paths from its own machine, so SOUNDS_PREFIX is the folder as Kenku
// sees it (e.g. /home/me/Music/Sounds) and SOUNDS_DIR is where that same folder
// is mounted in this container. Leave SOUNDS_PREFIX unset to disable previews.
const SOUNDS_PREFIX = (process.env.SOUNDS_PREFIX || "").replace(/\/+$/, "");
const SOUNDS_DIR = process.env.SOUNDS_DIR || "/sounds";

const fastify = Fastify({ logger: true });

fastify.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
});

// Talk to Kenku, translating any connection failure into a clean 502 so the
// browser never has to distinguish "network died" from "bad JSON".
async function kenku(pathname, init) {
  let res;
  try {
    res = await fetch(`${KENKU_URL}${pathname}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    return {
      status: 502,
      body: {
        error: "Unreachable",
        message: `Could not reach Kenku FM at ${KENKU_URL}. Is Kenku running with the remote enabled and bound to 0.0.0.0?`,
        detail: String(err?.cause?.code || err?.name || err),
      },
    };
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  return { status: res.status, body };
}

fastify.get("/api/config", async () => ({
  kenkuUrl: KENKU_URL,
  previews: Boolean(SOUNDS_PREFIX),
}));

fastify.get("/api/soundboard", async (_req, reply) => {
  const { status, body } = await kenku("/v1/soundboard");
  if (ONLY_BOARDS.length && Array.isArray(body.soundboards)) {
    body.soundboards = body.soundboards.filter((b) =>
      ONLY_BOARDS.includes(String(b.title || "").trim().toLowerCase()),
    );
  }
  reply.status(status).send(body);
});

fastify.get("/api/soundboard/playback", async (_req, reply) => {
  const { status, body } = await kenku("/v1/soundboard/playback");
  reply.status(status).send(body);
});

fastify.put("/api/soundboard/play", async (req, reply) => {
  const { status, body } = await kenku("/v1/soundboard/play", {
    method: "PUT",
    body: JSON.stringify({ id: req.body?.id }),
  });
  reply.status(status).send(body);
});

fastify.put("/api/soundboard/stop", async (req, reply) => {
  const { status, body } = await kenku("/v1/soundboard/stop", {
    method: "PUT",
    body: JSON.stringify({ id: req.body?.id }),
  });
  reply.status(status).send(body);
});

// Stream a sound's audio file for in-browser preview. The browser only sends a
// sound id; the path comes from Kenku's own list and must sit under
// SOUNDS_PREFIX, so no client-supplied path ever touches the filesystem.
fastify.get("/api/audio/:id", async (req, reply) => {
  if (!SOUNDS_PREFIX) return reply.status(404).send({ message: "Previews are not enabled." });

  const { status, body } = await kenku("/v1/soundboard");
  if (status !== 200) return reply.status(status).send(body);

  const sound = (body.sounds || []).find((s) => s.id === req.params.id);
  if (!sound) return reply.status(404).send({ message: "Unknown sound." });

  let file;
  try {
    file = fileURLToPath(sound.url);
  } catch {
    return reply.status(404).send({ message: "That sound is not a local file." });
  }
  const prefix = `${SOUNDS_PREFIX}${path.sep}`;
  if (!file.startsWith(prefix)) {
    return reply.status(404).send({ message: "That sound is outside SOUNDS_PREFIX." });
  }
  return reply.sendFile(file.slice(prefix.length), SOUNDS_DIR);
});

fastify.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`kenku-web-remote serving on ${address}, proxying to ${KENKU_URL}`);
});
