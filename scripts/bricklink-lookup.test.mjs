import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorization, lookup } from './bricklink-lookup.mjs';
const credentials={consumerKey:'key',consumerSecret:'secret',token:'token',tokenSecret:'token-secret'};
test('signs requests and fetches new sold prices in EUR',async()=>{
  const calls=[];
  const result=await lookup('SW0001',credentials,async(url,options)=>{
    calls.push(url);assert.match(options.headers.Authorization,/^OAuth /);
    return{ok:true,status:200,json:async()=>({meta:{code:200},data:calls.length===1?{name:'Catalogue name',image_url:'//img.bricklink.com/example.png'}:{avg_price:'12.3456',total_quantity:3,currency_code:'EUR'}})};
  });
  assert.match(calls[1],/MINIFIG\/sw0001\/price\?guide_type=sold&new_or_used=N&currency_code=EUR$/);
  assert.equal(result.averageNewPrice,12.3456);assert.equal(result.photoUrl,'https://img.bricklink.com/example.png');
});
test('does not mistake no sales for a zero valuation',async()=>{
  const result=await lookup('sw0001',credentials,async()=>({ok:true,status:200,json:async()=>({meta:{code:200},data:{avg_price:'0',total_quantity:0}})}));
  assert.equal(result.averageNewPrice,null);
});
test('rejects missing credentials before making requests',async()=>{
  await assert.rejects(lookup('sw0001',{},()=>{throw Error('Should not fetch')}),/Missing BrickLink credential/);
});
test('OAuth signing is deterministic for fixed nonce and timestamp',()=>{
  const options={nonce:'nonce',timestamp:123};
  assert.equal(authorization('https://example.com/items?b=2&a=1',credentials,options),authorization('https://example.com/items?a=1&b=2',credentials,options));
  assert.match(authorization('https://example.com/items',credentials,options),/oauth_signature=/);
});
