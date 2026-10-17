/* Studio pro tools, loaded after advanced.js:
   - background music library (upload, preview, delete) with volume and "duck under speech", for Auto, Editor and re-render
   - transcript panel in the Editor: click a line to set the start, shift-click to set the end, search the words
   - "Render ulang": render a finished clip again in another ratio, style or resolution from the stored source */
(() => {
  'use strict';
  if (window.__klipPro) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: k => { try { return JSON.parse(localStorage.getItem('hc.' + k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('hc.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
  const api = async (method, path, body, raw) => { const r = await fetch(path, { method, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) }), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Gagal (' + r.status + ')'); return d; };
  const toast = m => { const h = $('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' })), t = document.createElement('div'); t.className = 'toast'; t.textContent = m; h.append(t); setTimeout(() => t.classList.add('out'), 3800); setTimeout(() => t.remove(), 4300); };
  const mb = n => (n / 1048576).toFixed(1) + ' MB';

  /* ------------------------------------------------------------ music library + pickers */
  let library = [], music = Object.assign({ id: '', vol: 20, duck: true }, store.get('music') || {});
  const musicPicker = (pfx, withPlayer) => `<div class=musicPick>
      <div class=row style="align-items:end"><div><label class=fld for=${pfx}Music>Lagu</label><select id=${pfx}Music></select></div>
        <div style="flex:0 0 auto"><button type=button class="px mini" data-upload="${pfx}">＋ Unggah musik</button></div></div>
      <div class=row style="margin-top:10px;align-items:center"><div><label class=fld for=${pfx}MusicVol>Volume musik <b id=${pfx}MusicVolN>${music.vol}</b>%</label><input type=range id=${pfx}MusicVol min=0 max=100 step=1 value="${music.vol}"></div>
        <label class=chip style="flex:0 0 auto" title="Musik otomatis mengecil saat ada orang bicara"><input type=checkbox id=${pfx}MusicDuck ${music.duck ? 'checked' : ''}> Kecilkan saat ada suara</label></div>
      ${withPlayer ? `<audio id=${pfx}MusicAudio controls preload=none hidden></audio>` : ''}</div>`;
  const options = sel => `<option value="">Tanpa musik</option>` + library.map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)} (${esc(m.ext)})</option>`).join('');
  function fillSelects() { $$('#aMusic,#mMusic,#rrMusic').forEach(s => { const cur = s.value || (s.id === 'rrMusic' ? '' : music.id); s.innerHTML = options(cur); if (!library.some(m => m.id === cur)) s.value = ''; });
    ['a', 'm'].forEach(p => { const sel = $('#' + p + 'Music'), au = $('#' + p + 'MusicAudio'); if (!sel || !au) return; const m = library.find(x => x.id === sel.value); au.hidden = !m; if (m) { const u = `/music/${m.id}.${m.ext}`; if (!au.src.endsWith(u)) au.src = u; } else au.removeAttribute('src'); }); }
  const saveMusic = () => { store.set('music', music); };
  async function loadMusic() { try { library = (await api('GET', '/music')).music || []; } catch { library = []; } if (music.id && !library.some(m => m.id === music.id)) music.id = ''; fillSelects(); paintLibraryCard(); }
  async function uploadMusic(file, forSel) {
    if (!file) return; const ext = (file.name.split('.').pop() || '').toLowerCase();
    toast('Mengunggah “' + file.name + '”…');
    try { const r = await api('POST', `/music?ext=${encodeURIComponent(ext)}&name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ''))}`, file, true); await loadMusic(); if (forSel && $('#' + forSel)) { $('#' + forSel).value = r.id; $('#' + forSel).dispatchEvent(new Event('change', { bubbles: true })); } toast('Musik siap dipakai.'); }
    catch (e) { toast(e.message); }
  }
  const pickFile = cb => { const i = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac' }); i.onchange = () => cb(i.files[0]); i.click(); };
  document.addEventListener('click', e => { const b = e.target.closest('[data-upload]'); if (b) pickFile(f => uploadMusic(f, b.dataset.upload + 'Music')); });
  document.addEventListener('change', e => {
    const id = e.target.id; if (!/^(a|m|rr)Music(Vol|Duck)?$/.test(id || '')) return;
    if (/Music$/.test(id)) { if (id !== 'rrMusic') music.id = e.target.value; ['a', 'm'].forEach(p => { if (p + 'Music' !== id && $('#' + p + 'Music')) $('#' + p + 'Music').value = e.target.value; }); }
    if (/Vol$/.test(id)) { music.vol = +e.target.value; $$('[id$=MusicVol]').forEach(r => { if (r !== e.target && !/^rr/.test(r.id)) r.value = music.vol; }); $$('[id$=MusicVolN]').forEach(n => { if (!/^rr/.test(n.id)) n.textContent = music.vol; }); }
    if (/Duck$/.test(id)) { music.duck = e.target.checked; $$('[id$=MusicDuck]').forEach(c => { if (c !== e.target && !/^rr/.test(c.id)) c.checked = music.duck; }); }
    saveMusic(); fillSelects(); if (typeof updateSpec === 'function') updateSpec();
  });
  document.addEventListener('input', e => { if (/^(a|m|rr)MusicVol$/.test(e.target.id || '')) { const n = $('#' + e.target.id + 'N'); if (n) n.textContent = e.target.value; } });
  const musicCfg = () => music.id ? { musicId: music.id, musicVol: music.vol, musicDuck: music.duck } : {};

  function autoMusic() {
    const tail = $('.cfgTail'); if (!tail || $('#musicField')) return;
    tail.insertAdjacentHTML('beforeend', `<div class="field wide" id=musicField><div class=flabel>14 · Musik latar</div>${musicPicker('a', true)}<div class=sub style="margin-top:8px">Dicampur di bawah suara asli. Pustaka musikmu tersimpan di perangkat ini dan bisa dikelola di Pengaturan.</div></div>`);
  }
  function editorMusic() {
    const go = $('#go'); if (!go || $('#mMusicCard')) return;
    go.insertAdjacentHTML('beforebegin', `<div class=card id=mMusicCard><h2><span class=n>6</span> Musik latar</h2>${musicPicker('m', true)}</div>`);
  }
  function libraryCard() {
    const host = $('#view-settings'); if (!host || $('#musicLib')) return;
    host.insertAdjacentHTML('beforeend', `<div class=card id=musicLib><h2><svg class=ic><use href="#i-spark"/></svg> Pustaka musik latar</h2>
      <p class=sub style="margin:0 0 14px">Unggah musik bebas hak cipta (mp3, m4a, wav, aac, ogg, flac; maks 60 MB). Pastikan kamu berhak memakainya di kontenmu.</p>
      <div id=musicList></div><div style="margin-top:12px"><button type=button class="px" data-upload="">＋ Unggah musik</button></div></div>`);
  }
  function paintLibraryCard() {
    const l = $('#musicList'); if (!l) return;
    l.innerHTML = library.length ? library.map(m => `<div class=musicRow><div><b>${esc(m.name)}</b><small>${esc(m.ext)} · ${mb(m.size)}</small></div><audio controls preload=none src="/music/${m.id}.${m.ext}"></audio><button type=button class="px mini danger" data-mdel="${m.id}">Hapus</button></div>`).join('') : '<div class=sub>Belum ada musik. Unggah satu untuk dipakai di Auto dan Editor.</div>';
  }
  document.addEventListener('click', async e => { const b = e.target.closest('[data-mdel]'); if (!b || !confirm('Hapus musik ini dari pustaka?')) return; try { await api('DELETE', '/music/' + b.dataset.mdel); await loadMusic(); } catch (er) { toast(er.message); } });

  // /clip carries the Editor's music; Auto payload and presets use window.__klipAdv.cfg (extended below)
  const post1 = window.post;
  if (typeof post1 === 'function') window.post = (p, b, raw) => post1(p, !raw && p === '/clip' ? { ...b, ...musicCfg() } : b, raw);
  if (window.__klipAdv) {
    const c0 = window.__klipAdv.cfg, a0 = window.__klipAdv.apply;
    window.__klipAdv.cfg = () => ({ ...c0(), ...musicCfg() });
    window.__klipAdv.apply = c => { a0(c); if (c.musicId !== undefined) { music.id = c.musicId || ''; if (c.musicVol !== undefined) music.vol = c.musicVol; if (c.musicDuck !== undefined) music.duck = !!c.musicDuck; saveMusic(); $$('[id$=MusicVol]').forEach(r => { if (!/^rr/.test(r.id)) r.value = music.vol; }); $$('[id$=MusicVolN]').forEach(n => { if (!/^rr/.test(n.id)) n.textContent = music.vol; }); $$('[id$=MusicDuck]').forEach(x => { if (!/^rr/.test(x.id)) x.checked = music.duck; }); fillSelects(); } };
  }

  /* ------------------------------------------------------------ transcript panel (Editor) */
  let tLines = [];
  function transcriptCard() {
    const anchor = $$('#view-editor .card').find(c => /Potong/.test(($('h2', c) || {}).textContent || '')); if (!anchor || $('#trCard')) return;
    anchor.insertAdjacentHTML('afterend', `<div class=card id=trCard><h2><span class=n>2b</span> Transkrip · klik untuk memotong</h2>
      <div class=row style="align-items:end"><div style="flex:0 0 auto"><button type=button class="px primary" id=trGo>Buat transkrip</button></div><div><label class=fld for=trQ>Cari kata</label><input id=trQ placeholder="mis. rahasia" autocomplete=off></div></div>
      <div class=sub id=trHint style="margin:10px 0">Klik baris = mulai klip di sana. Shift + klik = akhir klip. Baris yang masuk rentang diberi warna.</div>
      <div id=trBox class=trBox></div></div>`);
    $('#trGo').addEventListener('click', buildTranscript); $('#trQ').addEventListener('input', paintTranscript);
    $('#trBox').addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (!r) return; const l = tLines[+r.dataset.i]; if (e.shiftKey) $('#e').value = l.t1.toFixed(1); else { $('#s').value = l.t0.toFixed(1); if (!(+$('#e').value > l.t0)) $('#e').value = Math.min(l.t0 + 30, l.t1 + 30).toFixed(1); } ['s', 'e'].forEach(i => $('#' + i).dispatchEvent(new Event('change', { bubbles: true }))); const v = $('#src'); if (v && !v.hidden) v.currentTime = +$('#s').value; paintTranscript(); });
    ['s', 'e'].forEach(i => $('#' + i).addEventListener('change', paintTranscript));
  }
  async function buildTranscript() {
    if (typeof id === 'undefined' || !id) return toast('Pilih video dulu (unduh atau unggah).');
    const b = $('#trGo'); b.disabled = true; b.textContent = 'Memproses…'; $('#trHint').textContent = 'Whisper sedang menyalin ucapan. Video panjang bisa butuh beberapa menit.';
    try { tLines = (await api('POST', '/transcript', { id, language: store.get('lang') || 'auto' })).lines; $('#trHint').textContent = `${tLines.length} baris. Klik baris untuk mulai, Shift + klik untuk akhir.`; paintTranscript(); }
    catch (e) { $('#trHint').textContent = e.message; } finally { b.disabled = false; b.textContent = 'Buat ulang'; }
  }
  function paintTranscript() {
    const box = $('#trBox'); if (!box) return; const q = ($('#trQ').value || '').trim().toLowerCase(), s = +$('#s').value || 0, e = +$('#e').value || 0, t = x => { const m = Math.floor(x / 60); return m + ':' + String(Math.floor(x % 60)).padStart(2, '0'); };
    box.innerHTML = tLines.length ? tLines.map((l, i) => ({ l, i })).filter(({ l }) => !q || l.text.toLowerCase().includes(q)).map(({ l, i }) => `<div class="trl${l.t0 >= s - .2 && l.t1 <= e + .2 ? ' in' : ''}" data-i="${i}"><time>${t(l.t0)}</time><span>${q ? esc(l.text).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>') : esc(l.text)}</span></div>`).join('') : '';
  }
  // a new source video invalidates the transcript shown
  const show0 = window.show;
  if (typeof show0 === 'function') window.show = i => { tLines = []; if ($('#trBox')) { $('#trBox').innerHTML = ''; $('#trGo').textContent = 'Buat transkrip'; } const v = $('#src'); if (v) v.dataset.wave = `/wave/${i}.png`; return show0(i); };

  /* ------------------------------------------------------------ re-render a finished clip */
  const RATIOS = [['9:16', '9:16 · TikTok, Reels, Shorts'], ['3:4', '3:4 · Feed Instagram'], ['1:1', '1:1 · Postingan'], ['16:9', '16:9 · YouTube']];
  const RES = ['360p', '480p', '720p', '1080p', '1440p', '4k'], PRESET = [['karaoke', 'Karaoke'], ['beasty', 'Beasty'], ['simple', 'Simple'], ['impact', 'Impact'], ['clean', 'Clean'], ['boxed', 'Boxed']];
  function rerender(key) {
    const rec = (window.__klipHistory || []).find(r => r.key === key) || {}, u = window.__klipUser, max = u ? RES.indexOf(u.limits.maxResolution) : 5, last = store.get('lastCfg') || {};
    const ov = document.createElement('div'); ov.className = 'updov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `<div class="upd rr"><header><span>Render ulang</span><span>${esc(rec.title || 'klip')}</span></header><div class=ub>
      <p class=um>Klip dirender lagi dari video sumber dengan pengaturan di bawah. Klip lama tetap ada. Menagih <b>1 klip</b> dari kuota.</p>
      <div class=rrGrid>
        <label class=fld>Rasio<select id=rrAspect>${RATIOS.map(([v, l]) => `<option value="${v}" ${v === (last.aspect || '9:16') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class=fld>Isi frame<select id=rrFill><option value=crop>Crop (zoom penuh)</option><option value=fit ${last.fill === 'fit' ? 'selected' : ''}>Fit (tampil utuh, latar blur)</option></select></label>
        <label class=fld>Resolusi<select id=rrRes>${RES.map((r, i) => `<option value="${r}" ${i > max ? 'disabled' : ''} ${r === (rec.resolution || '720p') ? 'selected' : ''}>${r}${i > max ? ' 🔒' : ''}</option>`).join('')}</select></label>
        <label class=fld>Gaya caption<select id=rrPreset>${PRESET.map(([v, l]) => `<option value="${v}" ${v === (rec.preset || 'karaoke') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class=fld>Posisi<select id=rrPos><option value=bottom>Bawah</option><option value=center>Tengah</option><option value=top>Atas</option></select></label>
        <label class=fld>Ukuran<select id=rrSize><option value=small>Kecil</option><option value=medium selected>Sedang</option><option value=large>Besar</option></select></label>
        <label class=fld>Warna highlight<input type=color id=rrColor value="${esc(last.captionColor && /^#[0-9a-f]{6}$/i.test(last.captionColor) ? last.captionColor : '#FF542B')}"></label>
        <label class=fld>Gaya hook<select id=rrHookStyle><option value=punch>Punch</option><option value=clean>Clean pill</option><option value=dark>Dark label</option></select></label>
      </div>
      <div class=inline><label class=chip><input type=checkbox id=rrWord checked> Caption per-kata</label><label class=chip><input type=checkbox id=rrHook ${rec.hook ? 'checked' : ''}> Judul hook</label></div>
      <label class=fld>Teks hook (maks 4 kata)<input id=rrHookText maxlength=24 value="${esc(rec.hook || '')}"></label>
      <div class=musicPick><label class=fld for=rrMusic>Musik latar</label><select id=rrMusic></select></div>
      <div class=um id=rrMsg></div>
      <div class=uact><button type=button class="px primary" id=rrGo>Render ulang</button><button type=button class=px id=rrCancel>Batal</button></div></div></div>`;
    document.body.append(ov); fillSelects(); $('#rrMusic', ov).value = '';
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); }, onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey); $('#rrCancel', ov).onclick = close; ov.addEventListener('click', e => { if (e.target === ov) close(); });
    $('#rrGo', ov).onclick = async () => {
      const b = $('#rrGo', ov); b.disabled = true; b.textContent = 'Merender…'; $('#rrMsg', ov).textContent = 'Sedang merender, bisa memakan beberapa menit.';
      const m = $('#rrMusic', ov).value;
      try {
        await api('POST', `/history/${encodeURIComponent(key)}/rerender`, { aspect: $('#rrAspect', ov).value, fill: $('#rrFill', ov).value, resolution: $('#rrRes', ov).value, preset: $('#rrPreset', ov).value, captionPosition: $('#rrPos', ov).value, captionSize: $('#rrSize', ov).value, captionColor: $('#rrColor', ov).value,
          wordByWord: $('#rrWord', ov).checked, hook: $('#rrHook', ov).checked, hookText: $('#rrHookText', ov).value, hookStyle: $('#rrHookStyle', ov).value, language: store.get('lang') || 'auto', ...(m ? { musicId: m, musicVol: music.vol, musicDuck: music.duck } : {}) });
        toast('Klip baru siap di Riwayat.'); close(); if (typeof loadHist === 'function') loadHist(); window.__klipDash && window.__klipDash.paint && window.__klipDash.paint();
      } catch (er) { $('#rrMsg', ov).textContent = er.message; $('#rrMsg', ov).classList.add('err'); b.disabled = false; b.textContent = 'Coba lagi'; }
    };
  }

  window.__klipPro = { rerender, loadMusic, library: () => library };
  autoMusic(); editorMusic(); libraryCard(); transcriptCard(); loadMusic();
})();
