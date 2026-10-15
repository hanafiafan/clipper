// Minimal streaming ZIP writer (store only, no compression: mp4 is already compressed). Zero dependencies.
// Each entry uses a data descriptor, so files stream through without being held in memory. No ZIP64: entries and archive stay under 4 GB.
const fs = require('fs'), zlib = require('zlib');

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
// Running CRC-32 (same contract as zlib.crc32, which older Electron/Node builds lack).
const crc32 = zlib.crc32 || ((buf, prev = 0) => { let c = (prev ^ 0xFFFFFFFF) >>> 0; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; });

const dos = d => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });

// Write buf to a stream, waiting for 'drain' when its buffer is full.
const put = (out, buf) => out.write(buf) ? Promise.resolve() : new Promise(ok => out.once('drain', ok));

// entries: [{ name, file }]. Streams a complete archive into `out` (an http response or a file stream) and ends it.
async function zipTo(out, entries) {
  const central = []; let offset = 0;
  for (const { name, file } of entries) {
    const nm = Buffer.from(name, 'utf8'), { time, date } = dos(fs.statSync(file).mtime);
    const head = Buffer.alloc(30); // local file header, sizes and CRC come later in the descriptor
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0808, 6); head.writeUInt16LE(0, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt16LE(nm.length, 26);
    await put(out, head); await put(out, nm);
    let crc = 0, size = 0;
    for await (const chunk of fs.createReadStream(file)) { crc = crc32(chunk, crc); size += chunk.length; await put(out, chunk); }
    if (size > 0xFFFFFFFF) throw new Error('berkas terlalu besar untuk ZIP');
    const desc = Buffer.alloc(16); desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(size, 8); desc.writeUInt32LE(size, 12);
    await put(out, desc);
    central.push({ nm, crc, size, time, date, offset });
    offset += 30 + nm.length + size + 16;
  }
  let cdSize = 0;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(0, 10);
    h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.nm.length, 28); h.writeUInt32LE(c.offset, 42);
    await put(out, h); await put(out, c.nm); cdSize += 46 + c.nm.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  await new Promise(ok => out.end(end, ok));
}

module.exports = { zipTo, crc32 };
