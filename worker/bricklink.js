import { createHmac, randomUUID } from 'node:crypto';

const encode=value=>encodeURIComponent(String(value)).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
export function authorization(url,credentials,{nonce=randomUUID(),timestamp=Math.floor(Date.now()/1000)}={}){
  const oauth={oauth_consumer_key:credentials.consumerKey,oauth_token:credentials.token,oauth_nonce:nonce,oauth_timestamp:String(timestamp),oauth_signature_method:'HMAC-SHA1',oauth_version:'1.0'};
  const parsed=new URL(url),params=[...parsed.searchParams,...Object.entries(oauth)].map(([key,value])=>[encode(key),encode(value)]).sort(([ak,av],[bk,bv])=>ak<bk?-1:ak>bk?1:av<bv?-1:av>bv?1:0);
  const normalized=params.map(pair=>pair.join('=')).join('&'),base=`GET&${encode(parsed.origin+parsed.pathname)}&${encode(normalized)}`;
  oauth.oauth_signature=createHmac('sha1',`${encode(credentials.consumerSecret)}&${encode(credentials.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth '+Object.entries(oauth).map(([key,value])=>`${encode(key)}="${encode(value)}"`).join(', ');
}

export async function lookup(code,credentials,fetcher=fetch){
  code=String(code).trim().toLowerCase();
  if(!/^sw\d+[a-z]?$/.test(code))throw Error('Enter a Star Wars minifigure code such as sw0001.');
  for(const key of ['consumerKey','consumerSecret','token','tokenSecret'])if(!credentials[key])throw Error(`Missing BrickLink credential: ${key}.`);
  const base=`https://api.bricklink.com/api/store/v1/items/MINIFIG/${encode(code)}`;
  async function get(url){
    const response=await fetcher(url,{headers:{Authorization:authorization(url,credentials)},signal:AbortSignal.timeout(20000)});
    let result;try{result=await response.json()}catch{throw Error(`BrickLink returned a non-JSON response (HTTP ${response.status}).`)}
    if(!response.ok||Number(result.meta?.code)!==200)throw Error(`BrickLink request failed (HTTP ${response.status}, API ${result.meta?.code??'unknown'}). Check API registration and IP restrictions.`);
    return result.data;
  }
  const item=await get(base),guide=await get(`${base}/price?guide_type=sold&new_or_used=N&currency_code=EUR`);
  const price=Number(guide.avg_price),hasSales=Number(guide.total_quantity)>0;
  const photo=item.image_url?new URL(item.image_url,'https://www.bricklink.com').href.replace(/^http:/,'https:'):'';
  return{bricklinkCode:code,name:item.name,brand:'LEGO',photoUrl:photo,averageNewPrice:hasSales&&Number.isFinite(price)?price:null,currency:guide.currency_code,priceBasis:'Last 6 months sales, new, average',quantitySold:Number(guide.total_quantity)||0,retrievedAt:new Date().toISOString()};
}

// Price-only lookup for owned Brickset minifigures across every theme.
export async function lookupMinifigurePrice(code,credentials,fetcher=fetch){
  code=String(code).trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code))throw Error('Invalid minifigure reference.');
  for(const key of ['consumerKey','consumerSecret','token','tokenSecret'])if(!credentials[key])throw Error('BrickLink prices are not configured.');
  const url=`https://api.bricklink.com/api/store/v1/items/MINIFIG/${encode(code)}/price?guide_type=sold&new_or_used=N&currency_code=EUR`;
  const response=await fetcher(url,{headers:{Authorization:authorization(url,credentials)},signal:AbortSignal.timeout(12000)});
  let result;try{result=await response.json()}catch{throw Error('BrickLink prices are temporarily unavailable.');}
  const status=Number(result.meta?.code)||response.status;
  if(status===404)return{code,averageNewPrice:null,currency:'EUR',priceStatus:'not_found',retrievedAt:new Date().toISOString()};
  if(!response.ok||status!==200){const error=Error(status===429?'BrickLink rate limit reached. Try refreshing later.':'BrickLink prices are temporarily unavailable.');error.rateLimited=status===429;throw error;}
  const guide=result.data;
  if(!guide||guide.currency_code!=='EUR')throw Error('BrickLink returned an invalid price guide.');
  const price=Number(guide.avg_price),hasPrice=Number(guide.total_quantity)>0&&guide.avg_price!=null&&String(guide.avg_price).trim()!==''&&Number.isFinite(price)&&price>=0;
  return{code,averageNewPrice:hasPrice?price:null,currency:'EUR',priceStatus:hasPrice?'priced':'no_sales',retrievedAt:new Date().toISOString()};
}
