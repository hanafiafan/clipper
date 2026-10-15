// node --test test/zip.test.js: the streamed archive must be readable by a real unzip implementation, with the original bytes.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { zipTo, crc32 } = require('../lib/zip');

test('crc32 matches the known check value', () => assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926));

test('zipTo writes a valid archive', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')), big = Buffer.alloc(300000, 'abc'), small = Buffer.from('halo dunia');
  fs.writeFileSync(path.join(dir, 'a.bin'), big); fs.writeFileSync(path.join(dir, 'b.txt'), small);
  const zip = path.join(dir, 'out.zip');
  await zipTo(fs.createWriteStream(zip), [{ name: 'klip satu.mp4', file: path.join(dir, 'a.bin') }, { name: 'b.txt', file: path.join(dir, 'b.txt') }]);
  let py; try { execFileSync('python3', ['--version']); py = true; } catch { py = false; }
  if (!py) return t.skip('python3 tidak ada untuk memeriksa arsip');
  const script = 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(z.namelist()));sys.stdout.write(z.read("b.txt").decode());print();print(len(z.read("klip satu.mp4")))';
  const [names, txt, len] = execFileSync('python3', ['-I', '-c', script, zip]).toString().trim().split('\n');
  assert.equal(names, 'klip satu.mp4|b.txt'); assert.equal(txt, 'halo dunia'); assert.equal(+len, big.length);
});
