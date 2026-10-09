// Hellens Clipper: upload / YouTube URL -> cut -> vertical clip. Zero npm deps; needs ffmpeg + yt-dlp on PATH.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFile } = require('child_process');
// Writable data root — set KLIP_DATA when packaged (app folder is read-only); defaults to this dir in dev.
const DATA = process.env.KLIP_DATA || __dirname;
const WORK = path.join(DATA, 'work'), OUT = path.join(DATA, 'out'), LOGOS = path.join(DATA, 'logos'), MEDIA = path.join(DATA, 'media'), DL = path.join(DATA, 'downloads');
const PORT = process.env.PORT || 3002;
[WORK, OUT, LOGOS, MEDIA, DL].forEach(d => fs.mkdirSync(d, { recursive: true }));
const BACKEND_MODULES = path.join(__dirname, '..', 'backend', 'node_modules'); // reuse sibling puppeteer + Chrome

// Dimensions + formats ported from backend/utils/resolution.js (sama persis)
const RES = {
  '360p': { '9:16': [360, 640], '3:4': [360, 480], '1:1': [360, 360], '16:9': [640, 360] },
  '480p': { '9:16': [480, 854], '3:4': [480, 640], '1:1': [480, 480], '16:9': [854, 480] },
  '720p': { '9:16': [720, 1280], '3:4': [720, 960], '1:1': [720, 720], '16:9': [1280, 720] },
  '1080p': { '9:16': [1080, 1920], '3:4': [1080, 1440], '1:1': [1080, 1080], '16:9': [1920, 1080] },
  '1440p': { '9:16': [1440, 2560], '3:4': [1440, 1920], '1:1': [1440, 1440], '16:9': [2560, 1440] },
  '4k': { '9:16': [2160, 3840], '3:4': [2160, 2880], '1:1': [2160, 2160], '16:9': [3840, 2160] },
};
// name -> [aspectRatio, fit]. fit: crop | blur | pad | original | psquare (full list mirrors backend/server.js formats)
const FORMATS = {
  'original': [null, 'original'],
  'raw-cuts': ['16:9', 'pad'],
  'landscape-16-9': ['16:9', 'pad'],
  'landscape-blur': ['16:9', 'blur'],
  'center-crop': ['9:16', 'crop'],
  'stacked-blur': ['9:16', 'blur'],
  'portrait-square': ['9:16', 'psquare'],   // 9:16 w/ centered 1:1 + blurred bg
  'portrait-3-4': ['3:4', 'crop'],           // = ig-post-crop
  'ig-post-crop': ['3:4', 'crop'],
  'ig-post-blur': ['3:4', 'blur'],
  'square-zoom': ['1:1', 'crop'],
  'square-blur': ['1:1', 'blur'],
};
// One generator for every aspect/fit -> ffmpeg vf or filter_complex.
// focal={x,y} (%) => face-track zoom (formula from backend/server.js:2749).
// motion (blur only): true = live blurred bg follows video (-motion); false = frozen first-frame bg (static).
// ponytail: skipped split-face-track (needs 2-speaker split render).
function videoFilter(format, res, focal, motion = true) {
  let [ar, fit] = FORMATS[format];
  if (fit === 'original') return null; // 'Asli' has no target aspect to zoom into
  if (focal && fit !== 'psquare') fit = 'crop'; // face-track forces a zoom-crop (except the stacked psquare layout)
  const [w, h] = RES[res][ar];
  if (fit === 'psquare') { // 9:16: centered square (w×w) foreground over blurred cover background
    return `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=25:15[bg];` +
           `[b]scale=${w}:${w}:force_original_aspect_ratio=increase,crop=${w}:${w}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1`;
  }
  if (fit === 'crop') {
    if (focal) { const fx = Math.max(10, Math.min(90, focal.x)), fy = Math.max(10, Math.min(90, focal.y));
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:iw*${fx / 100}-${w / 2}:ih*${fy / 100}-${h / 2}`; }
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  if (fit === 'pad') return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  // blur: cover+blur background (boxblur=25:15 per source), fit foreground centered.
  const freeze = motion ? '' : ',trim=end_frame=1,loop=-1:1:0,setpts=N/FRAME_RATE/TB'; // static: loop frozen first frame
  return `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}${freeze},boxblur=25:15[bg];` +
         `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1`;
}
// Flexible builder: aspect (9:16/3:4/1:1/16:9), fill (crop|fit), bg ('blur' | '#RRGGBB') when fit. focal overrides to crop.
function buildSpec(aspect, fill, bg, res, focal, motion = true) {
  if (!aspect || !RES[res][aspect]) return null;
  const [w, h] = RES[res][aspect];
  if (fill === 'crop' || focal) {
    if (focal) { const fx = Math.max(10, Math.min(90, focal.x)), fy = Math.max(10, Math.min(90, focal.y));
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:iw*${fx / 100}-${w / 2}:ih*${fy / 100}-${h / 2}`; }
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  if (typeof bg === 'string' && /^#?[0-9a-fA-F]{6}$/.test(bg)) { // fit with solid color background
    const col = '0x' + bg.replace('#', '');
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${col}`;
  }
  const freeze = motion ? '' : ',trim=end_frame=1,loop=-1:1:0,setpts=N/FRAME_RATE/TB'; // fit + blur bg
  return `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}${freeze},boxblur=25:15[bg];` +
         `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1`;
}
const MODEL = process.env.WHISPER_MODEL || path.join(__dirname, 'models', 'ggml-base.bin');
// "auto" tetap aman untuk video multibahasa; set WHISPER_LANGUAGE=id untuk video berbahasa Indonesia agar akurasi naik.
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || 'auto';
const FONTSDIR = path.join(__dirname, 'fonts');
const BOLD_FONT = path.join(FONTSDIR, 'THEBOLDFONT-FREEVERSION.ttf');
// Caption presets (fonts bundled from the project). ASS force_style; sizes tuned for SRT PlayRes ~288.
// ponytail: per-word karaoke highlight is stubbed in the source too; these style the whole phrase.
const PRESETS = {
  karaoke: 'FontName=Komika Axis,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Bold=1,Alignment=2,MarginV=50',
  beasty: 'FontName=THE BOLD FONT,FontSize=16,PrimaryColour=&H0000D5FF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Bold=1,Alignment=2,MarginV=50',
  simple: 'FontName=Arial,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H66000000,BorderStyle=3,Outline=0,Shadow=0,Alignment=2,MarginV=45',
  impact: 'FontName=THE BOLD FONT,FontSize=17,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=4,Shadow=2,Bold=1,Alignment=2,MarginV=50',
  clean: 'FontName=Arial,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Bold=1,Alignment=2,MarginV=50',
  boxed: 'FontName=Arial,FontSize=11,PrimaryColour=&H00000000,OutlineColour=&H00000000,BackColour=&H00FFFFFF,BorderStyle=3,Outline=0,Shadow=0,Bold=1,Alignment=2,MarginV=45',
};
const run = (cmd, args, cwd) => new Promise((ok, no) =>
  execFile(cmd, args, { cwd, maxBuffer: 1 << 26 }, (e, _o, err) => e ? no(new Error(err.slice(-300) || e.message)) : ok()));
const runOut = (cmd, args) => new Promise((ok, no) => // like run but returns stdout
  execFile(cmd, args, { maxBuffer: 1 << 24 }, (e, out, err) => e ? no(new Error((err || e.message).slice(-300))) : ok(out)));
// Render a rounded pill badge (text+emoji) to a transparent PNG via headless Chrome (scripts/badge.js).
const renderBadge = (outPng, cfg) => new Promise((ok, no) =>
  execFile(process.execPath, [path.join(__dirname, 'scripts', 'badge.js'), outPng, JSON.stringify(cfg)],
    { env: { ...process.env, NODE_PATH: BACKEND_MODULES }, maxBuffer: 1 << 24 },
    (e, _o, err) => e ? no(new Error('badge render gagal: ' + (err || e.message).slice(-200))) : ok()));
// Transcribe [s,e] of src to <OUT>/<name>.srt (times relative to clip start); returns false if no speech.
async function transcribe(src, s, e, name) {
  const wav = path.join(WORK, name + '.wav');
  await run('ffmpeg', ['-y', '-ss', String(s), '-to', String(e), '-i', src, '-vn', '-af', 'highpass=f=80,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '16000', '-ac', '1', wav]);
  await run('whisper-cli', ['-m', MODEL, '-f', wav, '-l', WHISPER_LANGUAGE, '-osrt', '-of', path.join(OUT, name), '-ml', '32', '-sow']);
  fs.unlinkSync(wav);
  return fs.statSync(path.join(OUT, name + '.srt')).size > 0;
}
// Per-word timing via whisper (-ml 1 -sow): parse the one-word-per-cue SRT. Returns [{t0,t1,text}] relative to clip.
async function transcribeWords(src, s, e, name) {
  const wav = path.join(WORK, name + '.w.wav'), out = path.join(OUT, name + '.w');
  await run('ffmpeg', ['-y', '-ss', String(s), '-to', String(e), '-i', src, '-vn', '-af', 'highpass=f=80,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '16000', '-ac', '1', wav]);
  await run('whisper-cli', ['-m', MODEL, '-f', wav, '-l', WHISPER_LANGUAGE, '-osrt', '-of', out, '-ml', '1', '-sow']);
  fs.unlinkSync(wav);
  const sec = t => { const [h, m, x] = t.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +x; };
  const words = fs.readFileSync(out + '.srt', 'utf8').trim().split(/\n\n+/).map(b => {
    const [, time, ...txt] = b.split('\n'); if (!time) return null;
    const [a, z] = time.split(' --> '); return { t0: sec(a), t1: sec(z), text: txt.join(' ').trim() };
  }).filter(w => w && w.text);
  fs.unlinkSync(out + '.srt');
  return words;
}
const assTime = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = (s % 60).toFixed(2); return `${h}:${String(m).padStart(2, '0')}:${x.padStart(5, '0')}`; };
const hexAss = h => h && h.startsWith('#') ? '&H00' + h.slice(5, 7) + h.slice(3, 5) + h.slice(1, 3) : '&H00FFFFFF';
// Karaoke styles per preset (highlight colors mirror backend/lib/captionToFfmpeg.js PRESETS).
const KSTYLE = {
  karaoke: { font: 'Komika Axis', factor: 0.06, bold: -1, outline: 3, hl: '#00FF66' },
  beasty:  { font: 'THE BOLD FONT', factor: 0.07, bold: -1, outline: 4, hl: '#FFB800' },
  simple:  { font: 'Arial', factor: 0.05, bold: 0, outline: 2, hl: '#FFD400' },
  impact:  { font: 'THE BOLD FONT', factor: 0.075, bold: -1, outline: 5, hl: '#FF542B' },
  clean:   { font: 'Arial', factor: 0.052, bold: -1, outline: 2, hl: '#FF542B' },
  boxed:   { font: 'Arial', factor: 0.048, bold: -1, outline: 1, hl: '#FF542B' },
};
// Build an ASS file: each word is one event showing its line with the active word colored (true per-word highlight).
function buildKaraokeAss(words, presetId, w, h, opts = {}) {
  const k = KSTYLE[presetId] || KSTYLE.karaoke;
  const scale = { small: .82, medium: 1, large: 1.22 }[opts.size] || 1;
  const size = Math.round(h * k.factor * scale), pos = ['top', 'center', 'bottom'].includes(opts.position) ? opts.position : 'bottom';
  const alignment = { top: 8, center: 5, bottom: 2 }[pos], marginV = Math.round(h * (pos === 'bottom' ? .12 : .08));
  const highlight = /^#[0-9a-fA-F]{6}$/.test(opts.color || '') ? opts.color : k.hl;
  const lines = []; let cur = [];
  const flush = () => { if (cur.length) { lines.push(cur); cur = []; } };
  for (let i = 0; i < words.length; i++) { // group into short lines for readability
    cur.push(words[i]);
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0), gap = words[i + 1] ? words[i + 1].t0 - words[i].t1 : 0;
    if (cur.length >= 4 || chars >= 24 || gap > 0.7) flush();
  }
  flush();
  const esc = t => t.replace(/[{}\\]/g, '').replace(/\n/g, ' ');
  const WHITE = '&H00FFFFFF';
  const events = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const start = line[i].t0, end = i + 1 < line.length ? line[i + 1].t0 : line[i].t1; // continuous within line
      const text = line.map((wd, j) => j === i ? `{\\c${hexAss(highlight)}}${esc(wd.text)}{\\c${WHITE}}` : esc(wd.text)).join(' ');
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},K,,0,0,0,,${text}`);
    }
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: K,${k.font},${size},${WHITE},&H00000000,&H66000000,${k.bold},1,${k.outline},0,${alignment},40,40,${marginV},1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${events.join('\n')}`;
}
// Full-video transcript as "[sec] text" lines (cached as work/<id>.srt).
async function fullTranscript(id) {
  const srt = path.join(WORK, id + '.srt'), wav = path.join(WORK, id + '.wav');
  if (!fs.existsSync(srt)) {
    await run('ffmpeg', ['-y', '-i', path.join(WORK, id + '.mp4'), '-ar', '16000', '-ac', '1', wav]);
    await run('whisper-cli', ['-m', MODEL, '-f', wav, '-l', WHISPER_LANGUAGE, '-osrt', '-of', path.join(WORK, id)]);
    fs.unlinkSync(wav);
  }
  const sec = t => { const [h, m, x] = t.replace(',', '.').split(':'); return Math.round(h * 3600 + m * 60 + +x); };
  return fs.readFileSync(srt, 'utf8').trim().split(/\n\n+/).map(b => {
    const [, time, ...txt] = b.split('\n'); return time ? `[${sec(time.split(' --> ')[0])}] ${txt.join(' ').trim()}` : '';
  }).filter(Boolean).join('\n');
}
// Providers ported from backend/models/*. OpenAI/Groq/Mistral/Deepseek share the OpenAI chat API.
const PROVIDERS = {
  gemini:   { env: 'GEMINI_API_KEY',    model: 'gemini-2.5-flash' },
  openai:   { env: 'OPENAI_API_KEY',    model: 'gpt-4o',                    base: 'https://api.openai.com/v1' },
  claude:   { env: 'ANTHROPIC_API_KEY', model: 'claude-3-5-sonnet-20241022' },
  groq:     { env: 'GROQ_API_KEY',      model: 'llama-3.1-70b-versatile',   base: 'https://api.groq.com/openai/v1' },
  mistral:  { env: 'MISTRAL_API_KEY',   model: 'mistral-large-latest',      base: 'https://api.mistral.ai/v1' },
  deepseek: { env: 'DEEPSEEK_API_KEY',  model: 'deepseek-chat',             base: 'https://api.deepseek.com/v1' },
};
// API keys: env var OR saved via UI (DATA/keys.json). Local single-user app -> plaintext local store is fine.
const KEYS_FILE = path.join(DATA, 'keys.json');
let apiKeys = (() => { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return {}; } })();
const keyFor = id => process.env[PROVIDERS[id].env] || apiKeys[id];
const availableProviders = () => Object.keys(PROVIDERS).filter(keyFor);
// Validate a key with a cheap GET (list models) against the provider; returns {ok} or {ok:false,error}.
async function testKey(id, key) {
  const p = PROVIDERS[id];
  let r;
  if (id === 'gemini') r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': key } });
  else if (id === 'claude') r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
  else r = await fetch(p.base + '/models', { headers: { authorization: 'Bearer ' + key } });
  if (r.ok) return { ok: true };
  let msg = 'HTTP ' + r.status; try { const j = await r.json(); msg = j.error?.message || j.error || msg; } catch {}
  return { ok: false, error: msg };
}
async function askLLM(prompt, provider) {
  const avail = availableProviders();
  const id = provider && avail.includes(provider) ? provider : avail[0];
  if (!id) throw new Error('Set salah satu API key: ' + Object.values(PROVIDERS).map(p => p.env).join(', '));
  const p = PROVIDERS[id], key = keyFor(id), model = process.env[id.toUpperCase() + '_MODEL'] || p.model;
  let r, j;
  if (id === 'gemini') {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) });
    j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Gemini error ' + r.status);
    return j.candidates[0].content.parts[0].text;
  }
  if (id === 'claude') {
    r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
    j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Claude error ' + r.status);
    return j.content[0].text;
  }
  // OpenAI-compatible (openai, groq, mistral, deepseek)
  r = await fetch(p.base + '/chat/completions', { method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }) });
  j = await r.json(); if (!r.ok) throw new Error(j.error?.message || id + ' error ' + r.status);
  return j.choices[0].message.content;
}
const PROMPT = t => `Kamu editor video short-form. Dari transkrip ber-timestamp (detik) di bawah, pilih 3-5 momen paling menarik/viral (hook kuat, utuh, bisa dipahami tanpa konteks), masing-masing 15-60 detik, mulai dan berakhir di batas kalimat.
Untuk tiap momen estimasi posisi wajah pembicara utama untuk zoom (face_x,face_y dalam persen 0-100; wajah tunggal biasanya 50,40).
Balas HANYA JSON array: [{"start":detik,"end":detik,"title":"judul singkat","reason":"alasan","face_x":50,"face_y":40}]. Judul dan alasan dalam bahasa transkrip.

