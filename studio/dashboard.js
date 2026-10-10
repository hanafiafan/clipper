/* Dashboard for the studio: a home view with quota, plan, engine status, activity and shortcuts, plus a plan card in the sidebar.
   Loaded by account.js once the user is known; reads /history, /providers and the account (window.__klipUser). */
(() => {
  'use strict';
  if (document.getElementById('view-dashboard')) return;
  const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = document.createElement('style');
  css.textContent = `
  .dash{display:grid;gap:16px}
  .dgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .dtile{background:var(--surface);border:1px solid var(--line2);padding:16px 18px;box-shadow:4px 4px 0 var(--line);position:relative}
  .dtile small{display:block;font:600 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .dtile strong{display:block;font:400 44px/1.05 Anton,sans-serif;margin-top:6px;text-transform:uppercase}
  .dtile em{font:normal 11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .dtile.acc{background:var(--accent);color:#fff;border-color:var(--text)}.dtile.acc small,.dtile.acc em{color:rgba(255,255,255,.85)}
  .dmeter{height:12px;border:1px solid var(--text);background:var(--surface2);margin:10px 0 6px}.dmeter i{display:block;height:100%;background:var(--accent)}
  .dcols{display:grid;grid-template-columns:1.6fr 1fr;gap:16px;align-items:start}
  .dlist{display:grid;gap:0}.drow{display:grid;grid-template-columns:44px 1fr auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px dashed var(--line);cursor:pointer;background:none;border-left:0;border-right:0;border-top:0;text-align:left;color:inherit;font:inherit;width:100%}
  .drow:hover b{color:var(--accent)}.drow .g{font:400 26px Anton,sans-serif;text-align:center;border:1px solid var(--line2);padding:2px 0}
  .drow b{font-size:13px;display:block}.drow small{font:11px var(--mono);color:var(--muted);text-transform:uppercase}
  .dstat{display:flex;justify-content:space-between;font:11px var(--mono);text-transform:uppercase;letter-spacing:.04em;padding:8px 0;border-bottom:1px dashed var(--line)}
  .dstat b{color:var(--accent)}.dstat b.ok{color:#1c7c54}.dstat b.warn{color:#b3261e}
  .dgo{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:6px}
  .dgo button{cursor:pointer;background:var(--surface2);border:1px solid var(--line2);padding:12px;font:700 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:inherit;text-align:left}
  .dgo button:hover{background:var(--text);color:var(--bg)}
  .bars6{display:flex;gap:6px;align-items:flex-end;height:90px;margin-top:8px}.bars6 i{flex:1;background:var(--accent);min-height:3px;display:block}
  .drow::after,.dgo button::after{content:none!important}
  .planbox{color:var(--text);margin-top:14px;padding:12px;border:1px solid var(--line2);background:var(--surface2);font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase}
  .planbox b{display:block;font:400 18px Anton,sans-serif;letter-spacing:.04em;margin:2px 0 6px}
  .planbox .dmeter{height:8px;margin:6px 0}.planbox a{color:var(--accent);text-decoration:none;font-weight:700}
  @media(max-width:1000px){.dgrid{grid-template-columns:repeat(2,1fr)}.dcols{grid-template-columns:1fr}}`;
  document.head.appendChild(css);

  // --- view + nav entry (first in the sidebar, becomes the landing view)
  VIEWS.dashboard = ['Dashboard', 'Ringkasan kuota, aktivitas, dan status mesin', '00', 'OVERVIEW // CONTROL ROOM'];
  document.querySelector('.navitem').insertAdjacentHTML('beforebegin', '<button class=navitem data-view=dashboard onclick="showView(\'dashboard\')"><svg class=ic><use href="#i-library"/></svg> Dashboard</button>');
  const sec = document.createElement('section');
  sec.id = 'view-dashboard'; sec.className = 'view'; sec.innerHTML = '<div class=dash id=dashBody></div>';
  $('#view-auto').before(sec);

  const sidePlan = document.createElement('div'); sidePlan.className = 'planbox'; sidePlan.id = 'sidePlan';
  $('.sidefoot').before(sidePlan);

  const quota = u => { const cap = u.limits.clipsPerMonth, used = u.usage.clips; return { cap, used, left: cap == null ? null : Math.max(0, cap - used), pct: cap ? Math.min(100, used / cap * 100) : 0 }; };

  function paintSide(u) {
    const q = quota(u);
    sidePlan.innerHTML = `Plan aktif<b>${esc(u.limits.name)}</b>${q.used}/${q.cap ?? '∞'} klip bulan ini<div class=dmeter><i style="width:${q.pct}%"></i></div>${u.plan === 'enterprise' ? 'Kuota tanpa batas' : '<a href="/#/akun">Upgrade plan →</a>'}`;
  }

  async function paint() {
    const u = window.__klipUser; if (!u) return;
    paintSide(u);
    const [hist, prov] = await Promise.all([
      fetch('/history').then(r => r.json()).then(x => x.history || []).catch(() => []),
      fetch('/providers').then(r => r.json()).then(x => x.providers || []).catch(() => [])
    ]);
    const q = quota(u), month = new Date().toISOString().slice(0, 7);
    const auto = hist.filter(r => r.title), thisMonth = hist.filter(r => (r.time || '').startsWith(month));
    const graded = auto.filter(r => r.score != null), avg = graded.length ? Math.round(graded.reduce((a, r) => a + r.score, 0) / graded.length) : null;
    const best = graded.sort((a, b) => b.score - a.score)[0];
    const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10); return hist.filter(r => (r.time || '').startsWith(d)).length; });
    const dmax = Math.max(1, ...days);
    const mix = {}; hist.forEach(r => { const k = r.preset || 'tanpa caption'; mix[k] = (mix[k] || 0) + 1; });
    const topMix = Object.entries(mix).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${esc(k)} (${v})`).join(' · ') || '—';
    $('#dashBody').innerHTML = `
    <div class=dgrid>
      <div class="dtile acc"><small>Kuota bulan ini</small><strong>${q.used}<span style="font-size:22px"> / ${q.cap ?? '∞'}</span></strong><div class=dmeter style="border-color:#fff;background:rgba(255,255,255,.25)"><i style="background:#fff;width:${q.pct}%"></i></div><em>${q.left == null ? 'Tanpa batas' : q.left + ' klip tersisa'}</em></div>
      <div class=dtile><small>Klip dibuat bulan ini</small><strong>${thisMonth.length}</strong><em>${hist.length} total di riwayat</em></div>
      <div class=dtile><small>Skor viral rata-rata</small><strong>${avg ?? '—'}</strong><em>${best ? 'Terbaik: ' + esc(best.grade || '') + ' · ' + best.score : 'Belum ada skor'}</em></div>
      <div class=dtile><small>Plan</small><strong>${esc(u.limits.name)}</strong><em>Maks ${esc(u.limits.maxResolution)} · ${u.limits.clipsPerJob} klip/proses</em></div>
    </div>
    <div class=dcols>
      <div>
        <div class=card><h2>Klip terbaru <span class=hcode>${Math.min(5, hist.length)}/${hist.length}</span></h2>
          <div class=dlist>${hist.slice(0, 5).map(r => `<button class=drow data-go=library><span class=g>${esc(r.grade || '·')}</span><span><b>${esc(r.title || r.mode)}</b><small>${esc(r.mode)} · ${esc(r.resolution)}${r.preset ? ' · ' + esc(r.preset) : ''}</small></span><small>${new Date(r.time).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</small></button>`).join('') || '<p class=hint style="color:var(--muted);font-size:13px">Belum ada klip. Mulai dari Auto — tempel satu link YouTube.</p>'}</div>
        </div>
        <div class=card><h2>Aktivitas 14 hari</h2><div class=bars6>${days.map((n, i) => `<i style="height:${Math.max(3, n / dmax * 100)}%" title="${n} klip"></i>`).join('')}</div></div>
      </div>
      <div>
        <div class=card><h2>Status mesin</h2>
          <div class=dstat><span>Pemrosesan</span><b class=ok>Lokal · video tetap di perangkat</b></div>
          <div class=dstat><span>Model AI siap</span><b class="${prov.length ? 'ok' : 'warn'}">${prov.length ? prov.map(esc).join(', ') : 'Belum ada API key'}</b></div>
          <div class=dstat><span>Gaya paling sering</span><b>${topMix}</b></div>
          <div class=dstat><span>Akun</span><b>${esc(u.email)}</b></div>
          ${prov.length ? '' : '<p style="margin-top:10px;font-size:12px"><a href="#" data-go=settings style="color:var(--accent)">Tambah API key di Pengaturan →</a></p>'}
        </div>
        <div class=card><h2>Pintasan</h2><div class=dgo>
          <button data-go=auto>⚡ Auto-clip</button><button data-go=editor>✂ Editor</button><button data-go=download>⤓ Downloader</button><button data-go=library>▦ Riwayat</button></div></div>
      </div>
    </div>`;
    $('#dashBody').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); showView(b.dataset.go); }));
  }

  const orig = window.showView;
  window.showView = v => { orig(v); if (v === 'dashboard') paint(); };
  window.__klipDash = { paint, paintSide };
  showView('dashboard');
})();
