import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { lookupMinifigurePrice } from '../worker/bricklink.js';
import { bricksetPricesResponse } from '../worker/brickset-prices.js';
const credentials={consumerKey:'key',consumerSecret:'secret',token:'token',tokenSecret:'token-secret'};
test('prices every theme through the new-condition EUR sold guide with one request',async()=>{
  let calls=0;
  const price=await lookupMinifigurePrice('col001',credentials,async(url,options)=>{
    calls++;assert.ok(url.includes('/MINIFIG/col001/price?guide_type=sold&new_or_used=N&currency_code=EUR'));
    assert.ok(options.headers.Authorization.startsWith('OAuth '));
    return Response.json({meta:{code:200},data:{currency_code:'EUR',avg_price:'12.34',total_quantity:5}});
  });
  assert.equal(calls,1);assert.equal(price.averageNewPrice,12.34);
});
test('no sales and missing catalogue entries remain unavailable; upstream errors propagate',async()=>{
  const empty=await lookupMinifigurePrice('col001',credentials,async()=>Response.json({meta:{code:200},data:{currency_code:'EUR',avg_price:'0',total_quantity:0}}));
  assert.equal(empty.averageNewPrice,null);assert.equal(empty.priceStatus,'no_sales');
  const missing=await lookupMinifigurePrice('col001',credentials,async()=>Response.json({meta:{code:404}},{status:404}));
  assert.equal(missing.priceStatus,'not_found');
  await assert.rejects(lookupMinifigurePrice('col001',credentials,async()=>Response.json({meta:{code:429}},{status:429})),error=>error.rateLimited===true);
});
test('falls back to recent used sales only when recent new sales have no price',async()=>{
  const calls=[];
  const result=await lookupMinifigurePrice('col001',credentials,async url=>{
    const condition=new URL(url).searchParams.get('new_or_used');calls.push(condition);
    return Response.json({meta:{code:200},data:{currency_code:'EUR',avg_price:condition==='N'?'0':'7.25',total_quantity:condition==='N'?0:9}});
  });
  assert.deepEqual(calls,['N','U']);assert.equal(result.averagePrice,7.25);assert.equal(result.averageNewPrice,null);
  assert.equal(result.averageUsedPrice,7.25);assert.equal(result.priceCondition,'used');assert.equal(result.fallbackChecked,true);
});
test('does not use a used price to hide an upstream new-guide failure',async()=>{
  let calls=0;
  await assert.rejects(lookupMinifigurePrice('col001',credentials,async()=>{calls++;return Response.json({meta:{code:503}},{status:503});}),/temporarily unavailable/);
  assert.equal(calls,1);
});
function fixture(){
  const values=new Map([['https://worker/brickset-cache/v1/owner',{figures:[{code:'col001'},{code:'sw0971'}]}]]);
  const cache={match:async key=>values.has(key.url)?Response.json(values.get(key.url)):undefined,put:async(key,value)=>values.set(key.url,await value.json())};
  const env={BRICKSET_ALLOWED_UID:'owner',BRICKLINK_CONSUMER_KEY:'key',BRICKLINK_CONSUMER_SECRET:'secret',BRICKLINK_TOKEN:'token',BRICKLINK_TOKEN_SECRET:'token-secret'};
  const request=codes=>new Request('https://worker/brickset/prices',{method:'POST',body:JSON.stringify({codes})});
  const json=(origin,data,status=200)=>Response.json(data,{status});
  return{cache,env,request,json,values};
}
test('only the owner can request bounded batches of owned references',async()=>{
  const {cache,env,request,json}=fixture();const fetcher=()=>{throw Error('Unexpected upstream request');};
  const invoke=(codes,uid='owner')=>bricksetPricesResponse(request(codes),env,{localId:uid},'',json,{cache,fetcher});
  assert.equal((await invoke(['col001'],'other')).status,403);
  assert.equal((await invoke(['notowned'])).status,400);
  assert.equal((await invoke(Array(9).fill('col001'))).status,400);
  assert.equal((await invoke(['col001','col001'])).status,400);
});
test('successful price results are reused; failures are not stored as zero',async()=>{
  const {cache,env,request,json}=fixture();let calls=0;
  const fetcher=async url=>{calls++;return url.includes('col001')?Response.json({meta:{code:200},data:{currency_code:'EUR',avg_price:'5',total_quantity:1}}):Response.json({meta:{code:503}},{status:503});};
  const invoke=()=>bricksetPricesResponse(request(['col001','sw0971']),env,{localId:'owner'},'',json,{cache,fetcher});
  const a=await(await invoke()).json();assert.equal(a.prices.length,1);assert.equal(a.errors.length,1);assert.equal(a.prices[0].averageNewPrice,5);
  await invoke();assert.equal(calls,3);
});
test('rechecks legacy no-sales cache entries without discarding successful cached new prices',async()=>{
  const {cache,env,request,json,values}=fixture();
  values.set('https://worker/brickset-price-cache/v1/owner/col001',{code:'col001',averageNewPrice:null,currency:'EUR',priceStatus:'no_sales'});
  values.set('https://worker/brickset-price-cache/v1/owner/sw0971',{code:'sw0971',averageNewPrice:5,currency:'EUR',priceStatus:'priced'});
  const calls=[];
  const response=await bricksetPricesResponse(request(['col001','sw0971']),env,{localId:'owner'},'',json,{cache,fetcher:async url=>{
    calls.push(url);const used=url.includes('new_or_used=U');return Response.json({meta:{code:200},data:{currency_code:'EUR',avg_price:used?'3':'0',total_quantity:used?2:0}});
  }});
  const result=await response.json();assert.equal(calls.length,2);assert.ok(calls.every(url=>url.includes('col001')));
  assert.equal(result.prices.find(row=>row.code==='col001').averagePrice,3);
  assert.equal(result.prices.find(row=>row.code==='sw0971').averageNewPrice,5);
});
test('owned total multiplies Brickset prices by quantity and keeps regular collections unchanged',()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const source=app.match(/function formatFigureCount\(value\)\{[^\n]+/)[0]+'\n'+app.match(/function updateStats\(\)\{[^\n]+/)[0];
  const elements=new Map();const $=key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key);};
  const context={figures:[{source:'brickset',value:10,ownedQuantity:3,currencyCode:'EUR',brand:'LEGO'},{value:7,ownedQuantity:100,currencyCode:'EUR',brand:'Custom'}],isHidden:()=>false,isOwned:()=>true,isPreordered:()=>false,isWished:()=>false,totalCurrency:'EUR',exchangeRates:{EUR:1},ratesReady:true,money:n=>`${n}€`,currencySymbol:()=> '€',$,document:{querySelectorAll:()=>[]}};
  vm.createContext(context);vm.runInContext(source+'\nupdateStats();',context);
  assert.equal($('#ownedValue').textContent,'37€ estimated');
  context.figures.push(...Array.from({length:1454},()=>({value:0,currencyCode:'EUR',brand:'LEGO'})));
  vm.runInContext('updateStats()',context);
  assert.equal($('#totalCount').textContent,'1.456');assert.equal($('#ownedStat').textContent,'1.456');
});
