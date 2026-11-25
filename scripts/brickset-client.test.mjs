import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code = fs.readFileSync(new URL('../brickset-collection.js', import.meta.url), 'utf8');
const owner = 'rh8WrITlLTXrsDj5mbJHzA1D4Bk2';
const snapshot = { source: 'brickset', fetchedAt: '2026-11-17T00:00:00Z', notesAvailable: true, figures: [
  { code: 'sw0971', name: 'Luke', theme: 'Star Wars', tags: ['Star Wars'], ownedTotal: 2, ownedInSets: 1, ownedLoose: 1, photoUrl: 'https://img.bricklink.com/ItemImage/MN/0/sw0971.png' }
] };
function client(fetcher, { cached, uid = owner, priceFetcher, cachedPrices, defaultTag, collections=['Star Wars'] } = {}) {
  const storage = new Map(), elements = new Map();
  if (cached) storage.set(`collector-brickset-cache-v1-${owner}`, JSON.stringify(cached));
  if (cachedPrices) storage.set(`collector-brickset-prices-v1-${owner}`, JSON.stringify(cachedPrices));
  if (defaultTag) storage.set(`collector-brickset-default-tag-v1-${owner}`, defaultTag);
  const element = () => {
    const children=new Map();
    return { hidden: false, disabled: false, textContent: '', innerHTML: '',
      classList: { toggle() {}, remove() {}, add() {} }, style:{removeProperty(){}},before() {}, after() {}, append() {}, setAttribute() {}, replaceChildren() {}, scrollIntoView() {}, querySelectorAll: () => [],
      querySelector(selector){if(!children.has(selector))children.set(selector,element());return children.get(selector);}
    };
  };
  const totalCard=element();
  totalCard.closest=()=>totalCard;
  const ownedButton=element(),valueButton=element();
  ownedButton.closest=valueButton.closest=()=>totalCard;
  const status = element(), refresh = element(), bar = element();
  const pagers=[],rendered=[];
  bar.querySelector = selector => selector === 'button' ? refresh : status;
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, element());const result=elements.get(selector);result.closest=()=>selector==='#ownedStat'?ownedButton:selector==='#ownedValue'?valueButton:totalCard;return result; };
  const context = { window: { collectorFirebaseUser: uid, collectorGetIdToken: async () => 'firebase-test-token', addEventListener() {}, matchMedia:()=>({matches:false}) },
    document: { createElement: tag => {if(tag==='div')return bar;const created=element();if(tag==='nav')pagers.push(created);return created;}, body: element(), querySelectorAll: () => [], querySelector: () => null }, $,
    fetch: (url, options) => url.endsWith('/prices') ? (priceFetcher ? priceFetcher(url, options) : Promise.resolve(Response.json({prices:[],errors:[{error:'No test prices'}]}))) : fetcher(url, options),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) },
    activeCollection: 'Brickset', COLLECTIONS: [...collections], figures: [], authenticatedLoadRevision: 0,
    canReadBricksetCollection: () => uid === owner, renderFilters() {}, render() { rendered.push([...context.filtered()].map(row=>row.id));context.updateStats(); }, openDetail() {},
    collectionMenuElement: { querySelectorAll: () => [] }, rebuildCollectionChoices() {},
    toggleOwned() {}, toggleWished() {}, openRenameCollection() {}, deleteCollection() {}, selectCollection() {},
    queueMicrotask() {}, AbortSignal, AbortController, setTimeout, clearTimeout, updateStats() {}, loadExchangeRates() {}, money: n => String(n),formatFigureCount:n=>Number(n).toLocaleString('de-DE')
  };
  context.isBricksetCollection = (name = context.activeCollection) => name === 'Brickset' && uid === owner;
  context.filtered = () => context.figures;
  vm.createContext(context); vm.runInContext(code, context);
  return { context, status, refresh, storage, elements, pagers, rendered };
}
test('selects the saved tag on entry and preserves manual changes while browsing', async () => {
  const {context,storage}=client(async()=>Response.json(snapshot),{defaultTag:'Star Wars'});
  const pins=new Map();
  const tags=['Star Wars','Castle'].map(value=>({
    value,checked:false,closest:()=>({classList:{toggle:(_name,pinned)=>pins.set(value,pinned)},setAttribute(){},removeAttribute(){}})
  }));
  context.$('#tagFilters').querySelectorAll=()=>tags;
  await context.window.collectorLoadBrickset();
  assert.deepEqual(tags.map(tag=>tag.checked),[true,false]);
  assert.equal(pins.get('Star Wars'),true);
  tags[0].checked=false;tags[1].checked=true;
  context.renderFilters();
  assert.deepEqual(tags.map(tag=>tag.checked),[false,true]);
  assert.equal(storage.get(`collector-brickset-default-tag-v1-${owner}`),'Star Wars');
  const choices=tags.map(({value})=>({value,checked:true}));
  context.$('#bricksetTagChoices').querySelectorAll=()=>choices.filter(choice=>choice.checked);
  context.$('#bricksetDefaultTagDialog').close=()=>{};
  context.$('#bricksetDefaultTagForm').onsubmit({preventDefault(){}});
  assert.equal(storage.get(`collector-brickset-default-tags-v1-${owner}`),'["Star Wars","Castle"]');
  assert.deepEqual(tags.map(tag=>tag.checked),[true,true]);
  context.selectCollection('Other');context.activeCollection='Other';
  context.selectCollection('Brickset');context.activeCollection='Brickset';context.figures=[];
  tags.forEach(tag=>{tag.checked=false});
  await context.window.collectorLoadBrickset();
  assert.deepEqual(tags.map(tag=>tag.checked),[true,true]);
  context.$('#clearBricksetDefaultTags').onclick();
  context.$('#bricksetDefaultTagForm').onsubmit({preventDefault(){}});
  assert.equal(storage.get(`collector-brickset-default-tags-v1-${owner}`),'[]');
  assert.deepEqual(tags.map(tag=>tag.checked),[false,false]);
});
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
  assert.equal(status.textContent, '');
  assert.equal(elements.get('#ownedStat').closest('button').title,'Ownership managed in Brickset');
  assert.equal(elements.get('#ownedStat').closest('button').disabled,true);
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
test('switching to Brickset keeps stale prices and missing valuations until the refresh button is clicked', async () => {
  let priceCalls=0;
  const data={...snapshot,figures:[...snapshot.figures,{...snapshot.figures[0],code:'sw0001'}]};
  const cachedPrices={sw0971:{averagePrice:12.34,currency:'EUR',retrievedAt:'2000-01-01T00:00:00Z'}};
  const {context,refresh}=client(async()=>Response.json(data),{cachedPrices,priceFetcher:async(url,options)=>{
    priceCalls++;
    assert.deepEqual(JSON.parse(options.body).codes,['sw0971','sw0001']);
    return Response.json({prices:['sw0971','sw0001'].map(code=>({code,averagePrice:9,currency:'EUR',retrievedAt:new Date().toISOString()}))});
  }});
  await context.window.collectorLoadBrickset();
  context.selectCollection('Star Wars');context.activeCollection='Star Wars';
  context.activeCollection='Brickset';await context.window.collectorLoadBrickset();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(priceCalls,0);
  assert.equal(context.figures[0].value,12.34);
  assert.equal(context.figures[1].priceAvailable,false);
  await refresh.onclick();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(priceCalls,1);assert.equal(context.figures[0].value,9);assert.equal(context.figures[1].priceAvailable,true);
});
test('explicit refresh updates unit values and caches them separately from ownership data', async () => {
  const { context,storage } = client(async()=>Response.json(snapshot), {priceFetcher:async(url,options)=>{
    assert.deepEqual(JSON.parse(options.body).codes,['sw0971']);
    return Response.json({prices:[{code:'sw0971',averageNewPrice:8.75,currency:'EUR',priceStatus:'priced',retrievedAt:new Date().toISOString()}],errors:[]});
  }});
  await context.window.collectorLoadBrickset(true);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(context.figures[0].value,8.75);
  assert.equal(context.figures[0].ownedQuantity,2);
  assert.equal(JSON.parse(storage.get(`collector-brickset-prices-v1-${owner}`)).sw0971.averageNewPrice,8.75);
});
test('no recent sales is cached as unavailable and does not become a zero valuation', async()=>{
  const { context } = client(async()=>Response.json(snapshot), {priceFetcher:async()=>Response.json({prices:[{code:'sw0971',averageNewPrice:null,currency:'EUR',priceStatus:'no_sales',retrievedAt:new Date().toISOString()}],errors:[]})});
  await context.window.collectorLoadBrickset(true);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(context.figures[0].priceAvailable,false);
});
test('used fallback supplies a valuation and old no-sales caches are retried',async()=>{
  let calls=0;
  const cachedPrices={sw0971:{averageNewPrice:null,currency:'EUR',priceStatus:'no_sales',retrievedAt:new Date().toISOString()}};
  const {context}=client(async()=>Response.json(snapshot),{cachedPrices,priceFetcher:async()=>{
    calls++;
    return Response.json({prices:[{code:'sw0971',averagePrice:6.5,averageNewPrice:null,averageUsedPrice:6.5,priceCondition:'used',fallbackChecked:true,currency:'EUR',priceStatus:'priced',retrievedAt:new Date().toISOString()}],errors:[]});
  }});
  await context.window.collectorLoadBrickset(true);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(calls,1);assert.equal(context.figures[0].value,6.5);assert.equal(context.figures[0].priceCondition,'used');
});
test('late prices cannot overwrite figures after switching collection',async()=>{
  let finish,began;const started=new Promise(resolve=>began=resolve);
  const {context}=client(async()=>Response.json(snapshot),{priceFetcher:()=>new Promise(resolve=>{finish=resolve;began();})});
  await context.window.collectorLoadBrickset(true);await started;
  context.selectCollection('Star Wars');context.activeCollection='Star Wars';context.figures=[{value:123}];
  finish(Response.json({prices:[{code:'sw0971',averageNewPrice:99,currency:'EUR'}],errors:[]}));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(context.figures[0].value,123);
});
test('large collections render only one page while search and details retain every figure',async()=>{
  const large={...snapshot,figures:Array.from({length:2188},(_,i)=>({...snapshot.figures[0],code:`fig${String(i+1).padStart(4,'0')}`}))};
  const {context,pagers,rendered,elements}=client(async()=>Response.json(large),{cached:large});
  await context.window.collectorLoadBrickset();
  assert.equal(context.figures.length,2188);
  assert.equal(context.filtered().length,2188);
  assert.equal(rendered.length,1,'unchanged fresh data must not rebuild the cached catalogue');
  assert.equal(rendered[0].length,96);
  assert.equal(pagers[0].querySelector('span').textContent,'1–96 of 2.188');
  assert.equal(pagers.length,1,'Only the bottom pagination row is created');
  assert.equal(elements.get('#resultCount').textContent,'BRICKSET: Showing 2.188 of 2.188 minifigs');
  pagers[0].querySelector('[data-page="next"]').onclick();
  assert.equal(rendered.at(-1)[0],'Brickset::fig0097');
  assert.equal(pagers[0].querySelector('span').textContent,'97–192 of 2.188');
  context.filtered=()=>context.figures.filter(row=>row.character==='fig2188');context.render();
  assert.deepEqual(rendered.at(-1),['Brickset::fig2188']);
  assert.equal(pagers[0].hidden,true);
  assert.equal(elements.get('#resultCount').textContent,'BRICKSET: Showing 1 of 2.188 minifigs');
});
