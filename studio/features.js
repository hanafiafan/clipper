/* Studio features layered on top of studio/index.html (same pattern as account.js and dashboard.js):
   - Auto: batch links, a job queue with stage progress and cancel, "review before render" with a trim editor, presets
   - Editor: trim timeline for the manual cut
   - Riwayat: search, grade filter, favourites, sort, multi-select, ZIP download, bulk delete
   It reuses the page's globals (getSel, showView, setCustomHighlight, updateSpec, post) and replaces startAuto, autoCard and loadHist. */
(() => {
  'use strict';
  if (window.__klipFeatures) return; window.__klipFeatures = true;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = async (method, path, body) => {
    const r = await fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Gagal (' + r.status + ')'); return j;
  };
  const fmt = t => { t = Math.max(0, +t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const store = { get: k => { try { return JSON.parse(localStorage.getItem('hc.' + k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem('hc.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

  /* ---------------------------------------------------------------- styles */
  const css = document.createElement('style');
  css.textContent = `
  .px::after{content:none!important}
  .mini{padding:6px 9px;font-size:10.5px;letter-spacing:.04em}
  textarea#aUrl{font:inherit;color:#171916;background:rgba(255,255,255,.32);border:1px solid var(--line2);border-radius:0;padding:11px 12px;width:100%;resize:none;min-height:43px;line-height:1.5;outline:none;overflow:hidden;display:block}
  textarea#aUrl:focus{box-shadow:inset 4px 0 0 var(--accent);background:#f3f5f0}
  textarea#aUrl::placeholder{color:#72796f;font-family:var(--mono);font-size:13px}
  .urlhint{font:10px/1.5 var(--mono);color:var(--muted);margin-top:6px;letter-spacing:.04em}
  /* toasts */
  .toasts{position:fixed;left:18px;bottom:18px;z-index:60;display:grid;gap:8px;max-width:min(420px,calc(100vw - 36px))}
  .toast{background:#171916;color:#e5ebe1;border-left:4px solid var(--accent);padding:11px 14px;font:12px/1.45 var(--mono);box-shadow:5px 5px 0 rgba(23,25,22,.2);animation:tin .25s ease}
  .toast.err{border-left-color:#ff5a5a}.toast.ok{border-left-color:#5fd08a}.toast.out{opacity:0;transform:translateY(6px);transition:.35s}
  @keyframes tin{from{opacity:0;transform:translateY(8px)}}
  /* presets */
  .pbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;padding:10px 12px;border:1px dashed var(--line2);background:rgba(255,255,255,.22)}
  .pbar .plab{font:700 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .pbar select{flex:1 1 180px;min-width:0;width:auto;min-height:38px;padding:7px 10px}
  /* queue */
  .jq{display:grid;gap:10px;margin-top:14px}
  .jq:empty{display:none}
  .jqh{font:700 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:#171916;display:flex;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid rgba(23,25,22,.35)}
  .jobc{background:rgba(233,238,230,.92);border:2px solid #171916;color:#171916;padding:11px 12px;display:grid;gap:8px;font-size:12px}
  .jobc.st-error{border-color:#b3261e}.jobc.st-cancelled{opacity:.65}
  .jh{display:flex;gap:8px;justify-content:space-between;align-items:baseline}
  .jh b{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .jh time{font:10px var(--mono);color:#596358;flex:none}
  .stg{display:flex;gap:3px;list-style:none;margin:0;padding:0}
  .stg li{flex:1;font:700 8.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;text-align:center;padding:4px 0;border-top:3px solid rgba(23,25,22,.25);color:#7a8478}
  .stg li.done{border-top-color:#171916;color:#171916}
  .stg li.now{border-top-color:var(--accent);color:#171916;animation:blinkb 1.2s ease-in-out infinite}
  @keyframes blinkb{50%{border-top-color:#171916}}
  .jbar{height:8px;border:1px solid #171916;background:rgba(255,255,255,.4)}
  .jbar i{display:block;height:100%;width:0;background:repeating-linear-gradient(135deg,#171916 0 6px,var(--accent) 6px 12px);transition:width .5s}
  .jstep{font:11px/1.4 var(--mono);color:#3d443c;overflow-wrap:anywhere}
  .jact{display:flex;gap:6px;flex-wrap:wrap}
  .jobc button{padding:6px 10px;font-size:10px}
  .qb{font:700 10px var(--mono);font-style:normal;background:var(--accent);color:#171916;padding:1px 6px;margin-left:6px}
  /* results groups */
  .jgroup{grid-column:1/-1;display:flex;gap:10px;align-items:center;border-bottom:2px solid #171916;padding:6px 0 8px;margin-top:6px}
  .jgroup:first-child{margin-top:0}
  .jgroup b{font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .jgroup span{font:10px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);flex:none}
  .jgroup .sp{flex:1}
  /* clip cards: star + select */
  .hcard{position:relative}
  .hc-top{position:absolute;z-index:2;top:8px;left:8px;right:8px;display:flex;justify-content:space-between;align-items:center;pointer-events:none}
  .hc-top>*{pointer-events:auto}
  .starb{padding:5px 8px;font-size:15px;line-height:1;background:rgba(23,25,22,.78);color:#e5ebe1;border-color:transparent}
  .starb.on{color:#ffd400}
  .starb:hover{color:#ffd400;border-color:#ffd400;box-shadow:none;transform:none}
  .pick{width:22px;height:22px;accent-color:var(--accent);cursor:pointer;margin:0}
  .hcard.picked{outline:3px solid var(--accent);outline-offset:-3px}
  /* review */
  #reviewPanel .rhead{display:flex;gap:12px;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px}
  #reviewPanel .rhead h3{margin:0;font:700 clamp(22px,3vw,34px)/1 var(--body);letter-spacing:-.05em;text-transform:uppercase}
  #reviewPanel .rhead p{margin:6px 0 0;font:11px/1.5 var(--mono);color:var(--muted);max-width:60ch}
  .rlist{display:grid;gap:14px}
  .rc{display:grid;grid-template-columns:220px 1fr;gap:16px;border:1.5px solid var(--line2);background:rgba(233,238,230,.93);padding:12px;transition:opacity .15s}
  .rc.off{opacity:.45}
  .rc video{width:100%;aspect-ratio:9/16;max-height:360px;object-fit:contain;background:#000;display:block}
  .rcb{display:grid;gap:10px;align-content:start;min-width:0}
  .rch{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .rch .rn{font:400 26px var(--disp);color:var(--accent);line-height:1}
  .rch .rdur{font:11px var(--mono);color:var(--muted);margin-left:auto}
  .rcb .two{display:grid;grid-template-columns:2fr 1fr;gap:10px}
  .rcb label.fld{margin-bottom:4px}
  .rsegs{display:grid;gap:10px}
  .trim{border:1px solid var(--line2);padding:10px 10px 8px;background:rgba(255,255,255,.28)}
  .trk{position:relative;height:28px}
  .trk::before{content:"";position:absolute;left:0;right:0;top:12px;height:4px;background:rgba(23,25,22,.25)}
  .trk .tsel{position:absolute;top:10px;height:8px;background:var(--accent);border:1px solid #171916}
  .trk input[type=range]{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;min-height:0;background:none;border:0;box-shadow:none;pointer-events:none;-webkit-appearance:none;appearance:none}
  .trk input[type=range]::-webkit-slider-runnable-track{background:transparent;height:28px}
  .trk input[type=range]::-moz-range-track{background:transparent}
  .trk input[type=range]::-webkit-slider-thumb{pointer-events:auto;-webkit-appearance:none;width:12px;height:28px;background:#171916;border:2px solid var(--accent);cursor:ew-resize}
  .trk input[type=range]::-moz-range-thumb{pointer-events:auto;width:8px;height:24px;border-radius:0;background:#171916;border:2px solid var(--accent);cursor:ew-resize}
  .trow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase}
  .trow label{display:flex;align-items:center;gap:6px;color:var(--muted)}
  .trow input[type=number]{width:74px;min-height:32px;padding:4px 6px}
  .trow .tdur{margin-left:auto;margin-right:auto;color:#171916}
  .rfoot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:2px solid #171916}
  .rfoot .rsum{font:11px var(--mono);letter-spacing:.04em;flex:1 1 220px}
  .rfoot .warn{color:#b3261e;font-weight:700}
  /* history toolbar */
  .hbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
  .hbar input[type=search]{flex:1 1 220px;min-width:0}
  .hbar select{width:auto;flex:0 0 auto}
  .gchips{display:flex}
  .gchips button{padding:8px 11px;margin-left:-1px;font-size:11px}
  .gchips button.on{background:#171916;color:#e5ebe1}
  .hsum{font:11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
  .hselbar{position:sticky;top:0;z-index:4;display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#171916;color:#e5ebe1;padding:10px 12px;margin-bottom:14px;font:11px var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .hselbar button{background:transparent;color:#e5ebe1;border-color:#5f665d}
  .hselbar button.primary{background:var(--accent);color:#171916;border-color:var(--accent)}
  .hselbar span{margin-right:auto}
  /* editor trim */
  #edTrim{margin-top:12px}
  /* update popup */
  .updov{position:fixed;inset:0;z-index:70;background:rgba(12,12,11,.55);display:grid;place-items:center;padding:18px;animation:tin .2s ease}
  .upd{width:min(520px,100%);background:#e9eee6;border:2px solid #171916;box-shadow:10px 10px 0 var(--accent);color:#171916;max-height:calc(100vh - 36px);overflow:auto}
  .upd header{background:#171916;color:#e5ebe1;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;font:700 10px var(--mono);letter-spacing:.16em;text-transform:uppercase}
  .upd header b{color:var(--accent)}
  .upd .ub{padding:20px 22px;display:grid;gap:14px}
  .upd h3{margin:0;font:700 clamp(24px,4vw,34px)/1 var(--body);letter-spacing:-.05em;text-transform:uppercase}
  .upd .vv{font:700 12px var(--mono);letter-spacing:.06em}
  .upd .vv i{font-style:normal;color:var(--muted)}
  .upd .vv span{background:var(--accent);padding:2px 8px;color:#171916}
  .upd pre{margin:0;font:12px/1.6 var(--mono);white-space:pre-wrap;max-height:180px;overflow:auto;background:rgba(255,255,255,.4);border:1px solid var(--line2);padding:10px 12px}
  .upd .um{font:11px/1.5 var(--mono);color:#3d443c}
  .upd .um.err{color:#b3261e;font-weight:700}
  .upd .uprog{height:10px;border:1px solid #171916;background:rgba(255,255,255,.4);display:none}
  .upd .uprog i{display:block;height:100%;width:0;background:repeating-linear-gradient(135deg,#171916 0 6px,var(--accent) 6px 12px);transition:width .4s}
  .upd .uact{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
  .upd .uact a.btnlike{display:inline-flex;align-items:center;padding:11px 16px;border:1px solid #171916;font:700 12.5px var(--mono);letter-spacing:.06em;text-transform:uppercase;text-decoration:none;color:#171916}
  .updpill{margin-left:18px;padding:3px 10px;font-size:10px;letter-spacing:.12em;background:var(--accent);color:#171916;border-color:var(--accent);animation:blinkb 1.6s ease-in-out infinite}
  .updpill::after{content:none!important}
  @media(max-width:700px){.rc{grid-template-columns:1fr}.rc video{max-height:300px;margin:auto;max-width:220px}.rcb .two{grid-template-columns:1fr}}`;
  document.head.appendChild(css);

  const toast = (msg, kind) => {
    const host = $('.toasts') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; host.append(t);
    setTimeout(() => t.classList.add('out'), 3800); setTimeout(() => t.remove(), 4300);
  };

  /* ---------------------------------------------------------------- trim timeline (used by review and the manual editor) */
  // Two overlapping range inputs form one selection on the video's timeline; numbers, nudges and "use playhead" buttons give frame-level control.
  function trimmer({ video, a, b, max, onChange }) {
    const el = document.createElement('div'); el.className = 'trim';
    el.innerHTML = `<div class=trk><i class=tsel></i><input type=range class=ta step=0.1 aria-label="Mulai"><input type=range class=tb step=0.1 aria-label="Selesai"></div>
      <div class=trow><label>Mulai <input type=number class=na step=0.1 min=0></label><button type=button class="px mini" data-t=ma title="Mulai = posisi video sekarang">◂ posisi</button>
      <span class=tdur></span><button type=button class="px mini" data-t=mb title="Selesai = posisi video sekarang">posisi ▸</button>
      <label>Selesai <input type=number class=nb step=0.1 min=0></label><button type=button class="px mini" data-t=play>▶ Putar</button></div>`;
    const ta = $('.ta', el), tb = $('.tb', el), na = $('.na', el), nb = $('.nb', el), sel = $('.tsel', el), dur = $('.tdur', el);
    let A = a, B = b, M = max, playing = false;
    const paint = () => {
      ta.max = tb.max = M; ta.value = A; tb.value = B; na.value = A.toFixed(1); nb.value = B.toFixed(1);
      sel.style.left = (A / M * 100) + '%'; sel.style.width = ((B - A) / M * 100) + '%'; dur.textContent = (B - A).toFixed(1) + ' dtk';
    };
    const set = (x, y, who, quiet) => {
      x = Math.min(Math.max(+x || 0, 0), M); y = Math.min(Math.max(+y || 0, 0), M);
      if (who === 'a' && x > y - 0.5) x = Math.max(0, y - 0.5);
      if (who === 'b' && y < x + 0.5) y = Math.min(M, x + 0.5);
      A = x; B = y; paint(); if (!quiet) onChange && onChange(A, B);
    };
    const seek = t => { try { video.currentTime = t; } catch { /* metadata not ready */ } };
    ta.addEventListener('input', () => { set(ta.value, B, 'a'); seek(A); });
    tb.addEventListener('input', () => { set(A, tb.value, 'b'); seek(Math.max(A, B - 1.2)); });
    na.addEventListener('change', () => { set(na.value, B, 'a'); seek(A); });
    nb.addEventListener('change', () => { set(A, nb.value, 'b'); seek(Math.max(A, B - 1.2)); });
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-t]')?.dataset.t; if (!t) return;
      if (t === 'ma') set(video.currentTime, B, 'a'); else if (t === 'mb') set(A, video.currentTime, 'b');
      else { seek(A); playing = true; video.play().catch(() => { playing = false; }); }
    });
    video.addEventListener('timeupdate', () => { if (playing && video.currentTime >= B) { video.pause(); playing = false; seek(A); } });
    video.addEventListener('pause', () => { if (video.currentTime < B - 0.2) playing = false; });
    const meta = () => { if (video.duration && isFinite(video.duration)) { M = Math.max(video.duration, B); paint(); } };
    video.addEventListener('loadedmetadata', meta); if (video.readyState >= 1) meta();
    paint();
    return { el, get: () => [A, B], set: (x, y) => set(x, y, null, true) };
  }

  /* ---------------------------------------------------------------- presets */
  const BUILTIN = [
    { name: 'Viral TikTok / Reels', cfg: { aspect: '9:16', fill: 'crop', resolution: '1080p', preset: 'karaoke', template: 'Karaoke Active', wordByWord: true, captionPosition: 'bottom', captionSize: 'medium', captionColor: '#FF542B', hook: true, hookStyle: 'punch' } },
    { name: 'Podcast bersih', cfg: { aspect: '9:16', fill: 'fit', bg: 'blur', resolution: '1080p', preset: 'clean', template: 'Clean Modern', wordByWord: true, captionPosition: 'center', captionSize: 'medium', captionColor: '#FFD400', hook: true, hookStyle: 'clean' } },
    { name: 'Instagram feed 3:4', cfg: { aspect: '3:4', fill: 'crop', resolution: '1080p', preset: 'simple', template: 'Simple Subtitle', wordByWord: false, captionPosition: 'bottom', captionSize: 'medium', captionColor: '#FFFFFF', hook: false, hookStyle: 'dark' } },
    { name: 'YouTube lanskap', cfg: { aspect: '16:9', fill: 'fit', bg: 'blur', resolution: '1080p', preset: 'simple', template: 'Simple Subtitle', wordByWord: false, captionPosition: 'bottom', captionSize: 'small', captionColor: '#FFFFFF', hook: false, hookStyle: 'dark' } },
    { name: 'Draf cepat (360p)', cfg: { aspect: '9:16', fill: 'crop', resolution: '360p', preset: 'simple', template: 'Simple Subtitle', wordByWord: false, captionPosition: 'bottom', captionSize: 'medium', captionColor: '#FFFFFF', hook: false, hookStyle: 'punch' } },
  ];
  let userPresets = [];

  const captureCfg = () => {
    const tpl = $('#aPreset .opt.sel'), fit = getSel('aFill') === 'fit', color = getSel('aBg') === 'color';
    return { aspect: getSel('aAspect'), fill: getSel('aFill'), bg: fit ? (color ? $('#aBgColor').value : 'blur') : undefined, resolution: getSel('aRes'), count: +getSel('aCount'),
      preset: getSel('aPreset'), template: tpl ? tpl.dataset.name : undefined, wordByWord: $('#aWord').checked, captionPosition: getSel('aCapPos'), captionSize: getSel('aCapSize'),
      captionColor: getSel('aCapColor'), hook: $('#aHook').checked, hookStyle: getSel('aHookStyle'), review: $('#aReview').checked };
  };
  const pickOpt = (group, pred) => { const o = $$('#' + group + ' > .opt').find(x => !x.classList.contains('lockedres') && pred(x)); if (o) o.click(); return !!o; };
  const setCheck = (id, v) => { const c = $('#' + id); if (c && v != null && c.checked !== !!v) { c.checked = !!v; c.dispatchEvent(new Event('change', { bubbles: true })); } };
  function applyCfg(c) {
    if (!c) return;
    c.aspect && pickOpt('aAspect', o => o.dataset.val === c.aspect);
    c.fill && pickOpt('aFill', o => o.dataset.val === c.fill);
    if (c.fill === 'fit' && c.bg) { if (c.bg === 'blur') pickOpt('aBg', o => o.dataset.val === 'blur'); else if (/^#[0-9a-f]{6}$/i.test(c.bg)) { pickOpt('aBg', o => o.dataset.val === 'color'); $('#aBgColor').value = c.bg; } }
    c.resolution && pickOpt('aRes', o => o.dataset.val === c.resolution);
    c.count && pickOpt('aCount', o => o.dataset.val === String(c.count));
    if (c.template || c.preset) pickOpt('aPreset', o => c.template ? o.dataset.name === c.template : o.dataset.val === c.preset) || pickOpt('aPreset', o => o.dataset.val === c.preset);
    c.captionPosition && pickOpt('aCapPos', o => o.dataset.val === c.captionPosition);
    c.captionSize && pickOpt('aCapSize', o => o.dataset.val === c.captionSize);
    if (c.captionColor && !pickOpt('aCapColor', o => o.id !== 'aCustomHighlight' && o.dataset.val.toUpperCase() === c.captionColor.toUpperCase())) setCustomHighlight(c.captionColor);
    c.hookStyle && pickOpt('aHookStyle', o => o.dataset.val === c.hookStyle);
    setCheck('aWord', c.wordByWord); setCheck('aHook', c.hook); setCheck('aReview', c.review);
    updateSpec(); updateCaptionPreview();
  }
  function paintPresets(keep) {
    const sel = $('#pSel'); if (!sel) return;
    const opt = (p, g, i) => `<option value="${g}:${i}">${esc(p.name)}</option>`;
    sel.innerHTML = '<option value="">Pilih preset…</option>' + `<optgroup label="Bawaan">${BUILTIN.map((p, i) => opt(p, 'b', i)).join('')}</optgroup>` +
      (userPresets.length ? `<optgroup label="Milikmu">${userPresets.map((p, i) => opt(p, 'u', i)).join('')}</optgroup>` : '');
    sel.value = keep || ''; $('#pDel').hidden = !String(keep || '').startsWith('u:');
  }
  async function loadPresets() { try { userPresets = (await api('GET', '/presets')).presets || []; } catch { userPresets = []; } paintPresets(); }

  /* ---------------------------------------------------------------- Auto: markup upgrades */
  const STAGES = { queue: 'Antrean', download: 'Unduh', analyze: 'Analisis', review: 'Tinjau', render: 'Render' };
  const TERMINAL = ['done', 'error', 'cancelled'];
  const jobs = new Map(); let timer = 0, reviewShown = null;

  function upgradeAuto() {
    // several links at once: the single-line input becomes a growing textarea
    const old = $('#aUrl'); if (!old) return;
    const ta = document.createElement('textarea'); ta.id = 'aUrl'; ta.rows = 1; ta.spellcheck = false; ta.placeholder = 'https://youtube.com/watch?v=…  (boleh beberapa link, satu per baris)';
    old.replaceWith(ta);
    ta.insertAdjacentHTML('afterend', '<div class=urlhint>Beberapa link masuk antrean dan diproses satu per satu.</div>');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 140) + 'px'; };
    ta.addEventListener('input', grow); ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) startAuto(); });

    // presets
    $('.urlhint', ta.parentElement).insertAdjacentHTML('afterend', `<div class=pbar><span class=plab>Preset</span><select id=pSel aria-label="Preset pengaturan"></select>
      <button type=button class="px mini" id=pSave title="Simpan pengaturan sekarang sebagai preset">Simpan sekarang</button><button type=button class="px mini danger" id=pDel hidden>Hapus</button></div>`);
    $('#pSel').addEventListener('change', e => {
      const [g, i] = e.target.value.split(':'), p = g === 'b' ? BUILTIN[+i] : g === 'u' ? userPresets[+i] : null;
      $('#pDel').hidden = g !== 'u'; if (p) { applyCfg(p.cfg); toast('Preset “' + p.name + '” diterapkan.', 'ok'); }
    });
    $('#pSave').addEventListener('click', async () => {
      const name = (prompt('Nama preset:') || '').trim(); if (!name) return;
      try { userPresets = (await api('POST', '/presets', { name, cfg: captureCfg() })).presets; const i = userPresets.findIndex(p => p.name.toLowerCase() === name.toLowerCase()); paintPresets('u:' + i); toast('Preset “' + name + '” tersimpan.', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    });
    $('#pDel').addEventListener('click', async () => {
      const [, i] = $('#pSel').value.split(':'), p = userPresets[+i]; if (!p || !confirm('Hapus preset “' + p.name + '”?')) return;
      try { userPresets = (await api('DELETE', '/presets/' + encodeURIComponent(p.name))).presets; paintPresets(); toast('Preset dihapus.'); } catch (e) { toast(e.message, 'err'); }
    });

    // review toggle next to the caption toggles
    $('#aHook').closest('label').insertAdjacentHTML('afterend', '<label class=chip title="Berhenti setelah AI memilih momen: atur potongan, judul, dan hook dulu, baru render"><input type=checkbox id=aReview> Tinjau momen sebelum render</label>');
    $('#aReview').addEventListener('change', () => { updateSpec(); });

    // queue replaces the single progress bar in the launch panel
    $('#aStatus').style.display = 'none'; $('#aProg')?.remove();
    $('#aBtn').insertAdjacentHTML('afterend', '<div id=jobQueue class=jq></div>');
    $('#jobQueue').addEventListener('click', onQueueClick);

    // review panel sits above the results
    $('#aResults').closest('.card').insertAdjacentHTML('beforebegin', '<section id=reviewPanel class="card hero" hidden></section>');
    $('#aResults').addEventListener('click', onCardClick);

    // nav badge
    $('.navitem[data-view=auto]')?.insertAdjacentHTML('beforeend', '<i class=qb hidden>0</i>');

    // spec readout also shows the review mode
    const spec = window.updateSpec;
    window.updateSpec = function () { spec(); const el = $('#aSpec'); if (el && $('#aReview')) el.insertAdjacentHTML('beforeend', `<div class=sp><span>Tinjau dulu</span><b class="${$('#aReview').checked ? 'on' : ''}">${$('#aReview').checked ? 'YA' : 'TIDAK'}</b></div>`); };

    // resolutions above the plan are locked for real (the markup uses divs, so account.js's button-based lock never matched)
    lockResolutions(); setInterval(lockResolutions, 4000);
    const last = store.get('lastCfg'); if (last) applyCfg(last);
    grow();
  }
  const RANK = ['360p', '480p', '720p', '1080p', '1440p', '4k'];
  function lockResolutions() {
    const u = window.__klipUser; if (!u) return;
    const max = RANK.indexOf(u.limits.maxResolution);
    $$('#aRes > .opt').forEach(o => { const lock = RANK.indexOf(o.dataset.val) > max; o.classList.toggle('lockedres', lock); o.title = lock ? `Butuh plan lebih tinggi (plan ${u.limits.name}: maks ${u.limits.maxResolution})` : ''; o.style.opacity = lock ? '.4' : ''; o.style.cursor = lock ? 'not-allowed' : ''; });
    const cur = $('#aRes > .opt.sel'); if (cur?.classList.contains('lockedres')) $$('#aRes > .opt').find(o => o.dataset.val === u.limits.maxResolution)?.click();
  }
  document.addEventListener('click', e => { const o = e.target.closest('#aRes > .opt.lockedres'); if (o) { e.stopImmediatePropagation(); e.preventDefault(); toast(o.title, 'err'); } }, true);

  /* ---------------------------------------------------------------- Auto: start, poll, render the queue */
  window.startAuto = async function () {
    const urls = [...new Set($('#aUrl').value.split(/[\s,]+/).filter(Boolean))];
    if (!urls.length) return toast('Tempel minimal satu link YouTube.', 'err');
    const bad = urls.find(x => !/^https?:\/\//.test(x)); if (bad) return toast('Bukan link yang valid: ' + bad.slice(0, 60), 'err');
    const provider = getSel('aProv');
    if (!provider) { toast('Belum ada API key AI. Tambahkan di Pengaturan.', 'err'); return showView('settings'); }
    const btn = $('#aBtn'), cfg = captureCfg(); store.set('lastCfg', cfg); btn.disabled = true;
    const fill = cfg.fill, bg = fill === 'fit' ? cfg.bg : undefined;
    let n = 0;
    try {
      for (const url of urls) {
        const { jobId } = await api('POST', '/auto', { url, aspect: cfg.aspect, fill, bg, resolution: cfg.resolution, count: cfg.count, preset: cfg.preset, wordByWord: cfg.wordByWord,
          captionPosition: cfg.captionPosition, captionSize: cfg.captionSize, captionColor: cfg.captionColor, hook: cfg.hook, hookStyle: cfg.hookStyle, motion: true, provider, review: cfg.review });
        jobs.set(jobId, { id: jobId, status: 'queued', stage: 'queue', step: 'Menunggu antrean…', label: url, clips: [], created: Date.now(), at: Date.now() }); n++;
      }
      $('#aUrl').value = ''; $('#aUrl').dispatchEvent(new Event('input'));
      toast(n > 1 ? n + ' video masuk antrean.' : 'Video masuk antrean.', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; }
    if (n) tick();
  };

  async function tick() {
    clearTimeout(timer);
    for (const j of [...jobs.values()]) {
      if (TERMINAL.includes(j.status) || j.status === 'review' && j.candidates) continue;
      try { const prev = j.status, nj = await api('GET', '/auto/' + j.id); jobs.set(j.id, nj); announce(prev, nj); } catch { jobs.delete(j.id); }
    }
    paintAll();
    if ([...jobs.values()].some(j => !TERMINAL.includes(j.status) && !(j.status === 'review' && j.candidates))) timer = setTimeout(tick, 1500);
  }
  function announce(prev, j) {
    if (prev === j.status) return;
    if (j.status === 'review') toast('“' + shortLabel(j) + '” siap ditinjau.', 'ok');
    else if (j.status === 'done') { toast('Selesai: ' + j.clips.length + ' short dari “' + shortLabel(j) + '”.', 'ok'); loadHist(); window.__klipDash?.paint?.(); }
    else if (j.status === 'error') toast('Gagal: ' + (j.error || 'tidak diketahui'), 'err');
  }
  const shortLabel = j => String(j.label || 'video').replace(/^https?:\/\/(www\.)?/, '').slice(0, 48);

  function pct(j) {
    if (j.status === 'done') return 100;
    if (j.stage === 'queue') return j.candidates ? 45 : 0;
    if (j.stage === 'download') return 10; if (j.stage === 'analyze') return 30; if (j.stage === 'review') return 45;
    return 45 + 55 * ((j.done || 0) / (j.total || 1));
  }
  function stepper(j) {
    const order = j.review || j.candidates ? ['queue', 'download', 'analyze', 'review', 'render'] : ['queue', 'download', 'analyze', 'render'];
    let at = order.indexOf(j.stage === 'done' ? 'render' : j.stage); if (j.stage === 'queue' && j.candidates) at = order.indexOf('render');
    return `<ol class=stg>${order.map((s, i) => `<li class="${j.status === 'done' || i < at ? 'done' : i === at && !TERMINAL.includes(j.status) && !(s === 'review' && j.status === 'review') ? 'now' : i === at && s === 'review' ? 'now' : ''}">${STAGES[s]}</li>`).join('')}</ol>`;
  }
  function paintQueue() {
    const host = $('#jobQueue'); if (!host) return;
    const list = [...jobs.values()].sort((a, b) => b.created - a.created), live = list.filter(j => !TERMINAL.includes(j.status)).length;
    host.innerHTML = list.length ? `<div class=jqh><span>Antrean & proses</span><span>${live} aktif</span></div>` + list.map(j => {
      const end = TERMINAL.includes(j.status) ? j.at : Date.now(), step = j.status === 'queued' && j.queue ? `Antrean #${j.queue}` : j.status === 'error' ? 'Gagal' + (j.failStep ? ` saat: ${j.failStep}` : '') + ' — ' + (j.error || '') : j.step || '';
      const acts = j.status === 'review' ? '<button type=button class="px primary" data-q=review>Tinjau</button><button type=button class=px data-q=cancel>Batal</button>'
        : TERMINAL.includes(j.status) ? (j.status === 'done' ? '<button type=button class=px data-q=show>Lihat hasil</button>' : '') + '<button type=button class=px data-q=close>Tutup</button>' : '<button type=button class=px data-q=cancel>Batal</button>';
      return `<div class="jobc st-${j.status}" data-id="${j.id}"><div class=jh><b title="${esc(j.label)}">${esc(shortLabel(j))}</b><time>${clock(end - j.created)}</time></div>${stepper(j)}
        <div class=jbar><i style="width:${pct(j).toFixed(0)}%"></i></div><div class=jstep>${esc(step)}</div><div class=jact>${acts}</div></div>`;
    }).join('') : '';
    const qv = $$('.stripmeta b')[1]; if (qv) qv.textContent = String(live).padStart(2, '0');
    const qb = $('.qb'); if (qb) { qb.hidden = !live; qb.textContent = live; }
    const run = list.find(j => j.status === 'running'); document.title = run ? `(${pct(run).toFixed(0)}%) Hellens Clipper` : 'Hellens Clipper';
  }
  async function onQueueClick(e) {
    const b = e.target.closest('[data-q]'); if (!b) return; const id = b.closest('.jobc').dataset.id, j = jobs.get(id);
    if (b.dataset.q === 'cancel') { if (!confirm('Batalkan proses ini?')) return; try { await api('DELETE', '/auto/' + id); toast('Dibatalkan.'); tick(); } catch (er) { toast(er.message, 'err'); } }
    else if (b.dataset.q === 'close') { jobs.delete(id); if (j && j.id === reviewShown) reviewShown = null; try { await api('DELETE', '/auto/' + id); } catch { /* already gone */ } paintAll(); }
    else if (b.dataset.q === 'review') $('#reviewPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (b.dataset.q === 'show') $('#aResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------------------------------------------------------- clip card (results + history) */
  function clipCard(r, opt = {}) {
    const tags = (r.hashtags || []).map(h => `<span class=htag>${esc(h)}</span>`).join(''), cap = [r.title, r.description, (r.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
    const auto = !!r.title;
    return `<div class="hcard${opt.picked ? ' picked' : ''}" data-key="${esc(r.key)}">
    <div class=hc-top>${opt.select ? `<input type=checkbox class=pick data-act=pick aria-label="Pilih klip" ${opt.picked ? 'checked' : ''}>` : '<span></span>'}
      <button type=button class="px starb${r.fav ? ' on' : ''}" data-act=fav title="${r.fav ? 'Hapus dari favorit' : 'Tandai favorit'}" aria-pressed="${!!r.fav}">${r.fav ? '★' : '☆'}</button></div>
    <video src="${esc(r.url)}" controls preload=metadata></video>
    <div class=meta>
    ${r.grade ? `<div class=gradebox><span class="grade g${esc(r.grade)}">${esc(r.grade)}</span><span class=gnum>${r.score != null ? esc(r.score) : '--'}</span><span class=glabel>Viral<br>score</span></div>` : ''}
    <div class=badges><span class="badge hl">${esc(r.mode)}</span><span class=badge>${esc(r.resolution)}</span>${r.segments > 1 ? `<span class=badge>${r.segments} potongan</span>` : ''}${!auto && r.preset ? `<span class=badge>${esc(r.preset)}${r.word ? ' ·kata' : ''}</span>` : ''}${!auto && r.logo ? '<span class=badge>logo</span>' : ''}${!auto && r.sticker ? '<span class=badge>sticker</span>' : ''}</div>
    ${auto ? `<b style="font-size:13px">${esc(r.title || 'Momen')}</b>${r.description ? `<div class=desc>${esc(r.description)}</div>` : ''}<div class=reason>${esc(r.reason)}</div>${tags ? `<div class=htags>${tags}</div>` : ''}` : ''}
    <time style="margin-top:8px">${new Date(r.time).toLocaleString('id-ID')}</time>
    <div class=acts><a href="${esc(r.url)}" download><svg class=ic14><use href="#i-download"/></svg> Unduh</a>${r.srt ? `<a href="${esc(r.srt)}" download>.srt</a>` : ''}
    ${cap ? `<button type=button class="px ghost cap" data-act=copy data-cap="${esc(cap)}"><svg class=ic14><use href="#i-copy"/></svg> Salin caption</button>` : ''}
    <a href="#" class=danger data-act=del>Hapus</a></div></div></div>`;
  }
  window.autoCard = r => clipCard(r);

  async function onCardClick(e) {
    const a = e.target.closest('[data-act]'); if (!a) return; const card = a.closest('.hcard'), key = card?.dataset.key, act = a.dataset.act;
    if (act === 'copy') { try { await navigator.clipboard.writeText(a.dataset.cap); toast('Caption tersalin.', 'ok'); } catch { toast('Gagal menyalin.', 'err'); } }
    else if (act === 'fav') { const on = a.getAttribute('aria-pressed') !== 'true'; try { await api('PATCH', '/history/' + encodeURIComponent(key), { fav: on }); patchFav(key, on); } catch (er) { toast(er.message, 'err'); } }
    else if (act === 'del') { e.preventDefault(); if (!confirm('Hapus klip ini?')) return; await fetch('/history/' + encodeURIComponent(key), { method: 'DELETE' }); removeFromJobs([key]); loadHist(); paintResults(); }
    else if (act === 'pick') { H.sel[a.checked ? 'add' : 'delete'](key); card.classList.toggle('picked', a.checked); paintSelBar(); }
    else if (act === 'zip') downloadZip((jobs.get(a.dataset.id)?.clips || []).map(c => c.key));
  }
  function patchFav(key, on) {
    H.all.forEach(r => { if (r.key === key) r.fav = on || undefined; }); jobs.forEach(j => (j.clips || []).forEach(c => { if (c.key === key) c.fav = on || undefined; }));
    paintResults(); if ($('#view-library').classList.contains('active')) paintHist();
  }
  const removeFromJobs = keys => jobs.forEach(j => { j.clips = (j.clips || []).filter(c => !keys.includes(c.key)); });
  const downloadZip = keys => { if (!keys.length) return; const a = document.createElement('a'); a.href = '/history/zip?keys=' + encodeURIComponent(keys.join(',')); a.download = ''; document.body.append(a); a.click(); a.remove(); toast('Menyiapkan ZIP…'); };

  function paintResults() {
    const host = $('#aResults'); if (!host) return;
    const groups = [...jobs.values()].filter(j => (j.clips || []).length).sort((a, b) => b.created - a.created);
    host.innerHTML = groups.length ? groups.map(j => `<div class=jgroup><b title="${esc(j.label)}">${esc(shortLabel(j))}</b><span>${j.clips.length} klip${TERMINAL.includes(j.status) ? '' : ' · berjalan'}</span><i class=sp></i>
      <button type=button class="px mini" data-act=zip data-id="${j.id}">Unduh ZIP</button></div>` + j.clips.map(c => clipCard(c)).join('')).join('')
      : '<div class=empty><svg class=xh><use href="#i-cross"/></svg>Hasil short akan muncul di sini setelah diproses</div>';
  }

  /* ---------------------------------------------------------------- review: pick, trim, and retitle before rendering */
  function paintReview() {
    const host = $('#reviewPanel'), j = [...jobs.values()].filter(x => x.status === 'review' && x.candidates).sort((a, b) => a.created - b.created)[0];
    if (!j) { host.hidden = true; host.innerHTML = ''; reviewShown = null; return; }
    if (reviewShown === j.id) return; // keep the user's edits while other jobs keep polling
    reviewShown = j.id; host.hidden = false;
    host.innerHTML = `<div class=rhead><div><div class=viewkick style="margin:0 0 8px">REVIEW // ${j.candidates.length} MOMEN</div><h3>Tinjau sebelum render</h3>
      <p>${esc(shortLabel(j))}. Geser garis oranye untuk memotong, ubah judul dan hook, lalu centang klip yang ingin dirender. Hanya klip terpilih yang memakai kuota.</p></div></div>
      <div class=rlist>${j.candidates.map((c, i) => reviewCard(j, c, i)).join('')}</div>
      <div class=rfoot><span class=rsum id=rsum></span><button type=button class="px ghost" id=rAll>Pilih semua</button><button type=button class="px ghost" id=rNone>Kosongkan</button>
      <button type=button class="px danger ghost" id=rCancel>Batalkan job</button><button type=button class="px primary" id=rGo>Render</button></div>`;
    $$('.rc', host).forEach((card, i) => {
      const c = j.candidates[i], video = $('video', card), segs = $('.rsegs', card);
      c.segs.forEach((s, k) => {
        const t = trimmer({ video, a: s.start, b: s.end, max: s.end + 30, onChange: () => sumUp() });
        t.el.dataset.k = k; if (c.segs.length > 1) t.el.insertAdjacentHTML('afterbegin', `<div class=flabel style="margin-bottom:6px">Potongan ${k + 1}</div>`);
        t.el.addEventListener('focusin', () => { video.currentTime = t.get()[0]; });
        segs.append(t.el); (card._t = card._t || []).push(t);
      });
    });
    host.onchange = e => { if (e.target.classList.contains('rinc')) { e.target.closest('.rc').classList.toggle('off', !e.target.checked); sumUp(); } };
    $('#rAll').onclick = () => { $$('.rinc', host).forEach(c => { c.checked = true; c.closest('.rc').classList.remove('off'); }); sumUp(); };
    $('#rNone').onclick = () => { $$('.rinc', host).forEach(c => { c.checked = false; c.closest('.rc').classList.add('off'); }); sumUp(); };
    $('#rCancel').onclick = async () => { if (!confirm('Batalkan job ini? Tidak ada klip yang dirender.')) return; try { await api('DELETE', '/auto/' + j.id); } catch (e) { toast(e.message, 'err'); } jobs.delete(j.id); reviewShown = null; paintAll(); };
    $('#rGo').onclick = async () => {
      const clips = $$('.rc', host).filter(c => $('.rinc', c).checked).map(card => ({ i: +card.dataset.i, title: $('.rtitle', card).value, hook: $('.rhook', card).value, segs: card._t.map(t => { const [start, end] = t.get(); return { start, end }; }) }));
      if (!clips.length) return toast('Centang minimal satu klip.', 'err');
      $('#rGo').disabled = true;
      try { await api('POST', `/auto/${j.id}/render`, { clips }); jobs.set(j.id, { ...j, status: 'queued', stage: 'queue', step: 'Menunggu antrean…' }); reviewShown = null; toast(clips.length + ' klip masuk antrean render.', 'ok'); tick(); }
      catch (e) { toast(e.message, 'err'); $('#rGo').disabled = false; }
    };
    const sumUp = () => {
      const n = $$('.rinc:checked', host).length, u = window.__klipUser, cap = u?.limits.clipsPerMonth, left = cap == null ? Infinity : Math.max(0, cap - u.usage.clips);
      $('#rsum').innerHTML = `${n} dari ${j.candidates.length} klip dipilih` + (left === Infinity ? '' : ` · sisa kuota bulan ini <b>${left}</b>`) + (n > left ? ' <span class=warn>· melebihi kuota, klip terakhir akan gagal</span>' : '');
      $('#rGo').textContent = n ? `Render ${n} klip` : 'Render'; $('#rGo').disabled = !n;
    };
    sumUp(); host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function reviewCard(j, c, i) {
    return `<article class=rc data-i="${i}"><div><video src="/src/${j.srcId}.mp4#t=${c.segs[0].start}" controls preload=metadata playsinline></video></div>
      <div class=rcb><div class=rch><span class=rn>${String(i + 1).padStart(2, '0')}</span><label class=chip><input type=checkbox class=rinc checked> Render</label>
        ${c.grade ? `<span class="grade g${esc(c.grade)}">${esc(c.grade)}</span>` : ''}${c.score != null ? `<span class=mono style="font-size:12px">${esc(c.score)}/100</span>` : ''}</div>
      <div class=two><div><label class=fld>Judul</label><input class=rtitle value="${esc(c.title || '')}" maxlength=120></div><div><label class=fld>Hook (maks 4 kata)</label><input class=rhook value="${esc(c.hook || '')}" maxlength=24></div></div>
      <div class=rsegs></div>${c.reason ? `<div class=reason>${esc(c.reason)}</div>` : ''}</div></article>`;
  }

  function paintAll() { paintQueue(); paintResults(); paintReview(); }

  /* ---------------------------------------------------------------- Riwayat: search, filter, favourites, select, ZIP */
  const H = { all: [], q: '', grade: 'all', fav: false, sort: 'new', selecting: false, sel: new Set() };
  function upgradeLibrary() {
    const hist = $('#hist'); if (!hist) return;
    hist.insertAdjacentHTML('beforebegin', `<div class=hbar><input id=hq type=search placeholder="Cari judul, hashtag, atau caption…" aria-label="Cari klip">
      <div class=gchips id=hg><button type=button class="px on" data-g=all>Semua</button><button type=button class=px data-g=A>A</button><button type=button class=px data-g=B>B</button><button type=button class=px data-g=C>C</button><button type=button class=px data-g=D>D</button></div>
      <label class=chip><input type=checkbox id=hfav> ★ Favorit</label>
      <select id=hsort aria-label="Urutkan"><option value=new>Terbaru</option><option value=old>Terlama</option><option value=score>Skor tertinggi</option></select>
      <button type=button class=px id=hsel>Pilih</button></div><div class=hsum id=hsum></div>
      <div class=hselbar id=hselbar hidden><span id=hselc></span><button type=button class=px id=hselall>Pilih semua</button><button type=button class="px primary" id=hzip>Unduh ZIP</button><button type=button class="px" id=hdelsel>Hapus</button><button type=button class=px id=hdone>Selesai</button></div>`);
    hist.addEventListener('click', onCardClick);
    let debounce; $('#hq').addEventListener('input', e => { clearTimeout(debounce); debounce = setTimeout(() => { H.q = e.target.value.trim().toLowerCase(); paintHist(); }, 150); });
    $('#hg').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; H.grade = b.dataset.g; $$('#hg button').forEach(x => x.classList.toggle('on', x === b)); paintHist(); });
    $('#hfav').addEventListener('change', e => { H.fav = e.target.checked; paintHist(); });
    $('#hsort').addEventListener('change', e => { H.sort = e.target.value; paintHist(); });
    const mode = on => { H.selecting = on; if (!on) H.sel.clear(); $('#hsel').textContent = on ? 'Selesai' : 'Pilih'; paintHist(); };
    $('#hsel').addEventListener('click', () => mode(!H.selecting)); $('#hdone').addEventListener('click', () => mode(false));
    $('#hselall').addEventListener('click', () => { visible().forEach(r => H.sel.add(r.key)); paintHist(); });
    $('#hzip').addEventListener('click', () => downloadZip([...H.sel]));
    $('#hdelsel').addEventListener('click', async () => {
      const keys = [...H.sel]; if (!keys.length || !confirm(`Hapus ${keys.length} klip? Tidak bisa dibatalkan.`)) return;
      try { const r = await api('POST', '/history/delete', { keys }); toast(r.removed + ' klip dihapus.'); removeFromJobs(keys); mode(false); await loadHist(); paintResults(); } catch (e) { toast(e.message, 'err'); }
    });
  }
  const visible = () => {
    let l = H.all.filter(r => (H.grade === 'all' || r.grade === H.grade) && (!H.fav || r.fav) &&
      (!H.q || [r.title, r.description, r.reason, r.mode, r.preset, (r.hashtags || []).join(' ')].join(' ').toLowerCase().includes(H.q)));
    if (H.sort === 'old') l = l.slice().reverse(); else if (H.sort === 'score') l = l.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return l;
  };
  function paintSelBar() { const b = $('#hselbar'); if (!b) return; b.hidden = !H.selecting; $('#hselc').textContent = H.sel.size + ' dipilih'; $('#hzip').disabled = $('#hdelsel').disabled = !H.sel.size; }
  function paintHist() {
    const host = $('#hist'); if (!host) return; const list = visible(), graded = H.all.filter(r => r.score != null), avg = graded.length ? Math.round(graded.reduce((n, r) => n + r.score, 0) / graded.length) : null;
    $('#hsum').textContent = `${list.length === H.all.length ? list.length : list.length + ' dari ' + H.all.length} klip · ${H.all.filter(r => r.fav).length} favorit${avg != null ? ' · skor rata-rata ' + avg : ''}`;
    host.innerHTML = list.length ? list.map(r => clipCard(r, { select: H.selecting, picked: H.sel.has(r.key) })).join('')
      : `<div class=empty><svg class=xh><use href="#i-cross"/></svg>${H.all.length ? 'Tidak ada klip yang cocok dengan filter' : 'Belum ada klip'}</div>`;
    paintSelBar();
  }
  window.loadHist = async function () { try { H.all = (await api('GET', '/history')).history || []; } catch { return; } paintHist(); };

  /* ---------------------------------------------------------------- Editor: trim timeline for the manual cut */
  function upgradeEditor() {
    const v = $('#src'); if (!v) return;
    v.insertAdjacentHTML('afterend', '<div id=edTrim></div>');
    let t = null;
    const build = () => {
      if (!isFinite(v.duration) || !v.duration) return;
      const a = +$('#s').value || 0, b = +$('#e').value || Math.min(a + 30, v.duration);
      $('#edTrim').innerHTML = ''; t = trimmer({ video: v, a: Math.min(a, v.duration - 0.5), b: Math.min(b, v.duration), max: v.duration, onChange: (x, y) => { $('#s').value = x.toFixed(1); $('#e').value = y.toFixed(1); } });
      $('#edTrim').append(t.el); $('#s').value = t.get()[0].toFixed(1); $('#e').value = t.get()[1].toFixed(1);
    };
    v.addEventListener('loadedmetadata', build);
    const sync = () => { if (t) t.set(+$('#s').value || 0, +$('#e').value || 0); };
    $('#s').addEventListener('change', sync); $('#e').addEventListener('change', sync);
    const use = window.use; window.use = (...a) => { use(...a); sync(); if (t) v.currentTime = t.get()[0]; };
  }

  /* ---------------------------------------------------------------- app updates (server: /update, lib/updater.js) */
  const UPD = { s: null, snoozeKey: 'updateSnooze', skipKey: 'updateSkip', timer: 0, open: false };
  const mb = n => (n / 1048576).toFixed(0) + ' MB';
  async function checkUpdate(force) {
    let s; try { s = await api('GET', '/update' + (force ? '?force=1' : '')); } catch { return null; }
    UPD.s = s; paintUpdatePill();
    const snoozed = (store.get(UPD.snoozeKey) || 0) > Date.now(), skipped = store.get(UPD.skipKey) === s.latest;
    if (s.available && !UPD.open && !snoozed && !skipped) showUpdate();
    if (s.install && ['downloading', 'verifying', 'installing'].includes(s.install.state) && !UPD.open) showUpdate();   // page reloaded mid-install
    return s;
  }
  function paintUpdatePill() {
    const s = UPD.s, host = $('.strip > div:first-child'); if (!host) return;
    let b = $('#updPill'); if (!s || !s.available) return b && b.remove();
    if (!b) { b = document.createElement('button'); b.type = 'button'; b.id = 'updPill'; b.className = 'px mini updpill'; b.addEventListener('click', showUpdate); host.append(b); }
    b.textContent = '⬆ Update ' + s.latest;
  }
  function showUpdate() {
    const s = UPD.s; if (!s || !s.available || UPD.open) return; UPD.open = true;
    const ov = document.createElement('div'); ov.className = 'updov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'updT');
    ov.innerHTML = `<div class=upd><header><span>Pembaruan <b>tersedia</b></span><span>${esc(s.asset ? s.asset.name.replace(/^Hellens-Clipper-/, '') : '')}</span></header>
      <div class=ub><h3 id=updT>Versi baru siap dipasang</h3><div class=vv>${esc(s.current)} <i>→</i> <span>${esc(s.latest)}</span>${s.asset && s.asset.size ? ` <i>· ${mb(s.asset.size)}</i>` : ''}</div>
      ${s.notes ? `<pre>${esc(s.notes)}</pre>` : ''}
      <div class=uprog><i></i></div><div class=um id=updM>${s.canInstall ? 'Aplikasi akan mengunduh, memverifikasi checksum, memasang, lalu memulai ulang. Video dan riwayatmu tidak disentuh.' : 'Pemasangan otomatis tidak tersedia di perangkat ini. Unduh versi baru dari halaman rilis.'}</div>
      <div class=uact>${s.canInstall ? '<button type=button class="px primary" id=updGo>Perbarui sekarang</button>' : `<a class=btnlike target=_blank rel=noopener href="${esc(s.page || '#')}">Buka halaman unduhan</a>`}
      <button type=button class=px id=updLater>Nanti</button><button type=button class=px id=updSkip>Lewati versi ini</button></div></div></div>`;
    document.body.append(ov);
    const close = () => { ov.remove(); UPD.open = false; document.removeEventListener('keydown', esc_); };
    const esc_ = e => { if (e.key === 'Escape' && !UPD.busy) { snooze(); close(); } };
    const snooze = () => store.set(UPD.snoozeKey, Date.now() + 6 * 36e5);
    document.addEventListener('keydown', esc_);
    $('#updLater', ov).onclick = () => { snooze(); close(); };
    $('#updSkip', ov).onclick = () => { store.set(UPD.skipKey, s.latest); close(); paintUpdatePill(); toast('Versi ' + s.latest + ' dilewati. Pembaruan berikutnya tetap diberi tahu.'); };
    ov.addEventListener('click', e => { if (e.target === ov && !UPD.busy) { snooze(); close(); } });
    const go = $('#updGo', ov); if (go) { go.focus(); go.onclick = () => runInstall(ov); }
    if (s.install && ['downloading', 'verifying', 'installing'].includes(s.install.state)) runInstall(ov, true);
  }
  async function runInstall(ov, resume) {
    const msg = $('#updM', ov), bar = $('.uprog', ov), fill = $('.uprog i', ov); UPD.busy = true;
    $$('.uact button', ov).forEach(b => { b.disabled = true; }); bar.style.display = 'block';
    try { if (!resume) await api('POST', '/update/install'); }
    catch (e) { msg.textContent = e.message; msg.classList.add('err'); UPD.busy = false; $$('.uact button', ov).forEach(b => { b.disabled = false; }); return; }
    let sawInstalling = false;
    for (;;) {
      await new Promise(r => setTimeout(r, 700));
      let s; try { s = await api('GET', '/update'); } catch { if (sawInstalling) return done(); continue; }   // the app quit to restart itself
      const i = s.install || {};
      if (i.state === 'downloading') { fill.style.width = (i.pct || 0) + '%'; msg.textContent = `Mengunduh… ${i.pct || 0}%`; }
      else if (i.state === 'verifying') { fill.style.width = '100%'; msg.textContent = 'Memverifikasi checksum…'; }
      else if (i.state === 'installing') { sawInstalling = true; fill.style.width = '100%'; msg.textContent = 'Memasang dan memulai ulang… jangan tutup aplikasi.'; }
      else if (i.state === 'error') { msg.textContent = 'Gagal: ' + i.error; msg.classList.add('err'); UPD.busy = false; $$('.uact button', ov).forEach(b => { b.disabled = false; }); $('#updGo', ov)?.replaceChildren('Coba lagi'); return; }
      else if (!s.available) return done();                                                          // already on the new version
    }
    function done() { msg.textContent = 'Selesai. Hellens Clipper memulai ulang dan membuka tab baru. Tab ini boleh ditutup.'; fill.style.width = '100%'; UPD.busy = false; }
  }
  setTimeout(() => checkUpdate(false), 2500);
  setInterval(() => checkUpdate(false), 30 * 6e4);
  addEventListener('focus', () => { if (!UPD.s || Date.now() - (UPD.s.checkedAt || 0) > 36e5) checkUpdate(false); });

  /* ---------------------------------------------------------------- boot */
  upgradeAuto(); upgradeLibrary(); upgradeEditor(); paintPresets();
  loadPresets(); loadHist(); updateSpec();
  api('GET', '/auto').then(r => { (r.jobs || []).forEach(j => jobs.set(j.id, j)); paintAll(); if ([...jobs.values()].some(j => !TERMINAL.includes(j.status))) tick(); }).catch(() => {});
  setInterval(() => { if ([...jobs.values()].some(j => !TERMINAL.includes(j.status))) paintQueue(); }, 1000); // keep the elapsed clocks moving between polls
})();
