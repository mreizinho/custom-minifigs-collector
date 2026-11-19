import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { googleAccessResponse } from '../worker/google-access.js';
const clientSource=fs.readFileSync(new URL('../google-access.js',import.meta.url),'utf8');
function browser({failure,wait}={}){
  const requests=[],events=[];let popup,resolveFetch;
  const window={collectorFirebaseUser:'user1',collectorGetIdToken:async()=> 'firebase-id',dispatchEvent:event=>events.push(event.type),google:{accounts:{oauth2:{initCodeClient:options=>({requestCode(){popup=options;}})}}}};
  vm.runInNewContext(clientSource,{window,CustomEvent:class{constructor(type){this.type=type;}},fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));
    if(wait)await new Promise(resolve=>{resolveFetch=resolve;});
    return{ok:!failure,json:async()=>failure||{access_token:'access',expires_in:3600}};
  }});
  return{window,requests,events,popup:()=>popup,release:()=>resolveFetch()};
}
test('startup renewal never creates a Google code client or opens a popup',async()=>{
  const b=browser();assert.equal((await b.window.collectorGoogleAccess.refresh()).access_token,'access');
  assert.equal(b.popup(),undefined);assert.deepEqual(b.requests,[{action:'refresh',force:false}]);
});
test('expired/revoked access requests an explicit reconnect, never an automatic popup fallback',async()=>{
  const b=browser({failure:{error:'Reconnect',code:'google_reconnect_required'}});
  await assert.rejects(b.window.collectorGoogleAccess.refresh(),error=>error.code==='google_reconnect_required');
  assert.equal(b.popup(),undefined);assert.deepEqual(b.events,['collector-google-access-required']);
});
test('concurrent private API requests share one background refresh',async()=>{
  const b=browser({wait:true}),one=b.window.collectorGoogleAccess.refresh(),two=b.window.collectorGoogleAccess.refresh();
  assert.equal(one,two);await new Promise(setImmediate);b.release();await one;
  assert.equal(b.requests.length,1);
});
test('manual connection launches synchronously and exchanges only the code on the backend',async()=>{
  const b=browser(),promise=b.window.collectorGoogleAccess.connect();
  assert.ok(b.popup());assert.equal(b.requests.length,0);
  b.popup().callback({code:'single-use-code'});await promise;
  assert.deepEqual(b.requests,[{action:'connect',code:'single-use-code'}]);
});
test('a pending connection cannot be saved after switching Google accounts',async()=>{
  const b=browser(),promise=b.window.collectorGoogleAccess.connect();b.window.collectorFirebaseUser='user2';
  b.popup().callback({code:'single-use-code'});await assert.rejects(promise,/account changed/);assert.equal(b.requests.length,0);
});
const user={localId:'firebase-user',googleId:'google-sub'};
const origin='https://cmcollector.com';
const json=(origin,data,status=200)=>new Response(JSON.stringify(data),{status});
function server(){
  const store=new Map();
  const env={GOOGLE_OAUTH_CLIENT_SECRET:'test-secret',GOOGLE_TOKEN_ENCRYPTION_KEY:btoa('01234567890123456789012345678901'),GOOGLE_CONNECTIONS:{get:async key=>store.get(key),put:async(key,value)=>store.set(key,value),delete:async key=>store.delete(key)}};
  const request=(body,identity=user)=>googleAccessResponse(new Request('https://worker.example/google/access',{method:'POST',body:JSON.stringify(body)}),env,identity,origin,json);
  return{store,env,request};
}
function mockGoogle(t,handler){const previous=globalThis.fetch;globalThis.fetch=handler;t.after(()=>{globalThis.fetch=previous;});}
async function connect(s){const response=await s.request({action:'connect',code:'code'});assert.equal(response.status,200);return response.json();}
const googleResponse=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('server binds Google identity, encrypts tokens, and reuses valid access without reauthorization',async t=>{
  const s=server();let exchanges=0;
  mockGoogle(t,async(url,options)=>{
    if(String(url).endsWith('userinfo'))return googleResponse({sub:user.googleId});
    exchanges++;assert.equal(options.body.get('redirect_uri'),origin);return googleResponse({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600});
  });
  await connect(s);const stored=s.store.get('google:'+user.localId);
  assert.ok(!stored.includes('private-access'));assert.ok(!stored.includes('private-refresh'));
  const response=await s.request({action:'refresh'});assert.equal((await response.json()).access_token,'private-access');assert.equal(exchanges,1);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await s.request({action:'refresh'},{localId:'other',googleId:'other'})).status,401);
});
test('server rejects connecting another Google account before storing any credentials',async t=>{
  const s=server();mockGoogle(t,async url=>String(url).endsWith('userinfo')?googleResponse({sub:'another-google-user'}):googleResponse({access_token:'access',refresh_token:'refresh'}));
  const response=await s.request({action:'connect',code:'code'});assert.equal(response.status,403);assert.equal(s.store.size,0);
});
test('forced renewal uses the refresh token; revoked grants require consent but temporary failures keep the connection',async t=>{
  const s=server();let mode='connect';
  mockGoogle(t,async(url,options)=>{
    if(String(url).endsWith('userinfo'))return googleResponse({sub:user.googleId});
    if(mode==='connect')return googleResponse({access_token:'old',refresh_token:'refresh',expires_in:3600});
    assert.equal(options.body.get('grant_type'),'refresh_token');assert.equal(options.body.get('refresh_token'),'refresh');
    if(mode==='temporary')return googleResponse({error:'temporarily_unavailable'},503);
    if(mode==='revoked')return googleResponse({error:'invalid_grant'},400);
    return googleResponse({access_token:'renewed',expires_in:3600});
  });
  await connect(s);mode='refresh';assert.equal((await (await s.request({action:'refresh',force:true})).json()).access_token,'renewed');
  mode='temporary';assert.equal((await s.request({action:'refresh',force:true})).status,503);assert.equal(s.store.size,1);
  mode='revoked';assert.equal((await s.request({action:'refresh',force:true})).status,401);assert.equal(s.store.size,0);
});
test('disconnect removes the connection even if revocation is unavailable',async t=>{
  const s=server();mockGoogle(t,async url=>String(url).endsWith('userinfo')?googleResponse({sub:user.googleId}):googleResponse({access_token:'access',refresh_token:'refresh'}));await connect(s);
  globalThis.fetch=async()=>{throw Error('offline');};assert.equal((await s.request({action:'disconnect'})).status,200);assert.equal(s.store.size,0);
});
test('server reports missing setup and missing verified Google identity without leaking secrets',async()=>{
  const s=server();assert.equal((await s.request({action:'refresh'},{localId:'user'})).status,401);
  delete s.env.GOOGLE_OAUTH_CLIENT_SECRET;const response=await s.request({action:'refresh'});assert.equal(response.status,503);assert.equal((await response.json()).code,'google_not_configured');
});
test('declined Drive consent does not replace a connection with an unusable token',async t=>{
  const s=server();mockGoogle(t,async()=>googleResponse({access_token:'access',refresh_token:'refresh',scope:'openid'}));
  const response=await s.request({action:'connect',code:'code'});assert.equal(response.status,401);assert.equal(s.store.size,0);
});
test('production includes the client before app startup and excludes local credential files',()=>{
  const root=new URL('../dist/',import.meta.url),html=fs.readFileSync(new URL('index.html',root),'utf8');
  assert.ok(html.indexOf('src="google-access.js?')<html.indexOf('src="app.js?'));
  assert.ok(fs.existsSync(new URL('google-access.js',root)));
  assert.ok(!fs.existsSync(new URL('.env.google',root)));
  assert.ok(!fs.readFileSync(new URL('google-access.js',root),'utf8').includes('GOOGLE_OAUTH_CLIENT_SECRET'));
});
