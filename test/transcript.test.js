const test = require('node:test'), assert = require('node:assert/strict');
const { chunkTranscript, dedupeClips } = require('../lib/transcript');

const make = n => Array.from({ length: n }, (_, i) => `[${i * 5}] kalimat nomor ${i}`).join('\n');

test('transkrip pendek tidak dipecah', () => {
  const t = make(10);
  assert.deepEqual(chunkTranscript(t, 10000), [t]);
});

test('transkrip panjang: tiap bagian <= max, semua baris tercakup, ada overlap', () => {
  const t = make(500), max = 1500, parts = chunkTranscript(t, max, 5);
  assert.ok(parts.length > 1);
  parts.forEach(p => assert.ok(p.length <= max, `bagian ${p.length} > ${max}`));
  const seen = new Set(parts.flatMap(p => p.split('\n')));
  t.split('\n').forEach(l => assert.ok(seen.has(l), 'baris hilang: ' + l));
  const last = parts[0].split('\n').slice(-1)[0];
  assert.ok(parts[1].split('\n').includes(last), 'bagian berurutan harus overlap');
});

test('baris tunggal lebih panjang dari max tidak membuat loop tak berujung', () => {
  const t = ['[0] ' + 'x'.repeat(300), '[5] pendek', '[10] pendek lagi'].join('\n');
  const parts = chunkTranscript(t, 100, 2);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].startsWith('[0] xxx'), 'baris panjang tetap dimasukkan utuh');
  assert.ok(parts[1].includes('[10] pendek lagi'));
});

const clip = (s, e, score) => ({ segs: [{ start: s, end: e }], score });

test('dedupe: yang tumpang tindih >50% dibuang, skor tertinggi menang', () => {
  const r = dedupeClips([clip(0, 30, 70), clip(5, 35, 90), clip(100, 130, 60)]);
  assert.deepEqual(r.map(c => c.score), [90, 60]);
});

test('dedupe: overlap kecil dipertahankan', () => {
  assert.equal(dedupeClips([clip(0, 30, 80), clip(28, 58, 70)]).length, 2);
});

test('dedupe: klip multi-segmen dihitung per segmen', () => {
  const a = { segs: [{ start: 0, end: 10 }, { start: 50, end: 60 }], score: 80 };
  const b = { segs: [{ start: 52, end: 60 }], score: 70 }; // 8 dari 8 detik tumpang tindih dengan a
  assert.equal(dedupeClips([a, b]).length, 1);
});

test('dedupe tidak mengubah array masukan', () => {
  const input = [clip(0, 10, 1), clip(0, 10, 2)];
  dedupeClips(input); assert.equal(input[0].score, 1);
});
