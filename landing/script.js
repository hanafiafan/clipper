/* Landing page behaviour. Everything here is progressive enhancement: without JavaScript the page is a readable static document. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- nav turns solid after the hero ---------- */
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('solid', scrollY > 24);
  onScroll(); addEventListener('scroll', onScroll, { passive: true });

  /* ---------- hero: a field of small slanted marks (the logo's diagonal) that lean toward the pointer and ripple on click ---------- */
  const cv = $('#field');
  if (cv && cv.getContext) {
    const ctx = cv.getContext('2d');
    const BASE = -Math.PI / 3;                 // resting angle, like the bars in the logo
    const R = 170, WAVE = 46, LIFE = 900;      // pointer radius, ripple thickness, ripple duration (ms)
    let W = 0, H = 0, cell = 17, cols = 0, rows = 0, raf = 0;
    const mouse = { x: -1e4, y: -1e4, on: false };
    let ripples = [];

    const turn = (a, b, k) => { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k; };

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round'; ctx.lineWidth = 1.6;
      ripples = ripples.filter(r => t - r.t < LIFE);
      for (let j = 0; j < rows; j++) {
        const y = j * cell + cell / 2, fade = Math.max(0, 1 - (y / H) * 1.08);
        for (let i = 0; i < cols; i++) {
          const x = i * cell + cell / 2;
          let ang = BASE, len = 4.2, a = fade * 0.5 + 0.05;
          if (!reduce) {
            if (mouse.on) {
              const dx = mouse.x - x, dy = mouse.y - y, d = Math.hypot(dx, dy);
              if (d < R) { const k = 1 - d / R; ang = turn(BASE, Math.atan2(dy, dx), k); len += 3.4 * k; a += 0.45 * k; }
            }
            for (const r of ripples) {
              const age = (t - r.t) / LIFE, gap = Math.abs(Math.hypot(x - r.x, y - r.y) - age * Math.max(W, H) * 0.7);
              if (gap < WAVE) { const k = (1 - gap / WAVE) * (1 - age); len += 4.5 * k; a += 0.6 * k; }
            }
          }
          ctx.strokeStyle = `rgba(255,84,43,${Math.min(a, 1).toFixed(3)})`;
          const cx = Math.cos(ang) * len, cy = Math.sin(ang) * len;
          ctx.beginPath(); ctx.moveTo(x - cx, y - cy); ctx.lineTo(x + cx, y + cy); ctx.stroke();
        }
      }
    }
    // Animate only while something is moving; otherwise draw once and stay idle.
    function frame(t) { draw(t); raf = (mouse.on || ripples.length) ? requestAnimationFrame(frame) : 0; }
    const kick = () => { if (!raf && !reduce) raf = requestAnimationFrame(frame); };

    function size() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width; H = r.height; cell = W < 640 ? 14 : 17;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(W / cell); rows = Math.ceil(H / cell);
      draw(performance.now());
    }
    const hero = $('.hero');
    const at = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    hero.addEventListener('pointermove', e => { Object.assign(mouse, at(e), { on: true }); kick(); });
    hero.addEventListener('pointerleave', () => { mouse.on = false; kick(); });
    hero.addEventListener('pointerdown', e => { if (e.target.closest('a, button')) return; ripples.push({ ...at(e), t: performance.now() }); kick(); });
    new ResizeObserver(size).observe(hero);
    size();
  }

  /* ---------- helpers for the motion layer ---------- */
  // Wrap every word of a node's text in <span class=cls style=--i:n>, keeping inline elements such as <b>.
  const wrapWords = (node, cls, inner, n = { i: 0 }) => {
    [...node.childNodes].forEach(c => {
      if (c.nodeType === 3) {
        const f = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach(w => {
          if (!w) return;
          if (/^\s+$/.test(w)) return f.append(w);
          const o = document.createElement('span'); o.className = cls; o.style.setProperty('--i', n.i++);
          if (inner) { const i = document.createElement('span'); i.textContent = w; o.append(i); } else o.textContent = w;
          f.append(o);
        });
        c.replaceWith(f);
      } else if (c.nodeType === 1) wrapWords(c, cls, inner, n);
    });
  };
  const karaoke = p => {
    if (reduce || !p) return;
    if (!p.dataset.src) p.dataset.src = p.innerHTML;
    p.innerHTML = p.dataset.src; wrapWords(p, 'w', false);
  };

  /* ---------- roles: tabs with arrow-key navigation ---------- */
  const tabs = $$('[role=tab]'), panels = $$('[role=tabpanel]');
  const pick = (i, focus) => tabs.forEach((t, k) => {
    const on = k === i;
    t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; panels[k].hidden = !on;
    if (on && focus) t.focus();
    if (on) karaoke(panels[k]);
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(i));
    t.addEventListener('keydown', e => {
      const n = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (n) { e.preventDefault(); pick((i + n + tabs.length) % tabs.length, true); }
    });
  });
  if (tabs.length) pick(0);

  /* ---------- workflow list: filter, expand, save, copy ---------- */
  const steps = $$('.step'), saved = new Set();
  const counter = $('#saved'), copyBtn = $('#copy');
  const refresh = () => { if (counter) counter.textContent = saved.size; };
  steps.forEach(s => {
    const panel = $('.detail', s), toggle = $('.toggle', s), bm = $('.bm', s);
    panel.hidden = true;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open)); panel.hidden = open;
    });
    bm.addEventListener('click', () => {
      const on = bm.getAttribute('aria-pressed') !== 'true';
      bm.setAttribute('aria-pressed', String(on)); on ? saved.add(s) : saved.delete(s); refresh();
    });
  });
  $$('[data-filter]').forEach(chip => chip.addEventListener('click', () => {
    $$('[data-filter]').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    const f = chip.dataset.filter;
    steps.forEach(s => { s.hidden = f !== 'all' && s.dataset.tag !== f; });
  }));
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const list = (saved.size ? [...saved] : steps).map(s => `${$('.no', s).firstChild.textContent.trim()}. ${$('.ttl b', s).textContent}`).join('\n');
    try { await navigator.clipboard.writeText('Hellens Clipper — alur kerja\n' + list); copyBtn.textContent = 'Tersalin ✓'; }
    catch (_) { copyBtn.textContent = 'Gagal menyalin'; }
    setTimeout(() => { copyBtn.textContent = 'Salin daftar'; }, 2000);
  });
  refresh();

  /* ---------- copy buttons for terminal commands ---------- */
  $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const text = $('code', b.parentElement).textContent.trim();
    try { await navigator.clipboard.writeText(text); b.textContent = 'Tersalin ✓'; } catch (_) { b.textContent = 'Salin manual'; }
    setTimeout(() => { b.textContent = 'Salin'; }, 2000);
  }));

  /* ================= motion layer ================= */
  /* scroll progress, hero parallax + fade */
  const prog = $('.progress'), body = $('.hero-body'), heroEl = $('.hero');
  const onScroll2 = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (prog) prog.style.setProperty('--p', max > 0 ? Math.min(scrollY / max, 1).toFixed(4) : 0);
    if (body && !reduce && scrollY < innerHeight * 1.2) {
      body.style.setProperty('--sy', (scrollY * 0.28).toFixed(1) + 'px');
      body.style.setProperty('--so', Math.max(0, 1 - scrollY / (innerHeight * 0.75)).toFixed(3));
    }
  };
  onScroll2(); addEventListener('scroll', onScroll2, { passive: true });

  /* hero: title letters rise in, subtitle types out, content drifts against the pointer */
  const h1 = $('.hero h1');
  if (h1 && !reduce) {
    const n = { i: 0 }, t = [...h1.childNodes].find(c => c.nodeType === 3 && c.textContent.trim());
    if (t) { const f = document.createDocumentFragment(); [...t.textContent.trim()].forEach(ch => { const s = document.createElement('span'); s.className = 'ch'; s.setAttribute('aria-hidden', 'true'); s.style.setProperty('--i', n.i++); s.textContent = ch; f.append(s); }); t.replaceWith(f); }
    const sub = $('.hero-body p');
    if (sub) {
      const full = sub.textContent; sub.setAttribute('aria-label', full); sub.textContent = ''; sub.classList.add('typing');
      let k = 0; setTimeout(function tick() { sub.textContent = full.slice(0, ++k); if (k < full.length) setTimeout(tick, 28); else setTimeout(() => sub.classList.remove('typing'), 1400); }, 900);
    }
    heroEl.addEventListener('pointermove', e => {
      const r = heroEl.getBoundingClientRect();
      body.style.setProperty('--px', (((e.clientX - r.left) / r.width - .5) * -18).toFixed(1) + 'px');
      body.style.setProperty('--py', (((e.clientY - r.top) / r.height - .5) * -12).toFixed(1) + 'px');
    });
  }

  /* magnetic buttons */
  if (!reduce && matchMedia('(hover: hover)').matches) $$('.btn.solid, .btn.dark, .pillbtn').forEach(b => {
    b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.setProperty('--mx', ((e.clientX - r.left - r.width / 2) * .22).toFixed(1) + 'px'); b.style.setProperty('--my', ((e.clientY - r.top - r.height / 2) * .35).toFixed(1) + 'px'); });
    b.addEventListener('pointerleave', () => { b.style.removeProperty('--mx'); b.style.removeProperty('--my'); });
  });

  /* screenshots tilt toward the pointer */
  if (!reduce && matchMedia('(hover: hover)').matches) $$('.frame').forEach(f => {
    f.addEventListener('pointermove', e => { const r = f.getBoundingClientRect(); f.style.setProperty('--ry', (((e.clientX - r.left) / r.width - .5) * 5).toFixed(2) + 'deg'); f.style.setProperty('--rx', (((e.clientY - r.top) / r.height - .5) * -4).toFixed(2) + 'deg'); });
    f.addEventListener('pointerleave', () => { f.style.removeProperty('--rx'); f.style.removeProperty('--ry'); });
  });

  /* map packets stop for reduced motion */
  if (reduce) $$('.map svg.lines').forEach(v => v.pauseAnimations && v.pauseAnimations());

  /* reveal on scroll: headings split into words, blocks fade up in sequence, numbers count */
  const split = $$('.sec > .wrap > h2, .sec-head h2, .band h2');
  if (!reduce) split.forEach(h => { wrapWords(h, 'wd', true); h.classList.add('split'); });
  const rvSel = ['.lede', '.cols3 article', '.tabs', '.role-text:not([hidden])', '.counter', '.chips', '.step', '.shot', '.plan', '.note', '.dl-block', '.map', '.faq details', '.band p', '.band .hero-cta', '.statrow > div', '.giant'];
  const groups = new Map();
  if (!reduce) $$(rvSel.join(',')).forEach(el => {
    const g = el.parentElement; const d = groups.get(g) || 0; groups.set(g, d + 1);
    el.classList.add('rv'); el.style.setProperty('--d', Math.min(d, 8));
  });
  const count = el => {
    const to = +el.dataset.count, from = +(el.dataset.from || 0), sfx = el.dataset.suffix || '', t0 = performance.now();
    (function f(t) { const k = Math.min((t - t0) / 1400, 1), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(from + (to - from) * e) + sfx; if (k < 1) requestAnimationFrame(f); })(t0);
  };
  if (!reduce && 'IntersectionObserver' in window) {
    $$('[data-count]').forEach(el => { el.textContent = (el.dataset.from || 0) + (el.dataset.suffix || ''); });
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in'); io.unobserve(e.target);
      $$('[data-count]', e.target).concat(e.target.matches('[data-count]') ? [e.target] : []).forEach(count);
    }), { threshold: .15, rootMargin: '0px 0px -6% 0px' });
    $$('.rv, h2.split').forEach(el => io.observe(el));
  } else $$('.rv, h2.split').forEach(el => el.classList.add('in'));
})();