${t}`;
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(ok => { let s = ''; req.on('data', c => s += c); req.on('end', () => ok(JSON.parse(s || '{}'))); });
const newId = () => crypto.randomBytes(6).toString('hex');
const HIST = path.join(DATA, 'history.json');
// ponytail: naive read-modify-write; fine for single local user, add a lock if clips run in parallel.
const readHist = () => { try { return JSON.parse(fs.readFileSync(HIST, 'utf8')); } catch { return []; } };
const writeHist = h => fs.writeFileSync(HIST, JSON.stringify(h, null, 2));
const serve = (res, dir, name) => { // basename blocks ../ traversal
  const f = path.join(dir, path.basename(name));
  fs.existsSync(f) ? (res.writeHead(200), fs.createReadStream(f).pipe(res)) : json(res, 404, { error: 'not found' });
};

const jobs = {}; // in-memory auto-pilot jobs. ponytail: fine for single local user; use a store if multi-user.
const scoreGrade = s => s == null ? null : s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 55 ? 'C' : 'D';
const AUTO_PROMPT = t => `Kamu editor short-form viral (gaya Opus Clip / Klipper). Dari transkrip ber-timestamp (detik) di bawah, pilih 3-6 momen paling berpotensi viral sebagai klip mandiri (hook kuat di 3 detik awal, utuh, bisa dipahami tanpa konteks), masing-masing 15-60 detik, mulai & berakhir di batas kalimat.
Untuk tiap klip hasilkan paket siap-posting:
- "timelines": array {start,end} dalam DETIK. Boleh beberapa potongan non-berurutan yang digabung jadi satu klip (buang bagian membosankan di tengah). Minimal satu.
- "title": judul menarik; "hook": teks badge 2-4 kata untuk ditempel di video; "description": caption 1-2 kalimat siap posting.
- "hashtags": 6-10 hashtag relevan (campur populer & niche), tiap item diawali '#'.
- "score": 0-100 potensi viral; "reason": alasan singkat; "face_x","face_y": posisi wajah pembicara utama (persen 0-100; wajah tunggal ~50,40).
Balas HANYA JSON array: [{"timelines":[{"start":0,"end":30}],"title":"...","hook":"...","description":"...","hashtags":["#a","#b"],"score":0-100,"reason":"...","face_x":50,"face_y":40}]. title/hook/description/reason/hashtags dalam bahasa transkrip.

