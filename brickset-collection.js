// Account-scoped external collection. Credentials and Brickset writes never reach the browser.
(() => {
  const OWNER = 'rh8WrITlLTXrsDj5mbJHzA1D4Bk2';
  const CACHE_KEY = `collector-brickset-cache-v1-${OWNER}`;
  let snapshot = null, requestRevision = 0;
  const bar = document.createElement('div');
  bar.className = 'brickset-sync-bar';
  bar.hidden = true;
  bar.innerHTML = '<span role="status" aria-live="polite"></span><button type="button"><span class="material-symbols-rounded" aria-hidden="true">sync</span>Refresh</button>';
  $('#catalogue').before(bar);
  const status = bar.querySelector('[role="status"]'), refresh = bar.querySelector('button');
  refresh.onclick = () => loadBricksetCollection(true);

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return cached?.source === 'brickset' && Array.isArray(cached.figures) ? cached : null;
    } catch { return null; }
  }
  function showSnapshot(data) {
    snapshot = data;
    figures = data.figures.map(row => ({
      id: `Brickset::${row.code}`, source: 'brickset', name: row.name, character: row.code,
      brand: 'LEGO', origin: 'Brickset', value: 0, currencyCode: 'EUR', currency: '€',
      condition: '', collection: 'owned', hidden: false, tags: row.tags || [], image: row.photoUrl,
      altImage: '', notes: '', ownedQuantity: row.ownedTotal, ownedInSets: row.ownedInSets,
      ownedLoose: row.ownedLoose, raw: { '#': row.code, Name: row.name, Character: row.code, Owned: 'Owned' }
    }));
    renderFilters(); render();
  }
  function lastSync(data) {
    const date = new Date(data.fetchedAt);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unknown';
  }
  async function loadBricksetCollection(force = false) {
    if (!isBricksetCollection()) return;
    const revision = ++requestRevision;
    // Invalidate any pending Google Sheet load before changing the displayed figures.
    ++authenticatedLoadRevision;
    bar.hidden = false; refresh.disabled = true;
    const cached = snapshot || readCache();
    if (cached) showSnapshot(cached);
    status.textContent = cached ? `Last synced ${lastSync(cached)} · Checking Brickset…` : 'Loading owned minifigures from Brickset…';
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
      status.textContent = `Synced ${lastSync(data)} · ${data.figures.length.toLocaleString()} minifigures · Ownership managed in Brickset${data.notesAvailable ? '' : ' · Notes could not be refreshed'}`;
    } catch (error) {
      if (revision !== requestRevision || !isBricksetCollection()) return;
      status.textContent = cached ? `Showing saved collection from ${lastSync(cached)}. ${error.message}` : error.message;
      if (!cached) {
        figures = []; $('#catalogue').replaceChildren(); updateStats();
        $('#resultCount').textContent = 'Brickset collection unavailable';
        $('#empty').hidden = false; $('#empty h2').textContent = 'Could not load Brickset';
        $('#empty p').textContent = error.message; $('#resetEmpty').hidden = true;
      }
    } finally { if (revision === requestRevision) refresh.disabled = false; }
  }
  window.collectorLoadBrickset = loadBricksetCollection;

  const previousRender = render;
  render = () => {
    previousRender();
    const active = isBricksetCollection();
    document.body.classList.toggle('brickset-collection-active', active); bar.hidden = !active;
    if (!active) return;
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
    quantity.textContent = `Owned: ${figure.ownedQuantity} · In sets: ${figure.ownedInSets} · Loose: ${figure.ownedLoose}`;
    $('#detail .detail-character').after(quantity);
  };
  const previousRebuild = rebuildCollectionChoices;
  rebuildCollectionChoices = () => {
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
    ++requestRevision;
    document.body.classList.toggle('brickset-collection-active', isBricksetCollection(name));
    bar.hidden = !isBricksetCollection(name); refresh.disabled = false;
    return previousSelect(name);
  };
  window.addEventListener('collector-google-auth', event => {
    if (event.detail?.uid === OWNER) rebuildCollectionChoices();
    else { ++requestRevision; snapshot = null; bar.hidden = true; document.body.classList.remove('brickset-collection-active'); }
  });
  rebuildCollectionChoices();
  if (isBricksetCollection()) queueMicrotask(() => loadBricksetCollection());
})();
