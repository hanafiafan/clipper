/* Studio extras, loaded after features.js:
   - platform icons and a "good for" hint under every aspect ratio
   - live phone-frame preview for logo and sticker (Editor) and a brand logo for Auto, with the same geometry the renderer uses
   - a clearer caption/font preview in the Editor (same styles as the Auto simulator)
   - transcription language, and a YouTube download engine card in Pengaturan (version, JS runtime, browser cookies, update now) */
(() => {
  'use strict';
  if (window.__klipAdv) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: k => { try { return JSON.parse(localStorage.getItem('hc.' + k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('hc.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
  const j = async (method, path, body, raw) => { const r = await fetch(path, { method, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) }), d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Gagal (' + r.status + ')'); return d; };
  const toast = m => { const h = $('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' })), t = document.createElement('div'); t.className = 'toast'; t.textContent = m; h.append(t); setTimeout(() => t.classList.add('out'), 3800); setTimeout(() => t.remove(), 4300); };

  /* ------------------------------------------------------------ platform icons per aspect ratio */
  const ICON = {
    tiktok: '<path d="M14 4v10.4a3.4 3.4 0 1 1-3.4-3.4"/><path d="M14 4c.3 2.7 2 4.3 4.6 4.5"/>',
    reels: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M4 9h16M9.5 4l2.6 5M14.5 4l2.6 5"/><path d="M10.5 12.5v4l3.3-2z" fill="currentColor"/>',
    shorts: '<rect x="7" y="3" width="10" height="18" rx="4"/><path d="M10.5 9.5v5l4-2.5z" fill="currentColor"/>',
    instagram: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.9" cy="7.1" r=".7" fill="currentColor"/>',
    youtube: '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="M10 9.4v5.2l4.6-2.6z" fill="currentColor"/>',
    facebook: '<path d="M14.2 8.2H16V5h-2.6A3.6 3.6 0 0 0 9.8 8.6V11H8v3.2h1.8V20h3.4v-5.8h2.3l.6-3.2h-2.9V8.9c0-.5.3-.7 1-.7z"/>',
    linkedin: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 11v5M8 8v.1M11.4 16v-5m0 2.4c0-1.4.9-2.4 2.1-2.4s1.9.8 1.9 2.2V16"/>',
    x: '<path d="M5 5l14 14M19 5L5 19"/>',
  };
  const PLAT = {
    '9:16': { hint: 'TikTok, Instagram Reels, YouTube Shorts', ic: [['tiktok', 'TikTok'], ['reels', 'Instagram Reels'], ['shorts', 'YouTube Shorts']] },
    '3:4': { hint: 'Feed Instagram dan Facebook', ic: [['instagram', 'Instagram feed'], ['facebook', 'Facebook']] },
    '1:1': { hint: 'Postingan Instagram, LinkedIn, X', ic: [['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['x', 'X']] },
    '16:9': { hint: 'YouTube, Facebook, LinkedIn', ic: [['youtube', 'YouTube'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn']] },
    original: { hint: 'Rasio asli video, tanpa crop', ic: [] },
  };
  const svg = n => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
  function ratioIcons() {
    [['aAspect', 'aRatioHint'], ['mAspect', 'mRatioHint']].forEach(([grp, hintId]) => {
      const host = $('#' + grp); if (!host) return;
      $$('#' + grp + ' > .opt').forEach(o => { const p = PLAT[o.dataset.val]; if (p && p.ic.length && !$('.plat', o)) o.insertAdjacentHTML('beforeend', `<div class=plat>${p.ic.map(([n, t]) => `<span title="${t}">${svg(n)}</span>`).join('')}</div>`); });
      if (!$('#' + hintId)) host.insertAdjacentHTML('afterend', `<div class=ratioHint id=${hintId}></div>`);
      const paint = () => { const v = typeof getSel === 'function' ? getSel(grp) : '', p = PLAT[v]; $('#' + hintId).innerHTML = p ? `<b>Cocok untuk</b> ${esc(p.hint)}` : ''; };
      host.addEventListener('click', () => setTimeout(paint, 0)); paint();
    });
  }

  /* ------------------------------------------------------------ phone-frame preview (logo + sticker + caption), geometry = server makeClip */
  const RATIO_CSS = { '9:16': '9/16', '3:4': '3/4', '1:1': '1/1', '16:9': '16/9', original: '16/9' };
  const SAMPLE_LOGO = '/brand/logo-white.png', SAMPLE_BG = '/brand/preview-podcast-host.webp';
  function phoneHTML(note) { return `<div class=ovp><div class=ovf><img class=ovbg src="${SAMPLE_BG}" alt=""><img class=ovlogo alt=""><div class=ovstk></div><div class=ovcap>Ide bagus dimulai <span>di sini.</span></div></div><small class=ovnote>${esc(note)}</small></div>`; }
  // state: { ratio, logo:{on,src,scale,x,y,op}, sticker:{on,text,bg,color,round,size,x,y,src,img} | null }
  function paintPhone(host, st) {
    const f = $('.ovf', host); if (!f) return;
    f.style.aspectRatio = RATIO_CSS[st.ratio] || '9/16'; f.classList.toggle('wide', ['16:9', 'original'].includes(st.ratio));
    const lg = $('.ovlogo', host), L = st.logo;
    lg.src = L.src || SAMPLE_LOGO; lg.style.width = L.scale + '%'; lg.style.left = L.x + '%'; lg.style.top = L.y + '%'; lg.style.opacity = L.op; lg.classList.toggle('off', !L.on); lg.title = L.src ? '' : 'Contoh logo';
    const sk = $('.ovstk', host), S = st.sticker; sk.style.display = S ? '' : 'none';
    if (S) {
      const H = f.clientHeight || 300;
      sk.className = 'ovstk' + (S.on ? '' : ' off'); sk.style.left = S.x + '%'; sk.style.top = S.y + '%';
      if (S.img) { sk.innerHTML = `<img src="${esc(S.img)}" alt="">`; sk.style.width = S.size + '%'; sk.style.background = 'none'; sk.style.padding = '0'; sk.firstChild.style.width = '100%'; }
      else { sk.textContent = S.text || 'VIRAL'; sk.style.width = 'auto'; sk.style.background = S.bg; sk.style.color = S.color; sk.style.borderRadius = S.round ? '999px' : '2px'; sk.style.fontSize = Math.max(7, S.size / 100 * H * .55) + 'px'; sk.style.padding = '.28em .75em'; }
    }
  }
  const numv = (id, d) => { const e = $('#' + id); return e && e.value !== '' && isFinite(+e.value) ? +e.value : d; };
  let editorUrl = { logo: null, stk: null };
  const objUrl = (inputId, key) => { const f = $('#' + inputId) && $('#' + inputId).files[0]; if (!f) { editorUrl[key] = null; return null; } if (!editorUrl[key] || editorUrl[key].f !== f) { if (editorUrl[key]) URL.revokeObjectURL(editorUrl[key].u); editorUrl[key] = { f, u: URL.createObjectURL(f) }; } return editorUrl[key].u; };

  function editorOverlay() {
    const card = $$('#view-editor .card').find(c => /Overlay/.test(($('h2', c) || {}).textContent || '')); if (!card || $('.ovGrid', card)) return;
    const h2 = $('h2', card), ctl = document.createElement('div'); ctl.className = 'ovCtl';
    [...card.children].filter(c => c !== h2).forEach(c => ctl.append(c));
    const grid = document.createElement('div'); grid.className = 'ovGrid'; const side = document.createElement('div'); side.className = 'ovSide'; side.innerHTML = '<div class=flabel>Pratinjau hasil</div>' + phoneHTML('Contoh tampilan. Posisi dan ukuran sama dengan hasil render.');
    grid.append(ctl, side); card.append(grid);
    const sync = () => paintPhone(side, {
      ratio: typeof getSel === 'function' ? getSel('mAspect') : '9:16',
      logo: { on: $('#logoOn').checked, src: objUrl('logoFile', 'logo'), scale: numv('lScale', 25), x: numv('lX', 5), y: numv('lY', 5), op: Math.min(1, Math.max(0, numv('lOp', 1))) },
      sticker: { on: $('#stkOn').checked, text: $('#stkText').value.trim(), bg: $('#stkBg').value, color: $('#stkColor').value, round: $('#stkRound').checked, size: numv('stkSize', 6), x: numv('stkX', 50), y: numv('stkY', 80), img: objUrl('stkFile', 'stk') },
    });
    card.addEventListener('input', sync); card.addEventListener('change', sync); $('#mAspect').addEventListener('click', () => setTimeout(sync, 0));
    new ResizeObserver(sync).observe($('.ovf', side)); sync();
    // quick placements so people do not have to guess percentages
    ctl.insertAdjacentHTML('afterbegin', `<div class=presetRow><span class=plab>Posisi cepat logo</span>${[['↖', 5, 5], ['↗', 70, 5], ['↙', 5, 88], ['↘', 70, 88]].map(([a, x, y]) => `<button type=button class="px mini" data-lpos="${x},${y}" title="Pojok">${a}</button>`).join('')}</div>`);
    ctl.addEventListener('click', e => { const b = e.target.closest('[data-lpos]'); if (!b) return; const [x, y] = b.dataset.lpos.split(','); $('#lX').value = x; $('#lY').value = y; sync(); });
  }

  /* ------------------------------------------------------------ brand logo for Auto (applies to every clip) + language */
  const LANGS = [['auto', 'Deteksi otomatis'], ['id', 'Indonesia'], ['en', 'English'], ['ms', 'Melayu'], ['jw', 'Jawa'], ['su', 'Sunda'], ['ar', 'Arab'], ['zh', 'Mandarin'], ['ja', 'Jepang'], ['ko', 'Korea'], ['es', 'Spanyol'], ['fr', 'Prancis'], ['de', 'Jerman'], ['pt', 'Portugis'], ['hi', 'Hindi'], ['th', 'Thai'], ['vi', 'Vietnam'], ['tr', 'Turki'], ['ru', 'Rusia']];
  const langOptions = () => LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  let brand = Object.assign({ on: false, logoId: null, scale: 20, x: 5, y: 5, op: 1 }, store.get('brand') || {});
  let lang = store.get('lang') || 'auto';
  const setLang = v => { lang = LANGS.some(l => l[0] === v) ? v : 'auto'; store.set('lang', lang); $$('#aLang,#mLang').forEach(s => { s.value = lang; }); };

  function autoBrand() {
    const tail = $('.cfgTail'); if (!tail || $('#brandField')) return;
    tail.insertAdjacentHTML('beforeend', `<div class=cfgGroup><i>D</i> Brand &amp; bahasa</div>
      <div class=field id=brandField><div class=flabel>12 · Logo brand di setiap klip</div>
        <div class=inline style="margin-bottom:10px"><label class=chip title="Tempel logo ke semua klip Auto"><input type=checkbox id=bOn> Pakai logo</label><input type=file id=bFile accept="image/png" style="flex:1;min-width:0"></div>
        <div class=brandGrid><label class=fld>Ukuran %<input type=number id=bScale min=2 max=100></label><label class=fld>Kiri %<input type=number id=bX min=0 max=100></label><label class=fld>Atas %<input type=number id=bY min=0 max=100></label><label class=fld>Opasitas<input type=number id=bOp min=0 max=1 step=0.1></label></div>
        <div class=presetRow style="margin-top:10px"><span class=plab>Posisi cepat</span>${[['↖', 5, 5], ['↗', 70, 5], ['↙', 5, 88], ['↘', 70, 88]].map(([a, x, y]) => `<button type=button class="px mini" data-bpos="${x},${y}">${a}</button>`).join('')}</div>
        <div class=sub id=bHint style="margin-top:8px">PNG transparan paling bagus. Logo tersimpan di perangkat ini.</div></div>
      <div class=field id=brandPrev><div class=flabel>Pratinjau</div><div id=bPhone>${phoneHTML('Contoh tampilan logo pada klip.')}</div></div>
      <div class=field><div class=flabel>13 · Bahasa ucapan di video</div><select id=aLang>${langOptions()}</select><div class=sub style="margin-top:7px">Menetapkan bahasa membuat transkrip dan caption lebih akurat dibanding deteksi otomatis.</div></div>`);
    const sync = () => paintPhone($('#bPhone'), { ratio: typeof getSel === 'function' ? getSel('aAspect') : '9:16', logo: { on: brand.on, src: brand.logoId ? `/logos/${brand.logoId}.png` : null, scale: brand.scale, x: brand.x, y: brand.y, op: brand.op }, sticker: null });
    const load = () => { $('#bOn').checked = brand.on; $('#bScale').value = brand.scale; $('#bX').value = brand.x; $('#bY').value = brand.y; $('#bOp').value = brand.op; sync(); };
    const read = () => { brand.on = $('#bOn').checked; brand.scale = numv('bScale', 20); brand.x = numv('bX', 5); brand.y = numv('bY', 5); brand.op = Math.min(1, Math.max(0, numv('bOp', 1))); store.set('brand', brand); sync(); if (typeof updateSpec === 'function') updateSpec(); };
    $('#brandField').addEventListener('input', read); $('#brandField').addEventListener('change', read);
    $('#brandField').addEventListener('click', e => { const b = e.target.closest('[data-bpos]'); if (!b) return; const [x, y] = b.dataset.bpos.split(','); $('#bX').value = x; $('#bY').value = y; read(); });
    $('#bFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return; $('#bHint').textContent = 'Mengunggah…';
      try { const r = await j('POST', '/logos', f, true); brand.logoId = r.id; brand.on = true; $('#bOn').checked = true; $('#bHint').textContent = 'Logo tersimpan.'; read(); } catch (er) { $('#bHint').textContent = 'Gagal: ' + er.message; }
    });
    $('#aAspect').addEventListener('click', () => setTimeout(sync, 0));
    $('#aLang').addEventListener('change', e => setLang(e.target.value));
    new ResizeObserver(sync).observe($('.ovf', $('#bPhone'))); load(); setLang(lang);
  }
  // Editor: language next to the AI suggestion controls
  function editorLang() {
    const row = $('#view-editor #prov'); if (!row || $('#mLang')) return;
    row.closest('.inline').insertAdjacentHTML('afterend', `<div style="margin-top:12px"><label class=fld for=mLang>Bahasa ucapan</label><select id=mLang>${langOptions()}</select></div>`);
    $('#mLang').addEventListener('change', e => setLang(e.target.value)); setLang(lang);
  }
  // /clip and /suggest carry the chosen language
  const post0 = window.post;
  if (typeof post0 === 'function') window.post = (p, b, raw) => post0(p, !raw && (p === '/clip' || p === '/suggest') ? { ...b, language: lang } : b, raw);

  /* ------------------------------------------------------------ Editor caption preview: same look as the Auto simulator */
  window.updateEditorFont = function () {
    const el = $('#editorFontPreview'); if (!el) return; const preset = $('#preset').value;
    $$('#editorFontStyles button').forEach(b => { b.classList.toggle('sel', b.dataset.preset === preset); b.setAttribute('aria-pressed', String(b.dataset.preset === preset)); });
    const perWord = $('#ww').checked, color = $('#mCapColor').value;
    el.className = `liveText pv-${preset} pos-${$('#mCapPos').value} size-${$('#mCapSize').value}`; el.removeAttribute('style'); el.style.setProperty('--hl', color); el.hidden = !$('#cc').checked;
    const words = ($('#fontSample').value.trim() || 'Ide bagus dimulai di sini.').split(/\s+/), hot = Math.min(2, words.length - 1);
    el.replaceChildren(...words.flatMap((w, i) => { const node = perWord && i === hot ? Object.assign(document.createElement('span'), { textContent: w }) : document.createTextNode(w); return i < words.length - 1 ? [node, document.createTextNode(' ')] : [node]; }));
    if (!perWord) el.style.color = color;
    const lbl = $('#fontPreviewName'); if (lbl) lbl.textContent = { karaoke: 'Karaoke', beasty: 'Beasty', simple: 'Simple', impact: 'Impact', clean: 'Clean', boxed: 'Boxed' }[preset] + ' · ' + ({ bottom: 'bawah', center: 'tengah', top: 'atas' }[$('#mCapPos').value]) + ' · ' + ({ small: 'kecil', medium: 'sedang', large: 'besar' }[$('#mCapSize').value]);
  };
  function fontStudio() {
    const box = $('.fontPreview'); if (!box || $('#fontPreviewName')) return;
    box.insertAdjacentHTML('beforeend', '<div class=fontPrevName id=fontPreviewName></div>');
    // the preview column becomes a phone-shaped frame so position and size read correctly
    box.classList.add('phoneFrame');
    window.updateEditorFont();
  }

  /* ------------------------------------------------------------ Pengaturan: YouTube download engine */
  async function engineCard() {
    const host = $('#view-settings'); if (!host || $('#engineCard')) return;
    host.insertAdjacentHTML('beforeend', `<div class=card id=engineCard><h2><svg class=ic><use href="#i-download"/></svg> Mesin unduh YouTube</h2>
      <p class=sub style="margin:0 0 14px">Downloader dan Auto memakai <b>yt-dlp</b>. YouTube sering berubah, jadi aplikasi memperbarui yt-dlp sendiri (diverifikasi checksum). Bila unduhan ditolak (403) atau diminta login, coba tombol di bawah atau pilih cookies browser.</p>
      <div class=speclist id=engInfo></div>
      <div class=row style="margin-top:12px"><div><label class=fld for=engCookies>Cookies browser (untuk video yang butuh login)</label><select id=engCookies></select></div>
        <div style="flex:0 0 auto"><button type=button class="px" id=engUpdate>Perbarui mesin sekarang</button></div></div>
      <div class=sub id=engMsg style="margin-top:10px"></div></div>`);
    $('#engCookies').addEventListener('change', async e => { try { await j('POST', '/settings', { ytCookies: e.target.value }); $('#engMsg').textContent = e.target.value === 'none' ? 'Cookies browser dimatikan.' : 'Akan memakai cookies dari ' + e.target.value + '. macOS mungkin meminta izin Keychain saat pertama kali.'; } catch (er) { $('#engMsg').textContent = er.message; } });
    $('#engUpdate').addEventListener('click', async b => { const btn = b.currentTarget; btn.disabled = true; $('#engMsg').textContent = 'Memeriksa rilis terbaru…'; try { const r = await j('POST', '/settings/ytdlp-update', {}); $('#engMsg').textContent = r.updated ? `Diperbarui ke ${r.version}.` : r.reason === 'current' ? `Sudah versi terbaru (${r.version}).` : r.reason === 'error' ? 'Gagal: ' + r.error : 'Tidak ada pembaruan.'; load(); } catch (er) { $('#engMsg').textContent = er.message; } btn.disabled = false; });
    const load = async () => {
      try { const s = await j('GET', '/settings'), y = s.ytdlp;
        $('#engCookies').innerHTML = '<option value=none>Tidak dipakai</option>' + s.browsers.map(b => `<option value="${b}">${b[0].toUpperCase() + b.slice(1)}</option>`).join(''); $('#engCookies').value = s.ytCookies;
        $('#engInfo').innerHTML = [['Versi yt-dlp', y.version || 'tidak terpasang'], ['Pembaruan otomatis', y.managed ? 'aktif (salinan terbaru dipakai)' : 'memakai bawaan; diperbarui di unduhan berikutnya'], ['Runtime JavaScript', y.jsRuntime ? y.jsRuntime : 'tidak ada (pasang Deno bila YouTube menolak)']].map(([k, v]) => `<div class=sp><span>${k}</span><b>${esc(v)}</b></div>`).join('');
      } catch { /* not logged in yet */ }
    };
    document.addEventListener('click', e => { if (e.target.closest('.navitem[data-view=settings]')) load(); }); load();
  }

  /* ------------------------------------------------------------ hooks used by features.js (presets, Auto payload) */
  window.__klipAdv = {
    cfg: () => ({ language: lang, logoOn: brand.on, logoId: brand.logoId || undefined, logoScale: brand.scale, logoX: brand.x, logoY: brand.y, logoOp: brand.op }),
    apply: c => {
      if (c.language) { setLang(c.language); }
      if (c.logoOn !== undefined || c.logoScale !== undefined) {
        brand = { ...brand, on: !!c.logoOn, logoId: c.logoId || brand.logoId, scale: c.logoScale ?? brand.scale, x: c.logoX ?? brand.x, y: c.logoY ?? brand.y, op: c.logoOp ?? brand.op }; store.set('brand', brand);
        if ($('#bOn')) { $('#bOn').checked = brand.on; $('#bScale').value = brand.scale; $('#bX').value = brand.x; $('#bY').value = brand.y; $('#bOp').value = brand.op; $('#bOn').dispatchEvent(new Event('change', { bubbles: true })); }
      }
    },
  };

  ratioIcons(); editorOverlay(); autoBrand(); editorLang(); fontStudio(); engineCard();
  // features.js may add its own blocks a moment later; make sure the language select reflects the saved value
  setTimeout(() => setLang(lang), 300);
})();