${t}`;
// Concatenate non-contiguous segments of a source into one clip (video+audio), return the new work id.
async function concatSegments(srcId, segs) {
  const out = newId(), n = segs.length;
  const pre = segs.map((s, i) => `[0:v]trim=${+s.start}:${+s.end},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=${+s.start}:${+s.end},asetpts=PTS-STARTPTS[a${i}]`).join(';');
  const lab = segs.map((_, i) => `[v${i}][a${i}]`).join('');
  const fc = `${pre};${lab}concat=n=${n}:v=1:a=1[v][a]`;
  await run('ffmpeg', ['-y', '-i', path.join(WORK, srcId + '.mp4'), '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', path.join(WORK, out + '.mp4')]);
  return out;
}

// Render one clip (shared by /clip and /auto). p has resolved params; returns the history record.
async function makeClip(p) {
  const { id, start: s, end: e, mode, resolution, captions, preset, wordByWord, captionPosition, captionSize, captionColor, motion, logo, sticker, focal, meta, aspect, fill, bg } = p;
  const useSpec = aspect && RES[resolution][aspect];          // flexible aspect+fill+bg path
  const arKey = useSpec ? aspect : (FORMATS[mode][0] || '9:16');
  const isColorBg = useSpec && fill === 'fit' && typeof bg === 'string' && /^#?[0-9a-fA-F]{6}$/.test(bg);
  const isBlur = useSpec ? (fill === 'fit' && !isColorBg) : (FORMATS[mode] && FORMATS[mode][1] === 'blur');
  const modeTag = useSpec ? `${aspect.replace(':', 'x')}-${fill}${isColorBg ? 'col' : (isBlur ? 'blur' : '')}` : mode;
  const modeLabel = useSpec ? `${aspect} ${fill}${fill === 'fit' ? (isColorBg ? ' warna' : ' blur') : ''}` : mode;
  const focalOn = focal && Number.isFinite(+focal.x) && Number.isFinite(+focal.y);
  const stickerText = sticker && typeof sticker.text === 'string' && sticker.text.trim();
  let stickerMedia = null;
  if (sticker && /^[a-f0-9]{12}$/.test(sticker.mediaId || '') && /^(png|gif|webp|jpg|jpeg)$/.test(sticker.ext || '')) {
    const pth = path.join(MEDIA, sticker.mediaId + '.' + sticker.ext); if (fs.existsSync(pth)) stickerMedia = pth;
  }
  const stickerOn = !!(stickerText || stickerMedia);
  let logoPath = null;
  if (logo && /^[a-f0-9]{12}$/.test(logo.id || '')) { const pth = path.join(LOGOS, logo.id + '.png'); if (fs.existsSync(pth)) logoPath = pth; }
  const base = `${id}_${s}-${e}_${modeTag}${isBlur && !motion ? 'S' : ''}_${resolution}${focalOn ? '_ft' : ''}${captions ? '_cc_' + preset + (wordByWord ? 'W' : '') : ''}${logoPath ? '_logo' : ''}${stickerOn ? '_stk' : ''}`, src = path.join(WORK, id + '.mp4');

  const [w, h] = RES[resolution][arKey];
  const steps = []; let label = '[0:v]';
  const vf = useSpec ? buildSpec(aspect, fill, bg, resolution, focalOn ? { x: +focal.x, y: +focal.y } : null, motion)
                     : videoFilter(mode, resolution, focalOn ? { x: +focal.x, y: +focal.y } : null, motion);
  if (vf) { steps.push(vf.startsWith('[0:v]') ? vf + '[vb]' : `[0:v]${vf}[vb]`); label = '[vb]'; }
  if (captions && wordByWord) {
    const words = await transcribeWords(src, s, e, base);
    if (words.length) { fs.writeFileSync(path.join(OUT, base + '.ass'), buildKaraokeAss(words, preset, w, h, { position: captionPosition, size: captionSize, color: captionColor }));
      steps.push(`${label}subtitles=${base}.ass:fontsdir='${FONTSDIR}'[vc]`); label = '[vc]'; }
  } else if (captions && await transcribe(src, s, e, base)) {
    const scale = { small: .82, medium: 1, large: 1.22 }[captionSize] || 1;
    const alignment = { top: 8, center: 5, bottom: 2 }[captionPosition] || 2;
    let style = PRESETS[preset].replace(/FontSize=(\d+)/, (_, n) => 'FontSize=' + Math.round(+n * scale)).replace(/Alignment=\d+/, 'Alignment=' + alignment);
    if (/^#[0-9a-fA-F]{6}$/.test(captionColor || '')) style = style.replace(/PrimaryColour=[^,]+/, 'PrimaryColour=' + hexAss(captionColor));
    steps.push(`${label}subtitles=${base}.srt:fontsdir='${FONTSDIR}':force_style='${style}'[vc]`); label = '[vc]';
  }
  const inputs = ['-i', src]; let nIn = 1;
  if (logoPath) {
    const sc = Math.round(w * ((logo.scale ?? 25) / 100)), px = Math.round(w * ((logo.x ?? 5) / 100)), py = Math.round(h * ((logo.y ?? 5) / 100));
    const op = Math.min(1, Math.max(0, logo.opacity ?? 1)); inputs.push('-i', logoPath); const idx = nIn++;
    steps.push(`[${idx}:v]scale=${sc}:-1,format=rgba${op < 1 ? `,colorchannelmixer=aa=${op.toFixed(2)}` : ''}[lg];${label}[lg]overlay=${px}:${py}:format=auto[vl]`); label = '[vl]';
  }
  if (stickerOn) {
    const sx = sticker.x ?? 50, sy = sticker.y ?? (stickerText ? 80 : 20);
    const en = sticker.duration > 0 ? `:enable='between(t,0,${+sticker.duration})'` : ''; // show hook only first N seconds
    if (stickerText) {
      const png = path.join(OUT, base + '.stk.png');
      await renderBadge(png, { text: sticker.text.trim(), color: sticker.color || '#FFFFFF', bg: sticker.bg || '#FF3B30',
        size: Math.round(h * ((sticker.size ?? 5) / 100)), rounded: sticker.rounded !== false, fontFile: BOLD_FONT, maxW: w });
      inputs.push('-i', png); const idx = nIn++;
      steps.push(`[${idx}:v]format=rgba[stk];${label}[stk]overlay=(main_w*${sx}/100)-(overlay_w/2):(main_h*${sy}/100)-(overlay_h/2):format=auto${en}[vk]`); label = '[vk]';
    } else {
      const sc = Math.round(w * ((sticker.scale ?? 20) / 100)), gif = sticker.ext === 'gif';
      if (gif) inputs.push('-ignore_loop', '0');
      inputs.push('-i', stickerMedia); const idx = nIn++;
      steps.push(`[${idx}:v]scale=${sc}:-1,format=rgba[stk];${label}[stk]overlay=(main_w*${sx}/100)-(overlay_w/2):(main_h*${sy}/100)-(overlay_h/2):format=auto${gif ? ':shortest=1' : ''}${en}[vk]`); label = '[vk]';
    }
  }
  const fc = steps.join(';');
  await run('ffmpeg', ['-y', '-ss', String(s), '-to', String(e), ...inputs,
    ...(fc ? ['-filter_complex', fc, '-map', label, '-map', '0:a?'] : []),
    '-t', String(e - s), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', path.join(OUT, base + '.mp4')], OUT);
  const subFile = captions ? (wordByWord ? `/out/${base}.ass` : `/out/${base}.srt`) : null;
  const rec = { key: base, time: new Date().toISOString(), url: `/out/${base}.mp4`, srt: subFile, source: id, mode: modeLabel, resolution,
    preset: captions ? preset : null, word: wordByWord, logo: !!logoPath, sticker: !!stickerOn, focal: focalOn, motion: isBlur ? motion : null, ...(meta || {}) };
  const hist = readHist().filter(r => r.key !== base); hist.unshift(rec); writeHist(hist);
  return rec;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && u.pathname === '/') { res.setHeader('Cache-Control', 'no-store'); return serve(res, fs.existsSync(path.join(__dirname, 'dist/index.html')) ? path.join(__dirname, 'dist') : __dirname, 'index.html'); }
    if (req.method === 'GET' && u.pathname.startsWith('/assets/')) { res.setHeader('Content-Type', u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css'); return serve(res, path.join(__dirname, 'dist', 'assets'), u.pathname.slice(8)); }
    if (req.method === 'GET' && u.pathname.startsWith('/src/')) return serve(res, WORK, u.pathname.slice(5));
    if (req.method === 'GET' && u.pathname.startsWith('/out/')) return serve(res, OUT, u.pathname.slice(5));
    if (req.method === 'GET' && u.pathname.startsWith('/brand/')) return serve(res, path.join(__dirname, 'brand'), u.pathname.slice(7));
    if (req.method === 'GET' && u.pathname.startsWith('/fonts/')) return serve(res, FONTSDIR, u.pathname.slice(7));
    if (req.method === 'GET' && u.pathname.startsWith('/logos/')) return serve(res, LOGOS, u.pathname.slice(7));
    if (req.method === 'GET' && u.pathname === '/logos')
      return json(res, 200, { logos: fs.readdirSync(LOGOS).filter(f => f.endsWith('.png')).map(f => ({ id: f.slice(0, -4), url: '/logos/' + f })) });
    if (req.method === 'POST' && u.pathname === '/logos') { // raw PNG body
      const id = newId(); await new Promise((ok, no) => req.pipe(fs.createWriteStream(path.join(LOGOS, id + '.png'))).on('finish', ok).on('error', no));
      return json(res, 200, { id, url: '/logos/' + id + '.png' });
    }
    if (req.method === 'GET' && u.pathname.startsWith('/media/')) return serve(res, MEDIA, u.pathname.slice(7));
    if (req.method === 'POST' && u.pathname === '/media') { // raw image/gif body; ext via ?ext=
      const ext = (u.searchParams.get('ext') || 'png').toLowerCase();
      if (!/^(png|gif|webp|jpg|jpeg)$/.test(ext)) return json(res, 400, { error: 'bad ext' });
      const id = newId(); await new Promise((ok, no) => req.pipe(fs.createWriteStream(path.join(MEDIA, id + '.' + ext))).on('finish', ok).on('error', no));
      return json(res, 200, { id, ext, url: `/media/${id}.${ext}` });
    }

    if (req.method === 'POST' && u.pathname === '/upload') { // raw body, no multipart
      const id = newId(); await new Promise((ok, no) => req.pipe(fs.createWriteStream(path.join(WORK, id + '.mp4'))).on('finish', ok).on('error', no));
      return json(res, 200, { id });
    }
    if (req.method === 'POST' && u.pathname === '/yt') {
      const { url } = await body(req);
      if (!/^https?:\/\//.test(url || '')) return json(res, 400, { error: 'bad url' });
      const id = newId();
      await run('yt-dlp', ['-f', 'bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4', '-o', path.join(WORK, id + '.mp4'), '--', url]);
      return json(res, 200, { id });
    }
    // --- Standalone YouTube downloader (full video / MP3 audio) ---
    if (req.method === 'GET' && u.pathname.startsWith('/downloads/')) return serve(res, DL, u.pathname.slice(11));
    if (req.method === 'GET' && u.pathname === '/yt-info') {
      const url = u.searchParams.get('url') || '';
      if (!/^https?:\/\//.test(url)) return json(res, 400, { error: 'bad url' });
      try { const out = await runOut('yt-dlp', ['--no-warnings', '--print', '%(title)s', '--skip-download', '--', url]);
        return json(res, 200, { title: out.trim().split('\n')[0] || 'video' }); }
      catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (req.method === 'POST' && u.pathname === '/download') {
      const { url, kind = 'video', quality = '1080' } = await body(req);
      if (!/^https?:\/\//.test(url || '')) return json(res, 400, { error: 'bad url' });
      if (!['video', 'audio'].includes(kind)) return json(res, 400, { error: 'bad kind' });
      if (!/^(best|2160|1440|1080|720|480|360)$/.test(String(quality))) return json(res, 400, { error: 'bad quality' });
      const id = newId();
      const name = (await runOut('yt-dlp', ['--no-warnings', '--print', '%(title)s', '--skip-download', '--', url]).catch(() => '')).trim().split('\n')[0];
      const safe = (name || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'video';
      const args = kind === 'audio'
        ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', path.join(DL, id + '.%(ext)s'), '--', url]
        : ['-f', quality === 'best' ? 'bv*+ba/b' : `bv*[height<=${quality}]+ba/b`, '--merge-output-format', 'mp4', '-o', path.join(DL, id + '.%(ext)s'), '--', url];
      await run('yt-dlp', args);
      const file = fs.readdirSync(DL).find(f => f.startsWith(id + '.'));
      if (!file) return json(res, 500, { error: 'unduhan tidak ditemukan' });
      const ext = file.split('.').pop();
      return json(res, 200, { url: '/downloads/' + file, name: `${safe}.${ext}`, kind, quality });
    }
    if (req.method === 'GET' && u.pathname === '/providers') return json(res, 200, { providers: availableProviders() });
    if (req.method === 'GET' && u.pathname === '/keys') // report which providers are set + source (never the key value)
      return json(res, 200, { all: Object.keys(PROVIDERS), set: availableProviders(), env: Object.keys(PROVIDERS).filter(p => process.env[PROVIDERS[p].env]) });
    if (req.method === 'POST' && u.pathname === '/keys') {
      const { provider, key } = await body(req);
      if (!(provider in PROVIDERS)) return json(res, 400, { error: 'provider tidak dikenal' });
      if (key && String(key).trim()) apiKeys[provider] = String(key).trim(); else delete apiKeys[provider];
      try { fs.writeFileSync(KEYS_FILE, JSON.stringify(apiKeys, null, 2)); } catch (e) { return json(res, 500, { error: e.message }); }
      return json(res, 200, { set: availableProviders() });
    }
    if (req.method === 'POST' && u.pathname === '/keys/test') { // verify a key against the provider
      const { provider, key } = await body(req);
      if (!(provider in PROVIDERS)) return json(res, 400, { error: 'provider tidak dikenal' });
      const k = (key && String(key).trim()) || keyFor(provider);
      if (!k) return json(res, 200, { ok: false, error: 'belum ada key' });
      try { return json(res, 200, await testKey(provider, k)); }
      catch (e) { return json(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && u.pathname === '/suggest') {
      const { id, provider } = await body(req);
      if (!/^[a-f0-9]{12}$/.test(id || '')) return json(res, 400, { error: 'bad id' });
      const txt = await askLLM(PROMPT(await fullTranscript(id)), provider);
      const clips = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1))
        .filter(c => c.start >= 0 && c.end > c.start).slice(0, 5);
      return json(res, 200, { clips });
    }
    if (req.method === 'GET' && u.pathname === '/history') return json(res, 200, { history: readHist() });
    if (req.method === 'DELETE' && u.pathname.startsWith('/history/')) {
      const key = decodeURIComponent(u.pathname.slice(9));
      const h = readHist(); const rec = h.find(r => r.key === key);
      if (rec) { for (const ext of ['.mp4', '.srt', '.ass', '.stk.png']) { const f = path.join(OUT, path.basename(key) + ext); if (fs.existsSync(f)) fs.unlinkSync(f); } writeHist(h.filter(r => r.key !== key)); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/clip') {
      const p = await body(req);
      const resolution = p.resolution || '720p', preset = p.preset || 'karaoke';
      const useSpec = p.aspect && RES[resolution] && RES[resolution][p.aspect];
      const mode = p.mode || 'center-crop';
      const s = Number(p.start), e = Number(p.end);
      if (!/^[a-f0-9]{12}$/.test(p.id) || !(s >= 0) || !(e > s) || !(resolution in RES) || !(preset in PRESETS) || (!useSpec && !(mode in FORMATS))) return json(res, 400, { error: 'bad input' });
      const rec = await makeClip({ id: p.id, start: s, end: e, mode, aspect: useSpec ? p.aspect : null, fill: p.fill, bg: p.bg, resolution, captions: !!p.captions, preset,
        wordByWord: !!p.wordByWord, captionPosition: p.captionPosition, captionSize: p.captionSize, captionColor: p.captionColor,
        motion: p.motion !== false, logo: p.logo, sticker: p.sticker, focal: p.focal });
      return json(res, 200, rec);
    }
    // --- Auto-pilot: 1 URL -> beberapa short ber-grade, siap posting ---
    if (req.method === 'POST' && u.pathname === '/auto') {
      const p = await body(req);
      const resolution = p.resolution || '1080p', preset = p.preset || 'karaoke';
      const useSpec = p.aspect && RES[resolution] && RES[resolution][p.aspect];
      const mode = p.mode || 'center-crop';
      if (!/^https?:\/\//.test(p.url || '') && !/^[a-f0-9]{12}$/.test(p.id || '')) return json(res, 400, { error: 'Masukkan URL YouTube atau unggah video.' });
      if (!(resolution in RES) || !(preset in PRESETS) || (!useSpec && !(mode in FORMATS))) return json(res, 400, { error: 'bad options' });
      if (!availableProviders().length) return json(res, 400, { error: 'Set API key AI (Gemini/OpenAI/…) dulu untuk analisis otomatis' });
      const jobId = newId();
      jobs[jobId] = { status: 'running', step: 'Menyiapkan…', clips: [], total: 0, done: 0 };
      json(res, 200, { jobId });
      // Jumlah klip ditentukan AI berdasarkan kepadatan momen; 6 hanya batas pengaman.
      const count = 6;
      (async () => { const J = jobs[jobId];
        try {
          const srcId = p.id || newId();
          J.step = 'Mengunduh video dari YouTube…';
          if (!p.id) await run('yt-dlp', ['-f', 'bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4', '-o', path.join(WORK, srcId + '.mp4'), '--', p.url])
            .catch(() => { throw new Error('Gagal mengunduh video (cek URL / video privat / yt-dlp).'); });
          J.step = 'Transkripsi + analisis AI (cari momen viral)…';
          const txt = await askLLM(AUTO_PROMPT(await fullTranscript(srcId)), p.provider);
          const norm = c => { const segs = (Array.isArray(c.timelines) ? c.timelines : [{ start: c.start, end: c.end }])
            .map(s => ({ start: +s.start, end: +s.end })).filter(s => s.start >= 0 && s.end > s.start);
            return segs.length ? { ...c, segs } : null; };
          let clips;
          try { clips = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)).map(norm).filter(Boolean); }
          catch { throw new Error('AI mengembalikan format tak terbaca. Coba lagi atau ganti provider.'); }
          if (!clips.length) throw new Error('AI tidak menemukan momen yang cocok di video ini.');
          clips.sort((a, b) => (b.score || 0) - (a.score || 0)); // best first
          clips = clips.slice(0, count);
          J.total = clips.length;
          for (let i = 0; i < clips.length; i++) { const c = clips[i];
            J.step = `Render klip ${i + 1}/${clips.length}: ${c.title || 'Momen'}`;
            const focal = Number.isFinite(+c.face_x) && Number.isFinite(+c.face_y) ? { x: +c.face_x, y: +c.face_y } : null;
            const hookTxt = String(c.hook || '').trim().split(/\s+/).slice(0, 4).join(' ').slice(0, 24); // ringkas: ≤4 kata / 24 char
            const hookStyles = { punch: { bg: '#FF542B', color: '#171916', rounded: false }, clean: { bg: '#F0F3ED', color: '#171916', rounded: true }, dark: { bg: '#171916', color: '#FFFFFF', rounded: false } };
            const sticker = (p.hook !== false && hookTxt) ? { text: hookTxt, y: 12, duration: 3, ...(hookStyles[p.hookStyle] || hookStyles.punch) } : null;
            let clipSrc = srcId, start = c.segs[0].start, end = c.segs[0].end;
            if (c.segs.length > 1) { clipSrc = await concatSegments(srcId, c.segs); start = 0; end = c.segs.reduce((n, s) => n + (s.end - s.start), 0); }
            const hashtags = Array.isArray(c.hashtags) ? c.hashtags.map(h => String(h).trim()).filter(Boolean).slice(0, 12) : [];
            const rec = await makeClip({ id: clipSrc, start, end, mode, aspect: useSpec ? p.aspect : null, fill: p.fill, bg: p.bg, resolution, captions: true, preset,
              wordByWord: p.wordByWord !== false, captionPosition: p.captionPosition, captionSize: p.captionSize, captionColor: p.captionColor, motion: p.motion !== false, focal, sticker,
              meta: { title: c.title || 'Momen', hook: c.hook || '', description: c.description || '', hashtags,
                reason: c.reason || '', grade: c.grade || scoreGrade(c.score), score: c.score ?? null, segments: c.segs.length } });
            J.clips.push(rec); J.done = i + 1;
          }
          J.step = 'Selesai'; J.status = 'done';
        } catch (err) { J.status = 'error'; J.error = err.message; J.failStep = J.step; }
      })();
      return;
    }
    if (req.method === 'GET' && u.pathname.startsWith('/auto/')) {
      const j = jobs[u.pathname.slice(6)]; return j ? json(res, 200, j) : json(res, 404, { error: 'job tidak ada' });
    }
    json(res, 404, { error: 'not found' });
  } catch (err) { json(res, 500, { error: err.message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`Hellens Clipper: http://localhost:${PORT}`)); // localhost only
