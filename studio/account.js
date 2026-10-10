/* Account layer for the studio (the original single-file UI). Adds, without touching the studio's own code:
   plan + monthly quota in the top strip, links to Akun / Admin, Keluar, plan-based resolution locks,
   and a redirect to the login page when the session is missing or has expired. */
(() => {
  'use strict';
  const RANK = ['360p', '480p', '720p', '1080p', '1440p', '4k'];
  const $ = s => document.querySelector(s);
  let user = null, lastRefresh = 0;
  const toLogin = () => location.replace('/');

  const css = document.createElement('style');
  css.textContent = `
    .acct{display:inline-flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:flex-end}
    .acct b{color:var(--accent)}
    .acct a,.acct button{all:unset;cursor:pointer;color:inherit;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid transparent}
    .acct a:hover,.acct button:hover{border-bottom-color:currentColor}
    .acct a:focus-visible,.acct button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .acct .bar{display:inline-block;width:64px;height:6px;background:rgba(236,232,220,.22);vertical-align:middle;margin:0 6px}
    .acct .bar i{display:block;height:100%;background:var(--accent)}
    .lockedres{opacity:.4;cursor:not-allowed!important}`;
  document.head.appendChild(css);

  function render() {
    const host = $('#stripRight'); if (!host || !user) return;
    const cap = user.limits.clipsPerMonth, used = user.usage.clips, pct = cap ? Math.min(100, used / cap * 100) : 0;
    const admin = ['owner', 'admin'].includes(user.role);
    host.innerHTML = `<span class="acct"><span title="${user.email}">PLAN <b>${user.limits.name.toUpperCase()}</b></span>
      <span title="Kuota klip bulan ini">${used}/${cap ?? '∞'} KLIP<span class="bar"><i style="width:${pct}%"></i></span></span>
      <a href="/#/akun">AKUN</a>${admin ? '<a href="/#/admin">ADMIN</a>' : ''}<button type="button" id="acctLogout">KELUAR</button></span>`;
    $('#acctLogout').addEventListener('click', async () => { try { await fetch('/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {} toLogin(); });
  }

  // Resolutions above the plan's cap are disabled (the server enforces the cap too and answers 403 with the reason).
  function lockResolutions() {
    if (!user) return;
    const max = RANK.indexOf(user.limits.maxResolution), over = t => RANK.indexOf(String(t).trim()) > max;
    document.querySelectorAll('#aRes button').forEach(b => {
      if (over(b.textContent)) { b.disabled = true; b.classList.add('lockedres'); b.title = `Butuh plan lebih tinggi (plan ${user.limits.name}: maks ${user.limits.maxResolution})`; b.classList.remove('sel', 'active', 'on'); }
    });
    const sel = $('#res');
    if (sel) {
      [...sel.options].forEach(o => { if (over(o.value || o.text)) { o.disabled = true; o.text = o.text.replace(/ 🔒$/, '') + ' 🔒'; } });
      if (sel.selectedOptions[0]?.disabled) sel.value = user.limits.maxResolution;
    }
    const picked = document.querySelector('#aRes .sel, #aRes .active, #aRes .on, #aRes [aria-pressed=true]');
    if (!picked) { const ok = [...document.querySelectorAll('#aRes button:not([disabled])')].find(b => b.textContent.trim() === user.limits.maxResolution) || document.querySelector('#aRes button:not([disabled])'); ok?.click(); }
  }

  const import_dash = () => new Promise(ok => { const sc = document.createElement('script'); sc.src = '/studio/dashboard.js'; sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); });

  async function refresh() {
    lastRefresh = Date.now();
    const r = await fetch('/auth/me').catch(() => null);
    if (!r) return;
    if (r.status === 401) return toLogin();
    user = window.__klipUser = (await r.json()).user; render(); lockResolutions();
    if (!window.__klipDash) await import_dash(); else if (document.getElementById('view-dashboard')?.classList.contains('active')) window.__klipDash.paint(); else window.__klipDash.paintSide(user);
  }

  // Keep the quota fresh after a render finishes, and bounce to login if the session dies mid-use.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await realFetch(...args), url = String(args[0] && args[0].url || args[0]);
    if (res.status === 401 && !url.startsWith('/auth/')) toLogin();
    if (/^\/(clip|auto)/.test(url) && Date.now() - lastRefresh > 4000) setTimeout(refresh, 1200);
    return res;
  };

  addEventListener('focus', () => { if (Date.now() - lastRefresh > 10000) refresh(); });
  refresh();
})();
