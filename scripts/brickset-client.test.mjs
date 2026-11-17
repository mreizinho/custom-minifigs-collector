import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../brickset-collection.js', import.meta.url), 'utf8');
const owner = 'rh8WrITlLTXrsDj5mbJHzA1D4Bk2';
const snapshot = { source: 'brickset', fetchedAt: '2026-11-17T00:00:00Z', notesAvailable: true, figures: [
  { code: 'sw0971', name: 'Luke', theme: 'Star Wars', tags: ['Star Wars'], ownedTotal: 2, ownedInSets: 1, ownedLoose: 1, photoUrl: 'https://img.bricklink.com/ItemImage/MN/0/sw0971.png' }
] };
function client(fetcher, { cached, uid = owner, priceFetcher, cachedPrices, collections=['Star Wars'] } = {}) {
  const storage = new Map(), elements = new Map();
  if (cached) storage.set(`collector-brickset-cache-v1-${owner}`, JSON.stringify(cached));
  if (cachedPrices) storage.set(`collector-brickset-prices-v1-${owner}`, JSON.stringify(cachedPrices));
  const element = () => ({ hidden: false, disabled: false, textContent: '', innerHTML: '',
    classList: { toggle() {}, remove() {}, add() {} }, before() {}, after() {}, append() {}, setAttribute() {}, replaceChildren() {}, querySelectorAll: () => [] });
  const totalCard=element();
  const status = element(), refresh = element(), bar = element();
  bar.querySelector = selector => selector === 'button' ? refresh : status;
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, element());const result=elements.get(selector);result.closest=()=>totalCard;return result; };
  const context = { window: { collectorFirebaseUser: uid, collectorGetIdToken: async () => 'firebase-test-token', addEventListener() {} },
    document: { createElement: tag => tag === 'div' ? bar : element(), body: element(), querySelectorAll: () => [], querySelector: () => null }, $,
    fetch: (url, options) => url.endsWith('/prices') ? (priceFetcher ? priceFetcher(url, options) : Promise.resolve(Response.json({prices:[],errors:[{error:'No test prices'}]}))) : fetcher(url, options),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) },
    activeCollection: 'Brickset', COLLECTIONS: [...collections], figures: [], authenticatedLoadRevision: 0,
    canReadBricksetCollection: () => uid === owner, renderFilters() {}, render() {}, openDetail() {},
    collectionMenuElement: { querySelectorAll: () => [] }, rebuildCollectionChoices() {},
    toggleOwned() {}, toggleWished() {}, openRenameCollection() {}, deleteCollection() {}, selectCollection() {},
    queueMicrotask() {}, AbortSignal, AbortController, setTimeout, clearTimeout, updateStats() {}, loadExchangeRates() {}, money: n => String(n),formatFigureCount:n=>Number(n).toLocaleString('de-DE')
  };
  context.isBricksetCollection = (name = context.activeCollection) => name === 'Brickset' && uid === owner;
  context.filtered = () => context.figures;
  vm.createContext(context); vm.runInContext(code, context);
  return { context, status, refresh, storage, elements };
}
test('renders the external collection with stable IDs, tags, and no sheet row; refresh is authenticated', async () => {
  let request;
  const { context, status, refresh, elements } = client(async (url, options) => { request = { url, options }; return Response.json(snapshot); });
  await context.window.collectorLoadBrickset(true);
  assert.equal(context.figures.length, 1);
  assert.equal(context.figures[0].id, 'Brickset::sw0971');
  assert.equal(context.figures[0].sheetRow, undefined);
  assert.equal(context.figures[0].ownedQuantity, 2);
  assert.deepEqual([...context.figures[0].tags], ['Star Wars']);
  assert.equal(request.options.headers.Authorization, 'Bearer firebase-test-token');
  assert.equal(JSON.parse(request.options.body).refresh, true);
  assert.match(status.textContent, /Ownership managed in Brickset/);
  assert.ok(!status.textContent.includes('Synced'));
  assert.match(refresh.title,/Refresh Brickset\nSynced /);
  assert.match(elements.get('#ownedValue').title,/\nSynced /);
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
  const { context } = client(async () => { fetched = true; }, { uid: 'someone-else',collections:['Star Wars','Brickset'] });
  await context.window.collectorLoadBrickset();
  assert.equal(fetched, false);
  assert.ok(!context.COLLECTIONS.includes('Brickset'));
});

test('uses cached unit prices immediately and retains them when the collection is refreshed', async () => {
  let called = false;
  const cachedPrices = { sw0971: { code:'sw0971', averageNewPrice:12.34, currency:'EUR', priceStatus:'priced', retrievedAt:new Date().toISOString() } };
  const { context } = client(async () => Response.json(snapshot), { cachedPrices, priceFetcher:async()=>{called=true;} });
  await context.window.collectorLoadBrickset();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(context.figures[0].value,12.34);
  assert.equal(context.figures[0].priceAvailable,true);
  assert.equal(called,false);
});
test('background prices update unit values and are cached separately from ownership data', async () => {
  const { context,storage } = client(async()=>Response.json(snapshot), {priceFetcher:async(url,options)=>{
    assert.deepEqual(JSON.parse(options.body).codes,['sw0971']);
    return Response.json({prices:[{code:'sw0971',averageNewPrice:8.75,currency:'EUR',priceStatus:'priced',retrievedAt:new Date().toISOString()}],errors:[]});
  }});
  await context.window.collectorLoadBrickset();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(context.figures[0].value,8.75);
  assert.equal(context.figures[0].ownedQuantity,2);
  assert.equal(JSON.parse(storage.get(`collector-brickset-prices-v1-${owner}`)).sw0971.averageNewPrice,8.75);
});
test('no recent sales is cached as unavailable and does not become a zero valuation', async()=>{
  const { context } = client(async()=>Response.json(snapshot), {priceFetcher:async()=>Response.json({prices:[{code:'sw0971',averageNewPrice:null,currency:'EUR',priceStatus:'no_sales',retrievedAt:new Date().toISOString()}],errors:[]})});
  await context.window.collectorLoadBrickset();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(context.figures[0].priceAvailable,false);
});
test('used fallback supplies a valuation and old no-sales caches are retried',async()=>{
  let calls=0;
  const cachedPrices={sw0971:{averageNewPrice:null,currency:'EUR',priceStatus:'no_sales',retrievedAt:new Date().toISOString()}};
  const {context}=client(async()=>Response.json(snapshot),{cachedPrices,priceFetcher:async()=>{
    calls++;
    return Response.json({prices:[{code:'sw0971',averagePrice:6.5,averageNewPrice:null,averageUsedPrice:6.5,priceCondition:'used',fallbackChecked:true,currency:'EUR',priceStatus:'priced',retrievedAt:new Date().toISOString()}],errors:[]});
  }});
  await context.window.collectorLoadBrickset();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls,1);assert.equal(context.figures[0].value,6.5);assert.equal(context.figures[0].priceCondition,'used');
});
test('late prices cannot overwrite figures after switching collection',async()=>{
  let finish,began;const started=new Promise(resolve=>began=resolve);
  const {context}=client(async()=>Response.json(snapshot),{priceFetcher:()=>new Promise(resolve=>{finish=resolve;began();})});
  await context.window.collectorLoadBrickset();await started;
  context.selectCollection('Star Wars');context.activeCollection='Star Wars';context.figures=[{value:123}];
  finish(Response.json({prices:[{code:'sw0971',averageNewPrice:99,currency:'EUR'}],errors:[]}));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(context.figures[0].value,123);
});
