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

fastify.get("/api/config", async () => ({ kenkuUrl: KENKU_URL }));

fastify.get("/api/soundboard", async (_req, reply) => {
  const { status, body } = await kenku("/v1/soundboard");
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

fastify.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`kenku-web-remote serving on ${address}, proxying to ${KENKU_URL}`);
});
