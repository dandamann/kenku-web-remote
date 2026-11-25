// Repair Ogg Opus files whose timestamps count at the wrong rate. Granule
// positions must be in 48 kHz units, but some Discord soundboard files advance
// 882 per 20 ms packet (44.1 kHz) instead of 960. ffmpeg and Kenku tolerate
// that; Firefox rejects the file. Only timestamps and page checksums change.

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i << 24;
  for (let bit = 0; bit < 8; bit++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0;
  for (const byte of buf) c = ((c << 8) ^ CRC_TABLE[(c >>> 24) ^ byte]) >>> 0;
  return c;
}

// Duration of one Opus packet in 48 kHz samples, from its TOC byte (RFC 6716).
function packetSamples(packet) {
  if (packet.length === 0) return 0;
  const config = packet[0] >> 3;
  let frame;
  if (config < 12) frame = [480, 960, 1920, 2880][config & 3];
  else if (config < 16) frame = [480, 960][config & 1];
  else frame = [120, 240, 480, 960][config & 3];
  const code = packet[0] & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] || 0) & 63;
  return frame * frames;
}

// Split into pages, noting how many audio samples have completed by the end of
// each. Returns null for anything but a single, intact Ogg Opus stream.
function readPages(data) {
  const pages = [];
  let offset = 0;
  let packetCount = 0;
  let total = 0;
  let partial = [];
  let serial;
  while (offset < data.length) {
    if (offset + 27 > data.length || data.toString("latin1", offset, offset + 4) !== "OggS") return null;
    const segments = data[offset + 26];
    const lacing = data.subarray(offset + 27, offset + 27 + segments);
    const headerLength = 27 + segments;
    const length = headerLength + lacing.reduce((sum, n) => sum + n, 0);
    if (lacing.length !== segments || offset + length > data.length) return null;

    serial ??= data.readUInt32LE(offset + 14);
    if (data.readUInt32LE(offset + 14) !== serial) return null;

    let position = offset + headerLength;
    let endsAudio = false;
    for (const size of lacing) {
      partial.push(data.subarray(position, position + size));
      position += size;
      if (size === 255) continue; // packet continues in the next segment
      const packet = Buffer.concat(partial);
      partial = [];
      if (packetCount === 0 && packet.toString("latin1", 0, 8) !== "OpusHead") return null;
      if (packetCount >= 2) {
        total += packetSamples(packet);
        endsAudio = true;
      }
      packetCount++;
    }
    pages.push({ offset, length, total, endsAudio, last: Boolean(data[offset + 5] & 4) });
    offset += length;
  }
  return pages;
}

// Returns a corrected copy, or null if the data doesn't need (or can't take) the
// fix. The test is the one the spec calls invalid: the first audio page, unless
// it is also the last, claims fewer samples than it contains. Valid files may
// trim their final page or start at a later position, and are left alone.
export function repairOpusTimestamps(data) {
  const pages = readPages(data);
  const first = pages?.find((p) => p.endsAudio);
  if (!first || first.last) return null;
  if (data.readBigInt64LE(first.offset + 6) >= BigInt(first.total)) return null;

  const fixed = Buffer.from(data);
  for (const page of pages) {
    if (!page.endsAudio) continue;
    fixed.writeBigInt64LE(BigInt(page.total), page.offset + 6);
    fixed.writeUInt32LE(0, page.offset + 22);
    const checksum = crc32(fixed.subarray(page.offset, page.offset + page.length));
    fixed.writeUInt32LE(checksum, page.offset + 22);
  }
  return fixed;
}
