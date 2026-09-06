/* Grandmama's Recipes — app.js (no build step, no framework) */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const $main = document.getElementById('main');
  const $footCount = document.getElementById('foot-count');

  // ------------------------------------------------------------------
  // Storage helpers (localStorage is per-device; everything degrades gracefully)
  // ------------------------------------------------------------------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('gr:' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('gr:' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };
  const favorites = new Set(store.get('favorites', []));
  const saveFavorites = () => store.set('favorites', [...favorites]);
  let recent = store.get('recent', []);
  const notes = store.get('notes', {});
  const checks = store.get('checks', {});
  const prefs = Object.assign({ tidyUnits: true }, store.get('prefs', {}));

  // ------------------------------------------------------------------
  // Fractions
  // ------------------------------------------------------------------
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const frac = (n, d = 1) => { const g = gcd(n, d) || 1; return [n / g, d / g]; };
  const mul = (a, b) => frac(a[0] * b[0], a[1] * b[1]);
  const toNum = (f) => f[0] / f[1];
  const VULGAR = { '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞', '1/6': '⅙', '5/6': '⅚' };

  // Round to the nearest kitchen-friendly fraction (eighths or thirds), or to halves for counted things.
  function kitchenRound(f, count) {
    const x = toNum(f);
    if (count) {
      if (x >= 10) return [Math.round(x), 1];
      return frac(Math.round(x * 2), 2);
    }
    const c8 = frac(Math.round(x * 8), 8);
    const c6 = frac(Math.round(x * 3), 3);
    const best = Math.abs(toNum(c6) - x) < Math.abs(toNum(c8) - x) - 1e-9 ? c6 : c8;
    if (best[0] === 0 && x > 0) return frac(1, 8);
    return best;
  }

  function fmtFrac(f) {
    const [n, d] = f;
    if (d === 1) return String(n);
    const whole = Math.floor(n / d);
    const rem = n - whole * d;
    const key = rem + '/' + d;
    const part = VULGAR[key] || (rem + '⁄' + d);
    return whole ? whole + (VULGAR[key] ? '' : ' ') + part : part;
  }

  // ------------------------------------------------------------------
  // Units
  // ------------------------------------------------------------------
  const PLURAL = {
    cup: 'cups', pint: 'pints', quart: 'quarts', gallon: 'gallons', clove: 'cloves', can: 'cans', package: 'packages',
    stick: 'sticks', slice: 'slices', head: 'heads', bunch: 'bunches', leaf: 'leaves', loaf: 'loaves', box: 'boxes',
    dash: 'dashes', pinch: 'pinches', drop: 'drops', sprig: 'sprigs', stalk: 'stalks', piece: 'pieces', jar: 'jars',
    bottle: 'bottles', bag: 'bags', envelope: 'envelopes', sheet: 'sheets', square: 'squares', cube: 'cubes', ear: 'ears',
    strip: 'strips', quarter: 'quarters', fillet: 'fillets', packet: 'packets', container: 'containers', handful: 'handfuls',
    stem: 'stems', round: 'rounds', cake: 'cakes', spear: 'spears', pony: 'ponies', batch: 'batches',
  };
  function unitLabel(unit, qty) {
    if (!unit) return '';
    const plural = qty && toNum(qty) > 1;
    return plural && PLURAL[unit] ? PLURAL[unit] : unit;
  }
  // Convert awkward scaled amounts to a friendlier unit when the result is exact and tidy.
  function tidy(qty, unit) {
    const x = toNum(qty);
    const nice = (f) => f[1] <= 4;
    if (unit === 'tsp' && x >= 3) { const t = frac(qty[0], qty[1] * 3); if (nice(t)) return [t, 'tbsp']; }
    if (unit === 'tbsp' && x >= 4) { const c = frac(qty[0], qty[1] * 16); if (nice(c) && toNum(c) >= 0.25) return [c, 'cup']; }
    if (unit === 'tbsp' && x < 1) { const t = frac(qty[0] * 3, qty[1]); if (t[1] === 1) return [t, 'tsp']; }
    if (unit === 'cup' && x < 0.25) { const t = frac(qty[0] * 16, qty[1]); if (t[1] === 1) return [t, 'tbsp']; }
    if (unit === 'oz' && x >= 16) { const p = frac(qty[0], qty[1] * 16); if (nice(p)) return [p, 'lb']; }
    if (unit === 'cup' && x >= 4) { const q = frac(qty[0], qty[1] * 4); if (q[1] === 1) return [q, 'quart']; }
    return [qty, unit];
  }

  // ------------------------------------------------------------------
  // Data + search index
  // ------------------------------------------------------------------
  let recipes = [];
  let bySlug = new Map();
  let tips = [];
  let mini = null;
  let categories = []; // [{name, count}]
  let cooks = [];      // [{name, count}]

  async function loadData() {
    const [r, t] = await Promise.all([
      fetch('data/recipes.json').then((x) => x.json()),
      fetch('data/tips.json').then((x) => x.json()).catch(() => []),
    ]);
    recipes = r;
    tips = t;
    bySlug = new Map(recipes.map((x) => [x.slug, x]));
    const cc = new Map();
    const kk = new Map();
    for (const rec of recipes) {
      for (const c of rec.categories) cc.set(c, (cc.get(c) || 0) + 1);
      kk.set(rec.cook, (kk.get(rec.cook) || 0) + 1);
    }
    categories = [...cc].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    cooks = [...kk].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    mini = new MiniSearch({
      fields: ['title', 'ingredients', 'categories', 'cook', 'notes'],
      storeFields: ['slug'],
      idField: 'slug',
      searchOptions: { boost: { title: 4, categories: 1.5, ingredients: 1 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
    });
    mini.addAll(recipes.map((x) => ({
      slug: x.slug,
      title: x.title,
      ingredients: x.ingredients.map((i) => i.item + ' ' + (i.prep || '')).join(' '),
      categories: x.categories.join(' '),
      cook: x.cook,
      notes: (x.notes || '') + ' ' + (x.servingIdeas || ''),
    })));
    $footCount.textContent = recipes.length + ' recipes';
  }

  function search(q) {
    q = q.trim();
    if (!q) return [];
    let hits = mini.search(q);
    if (!hits.length && q.split(/\s+/).length > 1) hits = mini.search(q, { combineWith: 'OR' });
    return hits.map((h) => bySlug.get(h.id)).filter(Boolean);
  }

  // ------------------------------------------------------------------
  // Rendering helpers
  // ------------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
  const fmtTime = (m) => (!m ? '' : m >= 60 ? Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');
  const catHref = (c) => '#/c/' + encodeURIComponent(c);
  const cookHref = (c) => '#/cook/' + encodeURIComponent(c);
  const cookShort = (c) => (c === 'Madeline Healey' ? 'Maddy' : c);

  function card(r, opts = {}) {
    const fav = favorites.has(r.slug) ? `<span class="fav" title="Favorite">${icon('i-heart-fill')}</span>` : '';
    const time = r.prepMinutes ? `<span>${fmtTime(r.prepMinutes)}</span>` : '';
    const cats = r.categories.slice(0, 3).map((c) => esc(c)).join(', ');
    return `<li><a class="card" href="#/r/${r.slug}">
      <div class="t">${esc(r.title)}</div>
      <div class="m">${fav}<span class="cook">${esc(cookShort(r.cook))}</span>${time}<span>${cats}</span></div>
    </a></li>`;
  }
  const cardList = (list, two = true) => (list.length ? `<ul class="cards${two ? ' two' : ''}">${list.map((r) => card(r)).join('')}</ul>` : '');

  function setNav(active) {
    document.querySelectorAll('.topnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
  }
  function setTitle(t) { document.title = t ? t + ' · Grandmama\'s Recipes' : 'Grandmama\'s Recipes'; }

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------
  function viewHome(params) {
    setNav('');
    setTitle('');
    const q = params.get('q') || '';
    const favList = [...favorites].map((s) => bySlug.get(s)).filter(Boolean);
    const recentList = recent.map((s) => bySlug.get(s)).filter(Boolean).slice(0, 6);
    const topCats = categories.slice(0, 14);
    const moreCats = categories.slice(14);
    $main.innerHTML = `
      <div class="hero">
        <h1>What are we cooking?</h1>
        <p>${recipes.length} recipes from Grandmama's kitchen, ready for the counter.</p>
        <form class="search${q ? ' has-value' : ''}" role="search" id="searchform">
          ${icon('i-search')}
          <input type="search" id="q" placeholder="Search recipes, ingredients, categories…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${esc(q)}" aria-label="Search recipes">
          <button type="button" class="clear" aria-label="Clear search">${icon('i-x')}</button>
        </form>
      </div>
      <div id="results"></div>
      <div id="browse">
        ${favList.length ? `<section class="section"><div class="section-head"><h2>Favorites</h2><a href="#/favorites">All ${favList.length}</a></div>${cardList(favList.slice(0, 4))}</section>` : ''}
        ${recentList.length ? `<section class="section"><div class="section-head"><h2>Recently viewed</h2></div>${cardList(recentList)}</section>` : ''}
        <section class="section">
          <div class="section-head"><h2>Browse by category</h2></div>
          <div class="chips" id="catchips">
            ${topCats.map((c) => `<a class="chip" href="${catHref(c.name)}">${esc(c.name)} <span class="n">${c.count}</span></a>`).join('')}
            ${moreCats.map((c) => `<a class="chip chips-more" href="${catHref(c.name)}">${esc(c.name)} <span class="n">${c.count}</span></a>`).join('')}
            ${moreCats.length ? `<button type="button" class="chip" id="morecats">${moreCats.length} more…</button>` : ''}
          </div>
        </section>
        <section class="section">
          <div class="section-head"><h2>By cook</h2></div>
          <div class="chips">${cooks.map((c) => `<a class="chip" href="${cookHref(c.name)}">${esc(c.name)} <span class="n">${c.count}</span></a>`).join('')}</div>
        </section>
        <section class="section">
          <div class="section-head"><h2>Everything</h2></div>
          <div class="chips"><a class="chip" href="#/all">All recipes A–Z</a><a class="chip" href="#/tips">Maddy's kitchen tips</a></div>
        </section>
      </div>`;

    const $form = document.getElementById('searchform');
    const $q = document.getElementById('q');
    const $results = document.getElementById('results');
    const $browse = document.getElementById('browse');
    const more = document.getElementById('morecats');
    if (more) more.addEventListener('click', () => { document.getElementById('catchips').classList.add('expanded'); more.remove(); });

    function renderResults() {
      const val = $q.value;
      $form.classList.toggle('has-value', !!val);
      const url = val ? '#/?q=' + encodeURIComponent(val) : '#/';
      if (location.hash !== url) history.replaceState(null, '', url);
      if (!val.trim()) { $results.innerHTML = ''; $browse.hidden = false; return; }
      $browse.hidden = true;
      const hits = search(val);
      $results.innerHTML = hits.length
        ? `<section class="section"><div class="section-head"><h2>Results</h2><span class="count">${hits.length} recipe${hits.length === 1 ? '' : 's'}</span></div>${cardList(hits)}</section>`
        : `<section class="section"><div class="empty">No recipes match <strong>${esc(val)}</strong>.<br><span class="small">Try fewer words, or an ingredient like “brie” or “zucchini”.</span></div></section>`;
    }
    $q.addEventListener('input', renderResults);
    $form.addEventListener('submit', (e) => { e.preventDefault(); $q.blur(); });
    $form.querySelector('.clear').addEventListener('click', () => { $q.value = ''; renderResults(); $q.focus(); });
    if (q) renderResults(); else if (!('ontouchstart' in window)) $q.focus();
  }

  function viewList({ title, list, nav, subtitle, cookFilter = true, groupAZ = false }) {
    setNav(nav || '');
    setTitle(title);
    let cook = 'all';
    function render() {
      const filtered = cook === 'all' ? list : list.filter((r) => r.cook === cook);
      const cooksHere = [...new Set(list.map((r) => r.cook))];
      const seg = cookFilter && cooksHere.length > 1 ? `<div class="filterbar"><div class="seg" role="group" aria-label="Filter by cook">
          <button type="button" data-cook="all" aria-pressed="${cook === 'all'}">All</button>
          ${cooksHere.map((c) => `<button type="button" data-cook="${esc(c)}" aria-pressed="${cook === c}">${esc(cookShort(c))}</button>`).join('')}
        </div><span class="muted small">${filtered.length} recipe${filtered.length === 1 ? '' : 's'}</span></div>` : `<p class="muted small">${filtered.length} recipe${filtered.length === 1 ? '' : 's'}</p>`;
      let body;
      if (!filtered.length) body = `<div class="empty">Nothing here yet.</div>`;
      else if (groupAZ) {
        const groups = new Map();
        for (const r of filtered) { const L = r.title.replace(/^(maddy's|the|a)\s+/i, '')[0].toUpperCase(); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(r); }
        const letters = [...groups.keys()].sort();
        body = `<div class="az">${letters.map((L) => `<a href="#L-${L}">${L}</a>`).join('')}</div>` + letters.map((L) => `
          <div class="letter" id="L-${L}">${L}</div>
          <ul class="row-list">${groups.get(L).sort((a, b) => a.title.localeCompare(b.title)).map((r) => `<li><a href="#/r/${r.slug}"><span>${esc(r.title)}</span><span class="sub">${esc(cookShort(r.cook))}</span></a></li>`).join('')}</ul>`).join('');
      } else body = cardList(filtered);
      $main.innerHTML = `<a class="crumb" href="#/">${icon('i-back')} Home</a>
        <h1>${esc(title)}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}${seg}${body}`;
      $main.querySelectorAll('[data-cook]').forEach((b) => b.addEventListener('click', () => { cook = b.dataset.cook; render(); }));
      // in-page letter links must not trigger the router
      $main.querySelectorAll('.az a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const el = document.getElementById(a.getAttribute('href').slice(1)); if (el) el.scrollIntoView({ block: 'start' }); }));
    }
    render();
  }

  function viewRecipe(slug, params) {
    const r = bySlug.get(slug);
    if (!r) { $main.innerHTML = `<a class="crumb" href="#/">${icon('i-back')} Home</a><div class="empty">That recipe isn't in the box. <a href="#/all">See all recipes</a>.</div>`; return; }
    setNav('');
    setTitle(r.title);
    recent = [r.slug, ...recent.filter((s) => s !== r.slug)].slice(0, 12);
    store.set('recent', recent);

    const base = r.servings || 1;
    let target = parseFloat(params.get('s')) || base;
    const done = new Set(checks[r.slug] || []);
    let stepState = { current: -1, done: new Set() };
    let wakeLock = null;

    function scaledIngredients() {
      const factor = frac(Math.round(target * 100), base * 100);
      return r.ingredients.map((ing, idx) => {
        if (!ing.qty) return { ...ing, idx, display: null };
        let q = mul(ing.qty, factor);
        let unit = ing.unit;
        let rounded = false;
        if (target !== base) {
          const kr = kitchenRound(q, !!ing.count);
          rounded = Math.abs(toNum(kr) - toNum(q)) > 1e-6 && !!ing.count;
          q = kr;
          if (prefs.tidyUnits) [q, unit] = tidy(q, unit);
        }
        return { ...ing, idx, display: fmtFrac(q), unitOut: unitLabel(unit, q), rounded };
      });
    }

    function ingredientsHTML() {
      let html = '';
      let sec = null;
      for (const ing of scaledIngredients()) {
        if (ing.section && ing.section !== sec) { sec = ing.section; html += `<li class="sec">${esc(sec)}</li>`; }
        const isDone = done.has(ing.idx);
        const qty = ing.display ? `<span class="q">${ing.display}${ing.unitOut ? ' ' + esc(ing.unitOut) : ''}</span> ` : (ing.unit ? `<span class="q">${esc(ing.unit)}</span> ` : '');
        const item = ing.ref ? `<a class="ref" href="#/r/${ing.ref}">${esc(ing.item)}</a>` : esc(ing.item);
        const prep = ing.prep ? `<span class="p">, ${esc(ing.prep)}</span>` : '';
        const rounded = ing.rounded ? `<span class="rounded" title="Rounded to a whole or half">rounded</span>` : '';
        html += `<li class="ing${isDone ? ' done' : ''}" data-idx="${ing.idx}" role="checkbox" aria-checked="${isDone}" tabindex="0">
          <span class="box">${icon('i-check')}</span><span class="txt">${qty}${item}${prep}${rounded}</span></li>`;
      }
      return html;
    }

    function stepsHTML() {
      let n = 0;
      return r.steps.map((s) => s.heading
        ? `<li class="h">${esc(s.heading)}</li>`
        : `<li class="s${stepState.done.has(n) ? ' done' : ''}${stepState.current === n ? ' current' : ''}" data-step="${n++}" tabindex="0"><span class="txt">${esc(s.text)}</span></li>`).join('');
    }

    function scaleNote() {
      if (target === base) return '';
      const warn = r.steps.some((s) => /\b(pan|dish|skillet|pot|minutes|hours|degrees|°|inch|")\b/i.test(s.text || ''));
      return `<p class="scale-note${warn ? ' warn' : ''}">Scaled from ${base} to ${fmtNum(target)} ${r.yield ? '' : 'servings'}. ${warn ? 'Pan sizes, oven temperatures and cooking times are not scaled — adjust to taste.' : ''}</p>`;
    }
    const fmtNum = (x) => (Number.isInteger(x) ? x : x.toFixed(1).replace(/\.0$/, ''));

    function render() {
      const fav = favorites.has(r.slug);
      const q = new URLSearchParams();
      if (target !== base) q.set('s', fmtNum(target));
      const url = '#/r/' + r.slug + (q.toString() ? '?' + q : '');
      if (location.hash !== url) history.replaceState(null, '', url);

      $main.innerHTML = `
        <a class="crumb" href="#/" id="back">${icon('i-back')} Back</a>
        <header class="recipe-head">
          <h1>${esc(r.title)}</h1>
          <div class="meta">
            <span>by <a href="${cookHref(r.cook)}">${esc(r.cook)}</a>${r.attribution ? ` <span class="muted">(${esc(r.attribution)})</span>` : ''}</span>
            ${r.servings ? `<span class="dot">${r.servings} servings</span>` : ''}
            ${r.yield ? `<span class="dot">Makes ${esc(r.yield)}</span>` : ''}
            ${r.prepMinutes ? `<span class="dot">${fmtTime(r.prepMinutes)}</span>` : ''}
            <div class="cats">${r.categories.map((c) => `<a class="chip sm" href="${catHref(c)}">${esc(c)}</a>`).join('')}</div>
          </div>
          <div class="toolbar">
            <button type="button" class="tbtn" id="favbtn" aria-pressed="${fav}">${icon(fav ? 'i-heart-fill' : 'i-heart')} ${fav ? 'Saved' : 'Save'}</button>
            <button type="button" class="tbtn" id="wakebtn" aria-pressed="false" ${'wakeLock' in navigator ? '' : 'hidden'}>${icon('i-sun')} Keep screen on</button>
            <button type="button" class="tbtn" id="sharebtn">${icon('i-share')} Share</button>
            <button type="button" class="tbtn" id="printbtn">${icon('i-print')} Print</button>
          </div>
        </header>

        <section class="scaler" aria-label="Adjust servings">
          <div class="label">Servings<small>original: ${base}${r.yield ? ' (' + esc(r.yield) + ')' : ''}</small></div>
          <div class="stepper">
            <button type="button" id="dec" aria-label="Fewer servings" ${target <= 1 ? 'disabled' : ''}>−</button>
            <input type="number" id="serv" inputmode="decimal" min="1" step="1" value="${fmtNum(target)}" aria-label="Servings">
            <button type="button" id="inc" aria-label="More servings">+</button>
          </div>
          <div class="quick">
            <button type="button" data-mult="0.5" aria-pressed="${target === base / 2}">½×</button>
            <button type="button" data-mult="1" aria-pressed="${target === base}">1×</button>
            <button type="button" data-mult="2" aria-pressed="${target === base * 2}">2×</button>
            <button type="button" data-mult="3" aria-pressed="${target === base * 3}">3×</button>
          </div>
          <label class="toggle"><input type="checkbox" id="tidy" ${prefs.tidyUnits ? 'checked' : ''}> Tidy units (12 tsp → ¼ cup)</label>
          ${scaleNote()}
        </section>

        <div class="cols">
          <div class="ing-wrap">
            <h2>Ingredients</h2>
            <ul class="ing-list" id="ings">${ingredientsHTML()}</ul>
            <div class="ing-actions"><span class="muted small">Tap to check off</span><button type="button" class="linkbtn" id="clearchecks" ${done.size ? '' : 'hidden'}>Clear checks</button></div>
          </div>
          <div>
            <h2>Directions</h2>
            <ol class="steps" id="steps">${stepsHTML()}</ol>
            ${r.servingIdeas ? `<div class="note-box"><h3>Serving ideas</h3><p>${esc(r.servingIdeas)}</p></div>` : ''}
            ${r.notes ? `<div class="note-box"><h3>Notes</h3><p>${esc(r.notes)}</p></div>` : ''}
            <div class="note-box mynotes">
              <h3>My notes</h3>
              <textarea id="mynote" placeholder="Tweaks, substitutions, who loved it…">${esc(notes[r.slug] || '')}</textarea>
              <div class="hint">Saved on this device only.</div>
            </div>
            <p class="source">From <a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source.replace(/^originals\//, ''))}</a> in Grandmama's original files.</p>
          </div>
        </div>`;

      // --- wire up ---
      document.getElementById('back').addEventListener('click', (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
      const $serv = document.getElementById('serv');
      const setTarget = (v) => { v = Math.max(0.5, Math.round(v * 2) / 2); if (v !== target) { target = v; render(); } };
      document.getElementById('dec').addEventListener('click', () => setTarget(target - 1));
      document.getElementById('inc').addEventListener('click', () => setTarget(target + 1));
      $serv.addEventListener('change', () => setTarget(parseFloat($serv.value) || base));
      $serv.addEventListener('keydown', (e) => { if (e.key === 'Enter') $serv.blur(); });
      $main.querySelectorAll('[data-mult]').forEach((b) => b.addEventListener('click', () => setTarget(base * parseFloat(b.dataset.mult))));
      document.getElementById('tidy').addEventListener('change', (e) => { prefs.tidyUnits = e.target.checked; store.set('prefs', prefs); render(); });

      const $ings = document.getElementById('ings');
      const toggleIng = (li) => {
        const idx = +li.dataset.idx;
        if (done.has(idx)) done.delete(idx); else done.add(idx);
        li.classList.toggle('done', done.has(idx));
        li.setAttribute('aria-checked', done.has(idx));
        checks[r.slug] = [...done];
        store.set('checks', checks);
        document.getElementById('clearchecks').hidden = !done.size;
      };
      $ings.addEventListener('click', (e) => { if (e.target.closest('a')) return; const li = e.target.closest('.ing'); if (li) toggleIng(li); });
      $ings.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { const li = e.target.closest('.ing'); if (li) { e.preventDefault(); toggleIng(li); } } });
      document.getElementById('clearchecks').addEventListener('click', () => { done.clear(); delete checks[r.slug]; store.set('checks', checks); render(); });

      const $steps = document.getElementById('steps');
      const tapStep = (li) => {
        const n = +li.dataset.step;
        if (stepState.current === n) { stepState.done.add(n); stepState.current = -1; }
        else { if (stepState.done.has(n)) stepState.done.delete(n); stepState.current = n; for (let i = 0; i < n; i++) stepState.done.add(i); }
        $steps.querySelectorAll('li.s').forEach((el) => { const k = +el.dataset.step; el.classList.toggle('current', k === stepState.current); el.classList.toggle('done', stepState.done.has(k)); });
      };
      $steps.addEventListener('click', (e) => { const li = e.target.closest('li.s'); if (li) tapStep(li); });
      $steps.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { const li = e.target.closest('li.s'); if (li) { e.preventDefault(); tapStep(li); } } });

      document.getElementById('favbtn').addEventListener('click', () => {
        if (favorites.has(r.slug)) { favorites.delete(r.slug); toast('Removed from favorites'); } else { favorites.add(r.slug); toast('Saved to favorites'); }
        saveFavorites(); render();
      });
      document.getElementById('printbtn').addEventListener('click', () => window.print());
      document.getElementById('sharebtn').addEventListener('click', async () => {
        const shareUrl = location.href;
        if (navigator.share) { try { await navigator.share({ title: r.title, url: shareUrl }); return; } catch (e) { /* cancelled */ } }
        try { await navigator.clipboard.writeText(shareUrl); toast('Link copied'); } catch (e) { toast(shareUrl); }
      });
      const $wake = document.getElementById('wakebtn');
      $wake.addEventListener('click', async () => {
        if (wakeLock) { await wakeLock.release(); wakeLock = null; $wake.setAttribute('aria-pressed', 'false'); return; }
        try { wakeLock = await navigator.wakeLock.request('screen'); $wake.setAttribute('aria-pressed', 'true'); toast('Screen will stay on');
          wakeLock.addEventListener('release', () => { wakeLock = null; $wake.setAttribute('aria-pressed', 'false'); }); } catch (e) { toast('Couldn\'t keep the screen on'); }
      });
      const $note = document.getElementById('mynote');
      let noteTimer;
      $note.addEventListener('input', () => { clearTimeout(noteTimer); noteTimer = setTimeout(() => { const v = $note.value.trim(); if (v) notes[r.slug] = v; else delete notes[r.slug]; store.set('notes', notes); }, 300); });
    }
    render();
    window.scrollTo(0, 0);
  }

  function viewTips() {
    setNav('tips');
    setTitle("Maddy's kitchen tips");
    $main.innerHTML = `<a class="crumb" href="#/">${icon('i-back')} Home</a><h1>Maddy's kitchen tips</h1>
      <p class="muted">Little tricks from Maddy's notes.</p>
      <ol class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
  }

  function viewAbout() {
    setNav('');
    setTitle('About');
    $main.innerHTML = `<a class="crumb" href="#/">${icon('i-back')} Home</a><h1>About this recipe box</h1>
      <div class="prose">
        <p>${recipes.length} recipes typed up over the years by ${cooks.map((c) => esc(c.name)).slice(0, 2).join(' and ')}, converted from the original text files into this little app so they're easy to find and cook from on a phone.</p>
        <h2>Tips</h2>
        <p>Search matches titles, ingredients and categories, so “brie” or “zucchini” work as well as a recipe name. Change the servings on any recipe and the ingredient amounts scale with it; pan sizes and cooking times don't, so keep an eye on those. Tap ingredients to check them off as you go, and tap a direction step to mark your place.</p>
        <p>Favorites, checks and “My notes” are stored on this device only. Add the page to your home screen and it works without a connection.</p>
        <p class="muted small">Version ${APP_VERSION}</p>
      </div>`;
  }

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  function route() {
    const hash = location.hash || '#/';
    const [path, qs] = hash.slice(1).split('?');
    const params = new URLSearchParams(qs || '');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length) return viewHome(params);
    switch (parts[0]) {
      case 'r': return viewRecipe(parts[1], params);
      case 'c': {
        const c = parts[1];
        const list = recipes.filter((x) => x.categories.includes(c));
        return viewList({ title: c, list });
      }
      case 'cook': {
        const c = parts[1];
        return viewList({ title: c, list: recipes.filter((x) => x.cook === c), cookFilter: false, subtitle: 'Recipes by ' + esc(c) });
      }
      case 'all': return viewList({ title: 'All recipes', list: recipes, nav: 'all', groupAZ: true });
      case 'favorites': {
        const list = [...favorites].map((s) => bySlug.get(s)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
        return viewList({ title: 'Favorites', list, nav: 'favorites', subtitle: list.length ? '' : 'Tap <em>Save</em> on any recipe to keep it here.', cookFilter: false });
      }
      case 'tips': return viewTips();
      case 'about': return viewAbout();
      default: return viewHome(params);
    }
  }

  window.addEventListener('hashchange', () => { route(); if (!location.hash.startsWith('#/r/')) window.scrollTo(0, 0); });

  loadData().then(route).catch((err) => {
    $main.innerHTML = `<div class="empty">Couldn't load the recipes.<br><span class="small">${esc(err.message)}</span></div>`;
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
