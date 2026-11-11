// Download every soundboard sound from a Discord server so they can be added
// to Kenku FM. Read-only: lists the guild's sounds and fetches each file.
//
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npm run export-discord-sounds [outDir]
//
// The bot must be a member of the server. outDir defaults to ./discord-sounds.
import fs from "node:fs/promises";
import path from "node:path";

const API = "https://discord.com/api/v10";
const CDN = "https://cdn.discordapp.com/soundboard-sounds";

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const outDir = path.resolve(process.argv[2] || "discord-sounds");

if (!token || !guildId) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID (see the header of this script).");
  process.exit(1);
}

const EXT_BY_TYPE = { "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav" };

// fetch that waits out Discord's rate limits instead of failing.
async function get(url, init) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;
    const wait = Number(res.headers.get("retry-after") || 1);
    console.warn(`Rate limited, waiting ${wait}s...`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  throw new Error(`Still rate limited after retries: ${url}`);
}

function safeName(name) {
  return String(name || "sound").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim() || "sound";
}

const listRes = await get(`${API}/guilds/${guildId}/soundboard-sounds`, {
  headers: { Authorization: `Bot ${token}` },
});
if (!listRes.ok) {
  console.error(`Could not list sounds: ${listRes.status} ${await listRes.text()}`);
  console.error("Check the token, the guild ID, and that the bot is in that server.");
  process.exit(1);
}

const listed = await listRes.json();
const sounds = Array.isArray(listed) ? listed : listed.items || [];
if (sounds.length === 0) {
  console.log("That server has no soundboard sounds.");
  process.exit(0);
}

await fs.mkdir(outDir, { recursive: true });
const used = new Set();
let saved = 0;

for (const sound of sounds) {
  const res = await get(`${CDN}/${sound.sound_id}`);
  if (!res.ok) {
    console.warn(`Skipping "${sound.name}": ${res.status}`);
    continue;
  }
  const type = (res.headers.get("content-type") || "").split(";")[0];
  const ext = EXT_BY_TYPE[type] || ".mp3";

  // Two sounds can share a name; keep both.
  const base = safeName(sound.name);
  let file = base + ext;
  for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base} (${n})${ext}`;
  used.add(file.toLowerCase());

  await fs.writeFile(path.join(outDir, file), Buffer.from(await res.arrayBuffer()));
  console.log(`Saved ${file}`);
  saved++;
}

console.log(`Done: ${saved}/${sounds.length} sounds saved to ${outDir}`);
