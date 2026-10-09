// Utilitas transkrip untuk analisis AI. Format transkrip: satu baris per kalimat, "[detik] teks".

// Pecah transkrip jadi bagian <= max karakter (per baris utuh), dengan overlap beberapa baris agar
// momen yang jatuh di batas bagian tidak terpotong. Transkrip pendek dikembalikan apa adanya.
function chunkTranscript(txt, max = 40000, overlapLines = 15) {
  if (txt.length <= max) return [txt];
  const lines = txt.split('\n'), parts = [];
  let i = 0;
  while (i < lines.length) {
    let n = 0, j = i;
    while (j < lines.length && n + lines[j].length + 1 <= max) n += lines[j++].length + 1;
    if (j === i) j = i + 1; // satu baris lebih panjang dari max: tetap dimasukkan
    parts.push(lines.slice(i, j).join('\n'));
    if (j >= lines.length) break;
    i = Math.max(i + 1, j - overlapLines); // selalu maju, tak pernah loop tak berujung
  }
  return parts;
}

const span = c => c.segs.reduce((n, s) => n + (s.end - s.start), 0);
const overlap = (a, b) => a.segs.reduce((n, x) => n + b.segs.reduce((m, y) => m + Math.max(0, Math.min(x.end, y.end) - Math.max(x.start, y.start)), 0), 0);

// Gabung klip dari beberapa bagian: skor tertinggi dulu; buang klip yang >50% tumpang tindih
// (menurut waktu) dengan klip yang sudah dipilih. Tiap klip: { segs:[{start,end}], score? }.
function dedupeClips(clips) {
  const out = [];
  for (const c of [...clips].sort((a, b) => (b.score || 0) - (a.score || 0)))
    if (!out.some(k => overlap(c, k) / Math.min(span(c), span(k)) > 0.5)) out.push(c);
  return out;
}

module.exports = { chunkTranscript, dedupeClips };
