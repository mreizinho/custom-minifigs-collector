import { lookupMinifigurePrice } from './bricklink.js';
import { readBricksetCollection } from './brickset.js';

export async function bricksetPricesResponse(request,env,user,origin,json,{cache=caches.default,fetcher=fetch}={}){
  if(!env.BRICKSET_ALLOWED_UID||user.localId!==env.BRICKSET_ALLOWED_UID)return json(origin,{error:'Brickset is not connected for this account.'},403);
  const body=await request.json(),codes=body.codes;
  if(!Array.isArray(codes)||!codes.length||codes.length>8||codes.some(code=>typeof code!=='string'||!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code))||new Set(codes).size!==codes.length)return json(origin,{error:'Request up to eight unique minifigure references.'},400);
  const base=new URL(request.url).origin;
  const collectionKey=new Request(`${base}/brickset-cache/v1/${encodeURIComponent(user.localId)}`);
  const cached=await cache.match(collectionKey);
  const collection=cached?await cached.json():await readBricksetCollection(env,fetcher);
  if(!cached)await cache.put(collectionKey,new Response(JSON.stringify(collection),{headers:{'Cache-Control':'max-age=900'}}));
  const owned=new Set(collection.figures.map(row=>row.code));
  if(codes.some(code=>!owned.has(code)))return json(origin,{error:'Prices are available only for your owned Brickset minifigures.'},400);
  const credentials={consumerKey:env.BRICKLINK_CONSUMER_KEY,consumerSecret:env.BRICKLINK_CONSUMER_SECRET,token:env.BRICKLINK_TOKEN,tokenSecret:env.BRICKLINK_TOKEN_SECRET};
  const prices=[],errors=[];let cursor=0,rateLimited=false;
  async function run(){
    while(cursor<codes.length&&!rateLimited){
      const code=codes[cursor++],key=new Request(`${base}/brickset-price-cache/v1/${encodeURIComponent(user.localId)}/${code}`);
      try{
        const previous=await cache.match(key);
        if(previous){prices.push(await previous.json());continue;}
        const price=await lookupMinifigurePrice(code,credentials,fetcher);
        await cache.put(key,new Response(JSON.stringify(price),{headers:{'Cache-Control':'max-age=86400'}}));
        prices.push(price);
      }catch(error){errors.push({code,error:error.message});rateLimited ||= error.rateLimited===true;}
    }
  }
  await Promise.all([run(),run()]);
  return json(origin,{prices,errors,rateLimited,priceBasis:'Average new-condition sales over the last six months, EUR'});
}
