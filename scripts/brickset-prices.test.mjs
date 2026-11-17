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
function fixture(){
  const values=new Map([['https://worker/brickset-cache/v1/owner',{figures:[{code:'col001'},{code:'sw0971'}]}]]);
  const cache={match:async key=>values.has(key.url)?Response.json(values.get(key.url)):undefined,put:async(key,value)=>values.set(key.url,await value.json())};
  const env={BRICKSET_ALLOWED_UID:'owner',BRICKLINK_CONSUMER_KEY:'key',BRICKLINK_CONSUMER_SECRET:'secret',BRICKLINK_TOKEN:'token',BRICKLINK_TOKEN_SECRET:'token-secret'};
  const request=codes=>new Request('https://worker/brickset/prices',{method:'POST',body:JSON.stringify({codes})});
  const json=(origin,data,status=200)=>Response.json(data,{status});
  return{cache,env,request,json};
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
test('owned total multiplies Brickset prices by quantity and keeps regular collections unchanged',()=>{
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').match(/function updateStats\(\)\{[^\n]+/)[0];
  const elements=new Map();const $=key=>{if(!elements.has(key))elements.set(key,{});return elements.get(key);};
  const context={figures:[{source:'brickset',value:10,ownedQuantity:3,currencyCode:'EUR',brand:'LEGO'},{value:7,ownedQuantity:100,currencyCode:'EUR',brand:'Custom'}],isHidden:()=>false,isOwned:()=>true,isPreordered:()=>false,isWished:()=>false,totalCurrency:'EUR',exchangeRates:{EUR:1},ratesReady:true,money:n=>`${n}€`,currencySymbol:()=> '€',$,document:{querySelectorAll:()=>[]}};
  vm.createContext(context);vm.runInContext(source+'\nupdateStats();',context);
  assert.equal($('#ownedValue').textContent,'37€ estimated');
});
