// Account-scoped external collection. Credentials and Brickset writes never reach the browser.
(() => {
  const OWNER = 'rh8WrITlLTXrsDj5mbJHzA1D4Bk2';
  const CACHE_KEY = `collector-brickset-cache-v1-${OWNER}`;
  const PRICE_KEY = `collector-brickset-prices-v1-${OWNER}`;
  let prices = {};
  try { prices = JSON.parse(localStorage.getItem(PRICE_KEY) || '{}') || {}; } catch {}
  let priceRevision = 0, priceController = null;
  let snapshot = null, requestRevision = 0;
  const PAGE_SIZE = 96;
  let page = 0, resultKey = '', snapshotKey = '';
  let figuresByCode = new Map();
  const visiblePrices = new Map();
  const pagers = [document.createElement('nav'), document.createElement('nav')];
  for (const pager of pagers) {
    pager.className = 'brickset-pagination'; pager.hidden = true;
    pager.setAttribute('aria-label', 'Brickset collection pages');
    pager.innerHTML = '<button type="button" data-page="previous">Previous</button><span aria-live="polite"></span><button type="button" data-page="next">Next</button>';
    for (const direction of ['previous', 'next']) pager.querySelector(`[data-page="${direction}"]`).onclick = () => {
      page += direction === 'next' ? 1 : -1;
      render();
      if (pager === pagers[1]) pagers[0].scrollIntoView({ block: 'center' });
    };
  }
  pagers[1].classList.add('brickset-pagination-bottom');
  $('#catalogue').before(pagers[0]); $('#catalogue').after(pagers[1]);
  const bar = document.createElement('div');
  bar.className = 'brickset-sync-bar';
  bar.hidden = true;
  bar.innerHTML = '<span role="status" aria-live="polite"></span><button type="button"><span class="material-symbols-rounded" aria-hidden="true">sync</span>Refresh</button>';
  $('#resultCount').after(bar);
  const status = bar.querySelector('[role="status"]'), refresh = bar.querySelector('button');
  const totalCard = $('#totalCount').closest('article');
  totalCard.classList.add('brickset-total-card');
  refresh.className = 'brickset-refresh';
  refresh.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">sync</span>';
  refresh.setAttribute('aria-label', 'Refresh Brickset');
  refresh.title = 'Refresh Brickset';
  totalCard.append(refresh);
  function alignRefreshWithHeading() {
    if (!window.matchMedia('(min-width:601px)').matches) { refresh.style.removeProperty('top'); return; }
    const heading = totalCard.querySelector('span');
    if (heading) refresh.style.top = `${heading.offsetTop + (heading.offsetHeight - refresh.offsetHeight) / 2}px`;
  }
  window.addEventListener('resize', alignRefreshWithHeading);
  const ownedControl = $('#ownedStat').closest('button');
  function syncOwnedControl() {
    const active = isBricksetCollection();
    ownedControl.disabled = active;
    ownedControl.title = active ? 'Ownership managed in Brickset' : 'Filter by owned';
    ownedControl.setAttribute('aria-label', active ? 'Ownership managed in Brickset' : 'Filter catalogue by owned minifigs');
    ownedControl.closest('article').title = active ? 'Ownership managed in Brickset' : '';
    const filter = document.querySelector('.state-filter[value="owned"]');
    if (filter) {
      filter.disabled = active;
      filter.closest('label').hidden = active;
      if (active) filter.checked = false;
    }
  }
  let priceNotice = '';
  function setPriceStatus(message) { priceNotice = message; updatePriceTooltip(); }
  function updatePriceTooltip() {
    if (!isBricksetCollection()) return;
    const label = $('#ownedValue'), tooltip = [priceNotice || priceSummary(), snapshot ? `Synced ${lastSync(snapshot)}` : ''].filter(Boolean).join('\n');
    label.title = tooltip;
    const button = label.closest('button');
    if (button) button.title = tooltip;
  }
  refresh.onclick = () => loadBricksetCollection(true);

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return cached?.source === 'brickset' && Array.isArray(cached.figures) ? cached : null;
    } catch { return null; }
  }
  function showSnapshot(data) {
    snapshot = data;
    refresh.title = `Refresh Brickset\nSynced ${lastSync(data)}`;
    const key = JSON.stringify(data.figures);
    // A fresh timestamp alone does not require rebuilding the catalogue.
    if (key === snapshotKey && figures.length === data.figures.length && (!figures.length || figures[0].source === 'brickset')) return;
    snapshotKey = key;
    figures = data.figures.map(row => ({
      id: `Brickset::${row.code}`, source: 'brickset', name: row.name, character: row.code,
      brand: 'LEGO', origin: 'Brickset', value: validPrice(prices[row.code]) ? unitPrice(prices[row.code]) : 0, currencyCode: 'EUR', currency: '€',
      priceAvailable: validPrice(prices[row.code]),
      priceCondition: prices[row.code]?.priceCondition || 'new',
      condition: '', collection: 'owned', hidden: false, tags: row.tags || [], image: row.photoUrl,
      altImage: '', notes: '', ownedQuantity: row.ownedTotal, ownedInSets: row.ownedInSets,
      ownedLoose: row.ownedLoose, raw: { '#': row.code, Name: row.name, Character: row.code, Owned: 'Owned' }
    }));
    figuresByCode = new Map(figures.map(figure => [figure.character, figure]));
    renderFilters(); render(); loadExchangeRates();
    window.collectorSplash?.ready();
  }
  function unitPrice(price) { return price?.averagePrice ?? price?.averageNewPrice; }
  function validPrice(price) { const value=unitPrice(price);return price?.currency === 'EUR' && typeof value === 'number' && Number.isFinite(value) && value >= 0; }
  function freshPrice(price) { const age = Date.now() - Date.parse(price?.retrievedAt); return age >= 0 && age < 86400000 && (validPrice(price) || price?.priceStatus==='not_found' || price?.priceStatus==='no_sales'&&price.fallbackChecked===true); }
  function priceSummary() {
    const priced = figures.filter(figure => figure.priceAvailable).length;
    return `${formatFigureCount(priced)} / ${formatFigureCount(figures.length)} figures valued · BL average price, last 6 months (new, used fallback) · Total includes all owned copies`;
  }
  function stopPriceRefresh() { ++priceRevision; priceController?.abort(); priceController = null; }
  function applyPrices(updatedCodes) {
    for (const code of updatedCodes) {
      const figure = figuresByCode.get(code);
      if (!figure) continue;
      const price = prices[figure.character]; figure.priceAvailable = validPrice(price);
      figure.value = figure.priceAvailable ? unitPrice(price) : 0;
      figure.priceCondition = price?.priceCondition || 'new';
      const card = visiblePrices.get(code);
      if (card) { card.textContent = money(figure.value, figure.currency);card.title = `Average ${figure.priceCondition}-condition sales price, last six months`; }
    }
    const currentCode = $('#detail .detail-character')?.textContent?.trim();
    const current = figures.find(figure => figure.character === currentCode);
    const detailValue = $('#detailInfo p:last-child span');
    if (current && detailValue) detailValue.textContent = money(current.value, current.currency)+(current.priceAvailable&&current.priceCondition==='used'?' (used)':'');
    updateStats();
  }
  async function refreshPrices() {
    stopPriceRefresh();
    const revision = priceRevision;
    const pending = [...new Set([...filtered(), ...figures].map(figure => figure.character))].filter(code => !freshPrice(prices[code]));
    setPriceStatus(pending.length ? `Updating prices… ${priceSummary()}` : priceSummary());
    if (!pending.length) return;
    priceController = new AbortController();
    const signal = priceController.signal;
    try {
      for (let offset = 0; offset < pending.length; offset += 8) {
        if (revision !== priceRevision || !isBricksetCollection() || window.collectorFirebaseUser !== OWNER) return;
        const token = await window.collectorGetIdToken();
        const response = await fetch('https://cmcollector-reminders.mreizinho.workers.dev/brickset/prices', {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ codes: pending.slice(offset, offset + 8) }), signal
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.prices)) throw Error(data.error || 'BrickLink price refresh failed.');
        if (revision !== priceRevision || !isBricksetCollection() || window.collectorFirebaseUser !== OWNER) return;
        for (const price of data.prices) if (pending.includes(price.code) && price.currency === 'EUR') prices[price.code] = price;
        try { localStorage.setItem(PRICE_KEY, JSON.stringify(prices)); } catch {}
        applyPrices(data.prices.map(price => price.code));
        setPriceStatus(`Updating prices… ${priceSummary()}`);
        if (data.rateLimited || !data.prices.length) throw Error(data.errors?.[0]?.error || 'BrickLink price refresh paused.');
        // One small batch at a time; no per-card fetches or image downloads.
        if (offset + 8 < pending.length) await new Promise(resolve => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      if (revision === priceRevision) setPriceStatus(priceSummary() + (pending.some(code => !freshPrice(prices[code])) ? ' · Some prices unavailable; choose Refresh to retry' : ' · Prices updated'));
    } catch (error) {
      if (revision === priceRevision && isBricksetCollection()) setPriceStatus(`${priceSummary()} · ${error.message} Choose Refresh to retry.`);
    }
  }
  function lastSync(data) {
    const date = new Date(data.fetchedAt);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unknown';
  }
  async function loadBricksetCollection(force = false) {
    if (!isBricksetCollection()) return;
    const revision = ++requestRevision;
    stopPriceRefresh();
    // Invalidate any pending Google Sheet load before changing the displayed figures.
    ++authenticatedLoadRevision;
    bar.hidden = false; refresh.disabled = true;
    const cached = snapshot || readCache();
    if (cached) showSnapshot(cached);
    status.textContent = cached ? 'Checking Brickset…' : 'Loading owned minifigures from Brickset…';
    try {
      if (window.collectorFirebaseUser !== OWNER || !window.collectorGetIdToken) throw Error('Sign in with your Google account to refresh Brickset.');
      const token = await window.collectorGetIdToken();
      const response = await fetch('https://cmcollector-reminders.mreizinho.workers.dev/brickset', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: force }), signal: AbortSignal.timeout(70000)
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Brickset could not be refreshed.');
      if (data.source !== 'brickset' || !Array.isArray(data.figures)) throw Error('Brickset returned an invalid collection.');
      if (revision !== requestRevision || !isBricksetCollection() || window.collectorFirebaseUser !== OWNER) return;
      // Keep previously read notes if the optional notes request temporarily failed.
      if (!data.notesAvailable && cached) {
        const old = new Map(cached.figures.map(row => [row.code, row]));
        for (const row of data.figures) {
          row.notes = old.get(row.code)?.notes || '';
          row.tags = [...new Set([row.theme, ...row.notes.split(/[,;|\r\n]+/).map(tag => tag.trim())].filter(Boolean))];
        }
      }
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* Viewing still works if device storage is full. */ }
      showSnapshot(data);
      status.textContent = data.notesAvailable ? '' : 'Notes could not be refreshed';
      void refreshPrices();
    } catch (error) {
      if (revision !== requestRevision || !isBricksetCollection()) return;
      status.textContent = cached ? `Showing saved collection. ${error.message}` : error.message;
      if (!cached) {
        figures = []; $('#catalogue').replaceChildren(); updateStats();
        $('#resultCount').textContent = 'Brickset collection unavailable';
        $('#empty').hidden = false; $('#empty h2').textContent = 'Could not load Brickset';
        $('#empty p').textContent = error.message; $('#resetEmpty').hidden = true;
      }
    } finally { if (revision === requestRevision) { refresh.disabled = false; window.collectorSplash?.ready(); } }
  }
  window.collectorLoadBrickset = loadBricksetCollection;

  const previousStats = updateStats;
  updateStats = () => {
    previousStats();
    syncOwnedControl();
    const label = $('#ownedValue');
    if (!isBricksetCollection()) {
      label.removeAttribute('title'); updateOwnedValueCycleLabel(); return;
    }
    if (figures.some(figure => !figure.priceAvailable)) label.textContent = label.textContent.replace(' estimated', ' partial estimate');
    updatePriceTooltip();
  };

  const previousRender = render;
  render = () => {
    const active = isBricksetCollection();
    let matches = [], visible = [];
    visiblePrices.clear();
    if (active) {
      matches = filtered();
      const key = matches.map(figure => figure.id).join('\n');
      if (key !== resultKey) { resultKey = key; page = 0; }
      page = Math.max(0, Math.min(page, Math.ceil(matches.length / PAGE_SIZE) - 1));
      visible = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      // Existing card decorators use filtered() to map cards to figures. Keep
      // them on the same page while retaining the full data for stats/details.
      const fullFiltered = filtered;
      filtered = () => visible;
      try { previousRender(); } finally { filtered = fullFiltered; }
      $('#resultCount').textContent = `BRICKSET: Showing ${formatFigureCount(matches.length)} of ${formatFigureCount(figures.length)} minifigs`;
    } else previousRender();
    document.body.classList.toggle('brickset-collection-active', active); bar.hidden = !active;
    for (const pager of pagers) {
      pager.hidden = !active || matches.length <= PAGE_SIZE;
      if (!active) continue;
      pager.querySelector('[data-page="previous"]').disabled = page === 0;
      pager.querySelector('[data-page="next"]').disabled = (page + 1) * PAGE_SIZE >= matches.length;
      pager.querySelector('span').textContent = matches.length ? `${formatFigureCount(page * PAGE_SIZE + 1)}–${formatFigureCount(Math.min((page + 1) * PAGE_SIZE, matches.length))} of ${formatFigureCount(matches.length)}` : '';
    }
    if (!active) return;
    alignRefreshWithHeading();
    document.querySelectorAll('#catalogue .card').forEach((card,index) => {
      const figure=visible[index];if(!figure)return;
      card.dataset.bricksetCode=figure.character;
      const price=card.querySelector('.price');
      if (price) visiblePrices.set(figure.character, price);
      if(price&&figure.priceAvailable)price.title=`Average ${figure.priceCondition}-condition sales price, last six months`;
    });
    document.querySelectorAll('#catalogue .own, #catalogue .wish').forEach(button => {
      button.disabled = true; button.title = 'Ownership managed in Brickset';
      button.setAttribute('aria-label', button.classList.contains('own') ? 'Owned in Brickset' : 'Wishlist managed in Brickset');
    });
    if (!figures.length && snapshot) {
      $('#empty h2').textContent = 'No owned minifigures in Brickset';
      $('#empty p').textContent = 'Add figures to your Brickset collection, then choose Refresh.';
      $('#resetEmpty').hidden = true;
    }
  };
  const previousDetail = openDetail;
  openDetail = figure => {
    previousDetail(figure);
    if (figure.source !== 'brickset') return;
    $('#detail').querySelectorAll('.detail-edit-button,#detailAddPhoto,#detailWish,.detail-photo-navigation').forEach(control => control.remove());
    const own = $('#detailOwn'); if (own) { own.disabled = true; own.title = 'Ownership managed in Brickset'; }
    const quantity = document.createElement('p'); quantity.className = 'detail-meta';
    quantity.textContent = `Owned: ${formatFigureCount(figure.ownedQuantity)} · In sets: ${formatFigureCount(figure.ownedInSets)} · Loose: ${formatFigureCount(figure.ownedLoose)}`;
    $('#detail .detail-character').after(quantity);
    const value = $('#detailInfo p:last-child span');
    if(value&&figure.priceAvailable&&figure.priceCondition==='used')value.textContent=money(figure.value,figure.currency)+' (used)';
  };
  const previousRebuild = rebuildCollectionChoices;
  rebuildCollectionChoices = () => {
    if (!canReadBricksetCollection()) COLLECTIONS = COLLECTIONS.filter(name => name !== 'Brickset');
    if (canReadBricksetCollection() && !COLLECTIONS.includes('Brickset')) COLLECTIONS.push('Brickset');
    previousRebuild();
    if (!canReadBricksetCollection()) return;
    const row = [...collectionMenuElement.querySelectorAll('[data-collection]')].find(item => item.dataset.collection === 'Brickset');
    row?.querySelectorAll('[data-rename-collection],[data-delete-collection],.collection-swipe-feedback').forEach(control => control.remove());
  };
  // Protect every write entry point, including keyboard and mobile controls.
  for (const [name, original] of [['toggleOwned', toggleOwned], ['toggleWished', toggleWished]]) {
    const guarded = figure => figure.source === 'brickset' ? Promise.resolve(false) : original(figure);
    if (name === 'toggleOwned') toggleOwned = guarded; else toggleWished = guarded;
  }
  const previousRename = openRenameCollection, previousDelete = deleteCollection;
  openRenameCollection = (name, options) => { if (isBricksetCollection(name)) return; return previousRename(name, options); };
  deleteCollection = (name, options) => { if (isBricksetCollection(name)) return; return previousDelete(name, options); };
  const previousSelect = selectCollection;
  selectCollection = name => {
    if (name !== activeCollection) { page = 0; resultKey = ''; }
    for (const pager of pagers) pager.hidden = true;
    visiblePrices.clear();
    ++requestRevision;
    stopPriceRefresh();
    document.body.classList.toggle('brickset-collection-active', isBricksetCollection(name));
    bar.hidden = !isBricksetCollection(name); refresh.disabled = false;
    return previousSelect(name);
  };
  window.addEventListener('collector-google-auth', event => {
    if (canReadBricksetCollection()) rebuildCollectionChoices();
    else {
      ++requestRevision; stopPriceRefresh(); snapshot = null; prices = {}; bar.hidden = true;
      figuresByCode.clear(); visiblePrices.clear();
      for (const pager of pagers) pager.hidden = true;
      document.body.classList.remove('brickset-collection-active');
      rebuildCollectionChoices();
      if (activeCollection === 'Brickset') selectCollection(COLLECTIONS[0] || GUEST_COLLECTIONS[0]);
    }
  });
  rebuildCollectionChoices();
  if (isBricksetCollection()) queueMicrotask(() => loadBricksetCollection());
})();
