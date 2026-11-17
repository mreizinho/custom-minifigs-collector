import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../brickset-collection.js', import.meta.url), 'utf8');
const owner = 'rh8WrITlLTXrsDj5mbJHzA1D4Bk2';
const snapshot = { source: 'brickset', fetchedAt: '2026-11-17T00:00:00Z', notesAvailable: true, figures: [
  { code: 'sw0971', name: 'Luke', theme: 'Star Wars', tags: ['Star Wars'], ownedTotal: 2, ownedInSets: 1, ownedLoose: 1, photoUrl: 'https://img.bricklink.com/ItemImage/MN/0/sw0971.png' }
] };
function client(fetcher, { cached, uid = owner } = {}) {
  const storage = new Map(), elements = new Map();
  if (cached) storage.set(`collector-brickset-cache-v1-${owner}`, JSON.stringify(cached));
  const element = () => ({ hidden: false, disabled: false, textContent: '', innerHTML: '',
    classList: { toggle() {}, remove() {} }, before() {}, replaceChildren() {}, querySelectorAll: () => [] });
  const status = element(), refresh = element(), bar = element();
  bar.querySelector = selector => selector === 'button' ? refresh : status;
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); };
  const context = { window: { collectorFirebaseUser: uid, collectorGetIdToken: async () => 'firebase-test-token', addEventListener() {} },
    document: { createElement: () => bar, body: element(), querySelectorAll: () => [] }, $, fetch: fetcher,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) },
    activeCollection: 'Brickset', COLLECTIONS: ['Star Wars'], figures: [], authenticatedLoadRevision: 0,
    canReadBricksetCollection: () => uid === owner, renderFilters() {}, render() {}, openDetail() {},
    collectionMenuElement: { querySelectorAll: () => [] }, rebuildCollectionChoices() {},
    toggleOwned() {}, toggleWished() {}, openRenameCollection() {}, deleteCollection() {}, selectCollection() {},
    queueMicrotask() {}, AbortSignal, updateStats() {}
  };
  context.isBricksetCollection = (name = context.activeCollection) => name === 'Brickset' && uid === owner;
  vm.createContext(context); vm.runInContext(code, context);
  return { context, status, refresh, storage };
}
test('renders the external collection with stable IDs, tags, and no sheet row; refresh is authenticated', async () => {
  let request;
  const { context, status } = client(async (url, options) => { request = { url, options }; return Response.json(snapshot); });
  await context.window.collectorLoadBrickset(true);
  assert.equal(context.figures.length, 1);
  assert.equal(context.figures[0].id, 'Brickset::sw0971');
  assert.equal(context.figures[0].sheetRow, undefined);
  assert.equal(context.figures[0].ownedQuantity, 2);
  assert.deepEqual([...context.figures[0].tags], ['Star Wars']);
  assert.equal(request.options.headers.Authorization, 'Bearer firebase-test-token');
  assert.equal(JSON.parse(request.options.body).refresh, true);
  assert.match(status.textContent, /Ownership managed in Brickset/);
});
test('retains the last successful collection during a network outage', async () => {
  const { context, status, refresh } = client(async () => { throw Error('Network unavailable'); }, { cached: snapshot });
  await context.window.collectorLoadBrickset();
  assert.equal(context.figures[0].id, 'Brickset::sw0971');
  assert.match(status.textContent, /Showing saved collection/);
  assert.equal(refresh.disabled, false);
});
test('a late Brickset response cannot overwrite a different selected collection', async () => {
  let complete, began;
  const started = new Promise(resolve => { began = resolve; });
  const { context } = client(() => new Promise(resolve => { complete = resolve; began(); }));
  const pending = context.window.collectorLoadBrickset();
  await started;
  context.activeCollection = 'Star Wars';
  complete(Response.json(snapshot)); await pending;
  assert.equal(context.figures.length, 0);
});
test('another account cannot load or add the owner collection', async () => {
  let fetched = false;
  const { context } = client(async () => { fetched = true; }, { uid: 'someone-else' });
  await context.window.collectorLoadBrickset();
  assert.equal(fetched, false);
  assert.ok(!context.COLLECTIONS.includes('Brickset'));
});
