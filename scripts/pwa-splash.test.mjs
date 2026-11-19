import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../pwa-splash.js',import.meta.url),'utf8');
function launch({installed=true,reduced=false,mode='standalone'}={}) {
  let now=0,id=0;
  const timers=new Map(),listeners=new Map(),events=[],classes=new Set();
  const layerClasses=new Set(),frame={dataset:{src:'/assets/splash/lego-splash.html'},contentWindow:{},addEventListener(){}};
  const layer={hidden:true,tagName:'DIV',classList:{add:name=>layerClasses.add(name)},querySelector:()=>frame,setAttribute(){},remove(){this.removed=true;}};
  const main={tagName:'MAIN',inert:false},dialog={tagName:'DIALOG',inert:true};
  const document={documentElement:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},body:{children:[layer,main,dialog]},getElementById:()=>layer,addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>events.push(event.type)};
  const window={navigator:{},matchMedia:query=>({matches:query.includes('reduced')?reduced:query.includes(`display-mode: ${mode}`)&&installed}),addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const context={window,document,location:{origin:'https://test.example',search:''},URL,URLSearchParams,CustomEvent:class{constructor(type){this.type=type;}},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,context);
  const tick=ms=>{const target=now+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at).find(([,timer])=>timer.at<=target);if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=target;};
  const message=(overrides={})=>listeners.get('message')?.({origin:context.location.origin,source:frame.contentWindow,data:{type:'collector-splash-animation-complete'},...overrides});
  return{window,layer,frame,classes,layerClasses,main,dialog,events,listeners,tick,message};
}
test('normal browser visits do not load or show the animation',()=>{
  const p=launch({installed:false});assert.equal(p.window.collectorSplash,undefined);assert.equal(p.frame.src,undefined);assert.equal(p.classes.size,0);
});
test('desktop custom-titlebar mode starts the splash and waits for animation completion',async()=>{
  const p=launch({mode:'window-controls-overlay'});assert.ok(p.window.collectorSplash);
  p.window.collectorSplash.mount();assert.equal(p.layer.hidden,false);assert.ok(p.frame.src.includes('/assets/splash/lego-splash.html'));
  const waiting=p.window.collectorSplash.beforeInteraction();assert.equal(p.events.length,0);
  p.message();assert.equal(p.events.length,1);p.tick(320);await waiting;assert.equal(p.layer.removed,true);
});
test('waits for the full supplied animation even when initialization finishes first',()=>{
  const p=launch();p.window.collectorSplash.mount();p.listeners.get('DOMContentLoaded')();
  assert.equal(p.layer.hidden,false);assert.equal(p.main.inert,true);
  p.window.collectorSplash.ready();assert.equal(p.events.length,0);
  p.message({origin:'https://wrong.example'});p.message({source:{}});assert.equal(p.events.length,0);
  p.message();assert.deepEqual(p.events,['pwa-splash-complete']);assert.equal(p.main.inert,false);assert.equal(p.dialog.inert,true);
  assert.ok(p.layerClasses.has('is-leaving'));p.tick(320);assert.ok(p.layer.removed);
});
test('waits for initialization when the animation finishes first',()=>{
  const p=launch();p.window.collectorSplash.mount();p.message();assert.equal(p.events.length,0);
  p.window.collectorSplash.ready();assert.equal(p.events.length,1);p.window.collectorSplash.ready();assert.equal(p.events.length,1);
});
test('startup/network failure cannot leave the application blocked',()=>{
  const p=launch();p.window.collectorSplash.mount();p.listeners.get('DOMContentLoaded')();p.tick(12000);
  assert.equal(p.main.inert,false);assert.equal(p.classes.size,0);p.tick(320);assert.ok(p.layer.removed);
});
test('reduced motion dismisses without an animated fade',()=>{
  const p=launch({reduced:true});p.window.collectorSplash.mount();p.window.collectorSplash.ready();p.message();p.tick(0);assert.ok(p.layer.removed);
});
test('onboarding is an actionable ready state; no pageshow/visibility replay handlers',()=>{
  const p=launch();p.window.collectorSplash.mount();p.message();p.listeners.get('collector-onboarding-needed')();assert.equal(p.events.length,1);
  assert.equal(p.listeners.has('pageshow'),false);assert.equal(p.listeners.has('visibilitychange'),false);
});
test('interactive authorization waits for the animation and fade without waiting for collection data',async()=>{
  const p=launch();p.window.collectorSplash.mount();let authorized=false;
  const waiting=p.window.collectorSplash.beforeInteraction();waiting.then(()=>{authorized=true;});
  assert.equal(authorized,false);p.message();p.tick(319);await Promise.resolve();assert.equal(authorized,false);
  p.tick(1);await waiting;assert.equal(authorized,true);assert.equal(p.layer.removed,true);
  assert.equal(p.window.collectorSplash.beforeInteraction(),null);
});
test('a failed animation still releases queued authorization at the safety deadline',async()=>{
  const p=launch();p.window.collectorSplash.mount();const waiting=p.window.collectorSplash.beforeInteraction();
  p.tick(12320);await waiting;assert.equal(p.layer.removed,true);
});
function sheetsAuthorization(p){
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const acquire=app.split(/\r?\n/).find(line=>line.startsWith('function acquireSheetsToken('));
  let popupCount=0;
  p.window.collectorFirebaseUser='test-user';
  p.window.collectorGoogleAccess={connect(){popupCount++;return Promise.resolve({access_token:'test-token',expires_in:3600});},refresh(){return Promise.resolve({access_token:'test-token',expires_in:3600});}};
  const request=vm.runInNewContext(acquire+'\nacquireSheetsToken',{window:p.window,google:p.window.google,APP_GOOGLE_CLIENT_ID:'test-client',GOOGLE_DRIVE_FILE_SCOPE:'drive.file',GOOGLE_IDENTITY_SCOPE:'openid',cacheSheetsAccessToken(){},rememberGoogleUser:async()=>{},sheetsAccessToken:''});
  return{request,popupCount:()=>popupCount};
}
test('actual Sheets token entry point opens Google only after splash removal',async()=>{
  const p=launch();p.window.collectorSplash.mount();const auth=sheetsAuthorization(p),result=auth.request('',true);
  assert.equal(auth.popupCount(),0);p.message();p.tick(319);await Promise.resolve();assert.equal(auth.popupCount(),0);
  p.tick(1);assert.equal(await result,'test-token');assert.equal(auth.popupCount(),1);assert.equal(p.layer.removed,true);
});
test('ordinary browser sign-in retains synchronous popup launch',async()=>{
  const auth=sheetsAuthorization(launch({installed:false})),result=auth.request('',true);
  assert.equal(auth.popupCount(),1);assert.equal(await result,'test-token');
});
test('startup gets a background token without opening Google or ending the splash early',async()=>{
  const p=launch();p.window.collectorSplash.mount();const auth=sheetsAuthorization(p);
  assert.equal(await auth.request(),'test-token');assert.equal(auth.popupCount(),0);assert.equal(p.events.length,0);
});
test('production build ships the isolated supplied animation and splash resources',()=>{
  const root=new URL('../dist/',import.meta.url),html=fs.readFileSync(new URL('index.html',root),'utf8');
  for(const file of ['pwa-splash.js','pwa-splash.css','assets/splash/lego-splash.html','assets/splash/splash2.svg'])assert.ok(fs.statSync(new URL(file,root)).size>0);
  assert.match(html,/window\.collectorSplash\?\.mount\(\)/);
  const art=fs.readFileSync(new URL('assets/splash/lego-splash.html',root),'utf8');
  assert.ok(!art.includes('id="replay"'));assert.match(art,/prefers-reduced-motion:reduce/);
  assert.match(art,/--duration:6\.2s/);
  assert.match(art,/@keyframes f6\{0%,81.19%\{opacity:0\}81.2%,100%\{opacity:1\}/);
  for(let frame=1;frame<=6;frame++){
    const tag=art.match(new RegExp(`<image\\b[^>]*id="frame${frame}"[^>]*>`))[0];
    const encoded=tag.match(/href="data:image\/svg\+xml;base64,([^"]+)"/)[1];
    const original=fs.readFileSync(new URL(`assets/splash/frames/frame${frame}.svg`,root));
    const normalizeLines=buffer=>buffer.toString('utf8').replace(/\r\n/g,'\n');
    assert.equal(normalizeLines(Buffer.from(encoded,'base64')),normalizeLines(original));
  }
  assert.ok(art.includes('const start=performance.now(), begin=4030, duration=868;'));
  assert.ok(art.includes('path.getPointAtLength(distance)'));
  assert.ok(!art.includes("getElementById('replay')"));
  assert.ok(!art.includes('<section class="controls">'));
  assert.ok(!art.includes('serviceWorker.register'));
  assert.match(art,/viewBox="0 0 992.1 992.1"/);
});
test('both flash transitions switch frames at full white opacity without a blank gap',()=>{
  const art=fs.readFileSync(new URL('../assets/splash/lego-splash.html',import.meta.url),'utf8');
  assert.ok(art.includes('animation-timing-function:steps(1,end)'));
  for(const [from,to,before,peak] of [[2,3,'24.99','25'],[5,6,'81.19','81.2']]){
    const outgoing=art.match(new RegExp(`@keyframes f${from}\\{[^@]+?(?=@)`))[0];
    const incoming=art.match(new RegExp(`@keyframes f${to}\\{[^@]+?(?=@)`))[0];
    assert.ok(outgoing.includes(`${before}%{opacity:1}${peak}%,100%{opacity:0}`));
    assert.ok(incoming.includes(`0%,${before}%{opacity:0}${peak}%,`));
    assert.ok(art.includes(`${peak}%{opacity:1}`));
  }
});
function morph({reduced=false,mobile=false,desktop=!mobile}={}) {
  const html=fs.readFileSync(new URL('../assets/splash/lego-splash.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const messages=[],microtasks=[],endingClasses=new Set(),timers=new Map();let end,changed,now=0,id=0;
  const art={addEventListener:(name,fn)=>{assert.equal(name,'animationend');end=fn;}};
  const ending={classList:{add:name=>endingClasses.add(name)}},otherEndingClasses=new Set(),otherEnding={classList:{add:name=>otherEndingClasses.add(name)}};
  const reduce={matches:reduced,addEventListener:(name,fn)=>{assert.equal(name,'change');changed=fn;}};
  vm.runInNewContext(script,{document:{documentElement:{classList:{contains:name=>name==='mobile-launch'?mobile:name==='desktop-launch'?desktop:false}},querySelector:selector=>selector==='.head-motion'?art:selector===(mobile?'.mobile-ending':'.desktop-ending')?ending:otherEnding},matchMedia:()=>reduce,parent:{postMessage:(message,origin)=>messages.push({message,origin})},location:{origin:'https://test.example'},queueMicrotask:fn=>microtasks.push(fn),setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimeout:key=>timers.delete(key)});
  const tick=ms=>{now+=ms;for(const [key,timer]of timers)if(timer.at<=now){timers.delete(key);timer.fn();}};
  return{art,messages,endingClasses,otherEndingClasses,tick,end:event=>end(event),change:event=>changed(event),flush:()=>microtasks.forEach(fn=>fn())};
}
test('desktop reveals its own ending after the root animation, then reports completion once',()=>{
  const p=morph();assert.equal(p.messages.length,0);
  p.end({target:p.art,animationName:'third'});p.end({target:{},animationName:'bounce'});assert.equal(p.messages.length,0);
  p.end({target:p.art,animationName:'bounce'});p.end({target:p.art,animationName:'bounce'});
  assert.equal(p.messages.length,0);assert.ok(p.endingClasses.has('is-visible'));assert.equal(p.otherEndingClasses.size,0);
  p.tick(1199);assert.equal(p.messages.length,0);p.tick(1);
  assert.equal(p.messages.length,1);assert.equal(p.messages[0].message.type,'collector-splash-animation-complete');assert.equal(p.messages[0].origin,'https://test.example');p.tick(1200);assert.equal(p.messages.length,1);
});
test('morph reduced-motion completes without waiting for an animationend, including preference changes',()=>{
  const initial=morph({reduced:true});initial.flush();assert.equal(initial.messages.length,1);
  const later=morph();later.change({matches:true});assert.equal(later.messages.length,1);
});
test('mobile shows the logo words only after animation completion, then holds the ending once',()=>{
  const p=morph({mobile:true});assert.equal(p.endingClasses.size,0);
  p.end({target:p.art,animationName:'f6'});assert.equal(p.endingClasses.size,0);
  p.end({target:p.art,animationName:'bounce'});assert.ok(p.endingClasses.has('is-visible'));assert.equal(p.messages.length,0);
  p.tick(600);p.end({target:p.art,animationName:'bounce'});p.tick(599);assert.equal(p.messages.length,0);
  p.tick(1);assert.equal(p.messages.length,1);p.tick(1200);assert.equal(p.messages.length,1);
});
test('mobile reduced motion skips the extra ending delay and cancels a pending hold',()=>{
  const initial=morph({mobile:true,reduced:true});initial.flush();assert.equal(initial.messages.length,1);
  const later=morph({mobile:true});later.end({target:later.art,animationName:'bounce'});later.change({matches:true});assert.equal(later.messages.length,1);later.tick(1200);assert.equal(later.messages.length,1);
});
test('mobile ending uses the local website logo font and retains the calibrated head geometry',()=>{
  const root=new URL('../dist/assets/splash/',import.meta.url),html=fs.readFileSync(new URL('lego-splash.html',root),'utf8');
  assert.ok(fs.statSync(new URL('barlow-condensed-latin-400.woff2',root)).size>1000);
  assert.ok(fs.readFileSync(new URL('OFL-Barlow-Condensed.txt',root),'utf8').includes('SIL OPEN FONT LICENSE'));
  assert.ok(html.includes('class="mobile-ending-top">Custom Minifigs</span>'));
  assert.ok(html.includes('class="mobile-ending-bottom">Collector</span>'));
  assert.ok(html.includes("'Barlow Condensed',sans-serif"));assert.ok(html.includes('.mobile-ending{display:none}'));
  assert.ok(html.includes('width:260.47387px;max-height:none;transform:translate(0,calc(.2650725px + .7svh))'));
  assert.ok(html.includes('<span class="desktop-ending-top">Custom Minifigs Collector</span>'));
  assert.ok(html.includes('<span class="desktop-ending-bottom">Collector</span>'));
  assert.ok(html.includes('.desktop-ending{display:none}'));
  assert.ok(html.includes('.desktop-launch .desktop-ending.is-visible .desktop-ending-top{opacity:1}'));
  assert.ok(html.includes('.desktop-launch .desktop-ending.is-visible .desktop-ending-bottom{opacity:1;transform:scale(1)}'));
});
function fusePreview({width=992.1,height=width,reduced=false}={}){
  const html=fs.readFileSync(new URL('../assets/splash/lego-splash.html',import.meta.url),'utf8');
  const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1];
  const path={style:{},ownerSVGElement:{viewBox:{baseVal:{width:992.1,height:992.1}},getBoundingClientRect:()=>({width,height})},getAttribute:()=> 'original-path',getTotalLength:()=>1000,getPointAtLength:distance=>({x:distance,y:42})};
  const spark={style:{},setAttribute(name,value){this[name]=value;}};
  const trail={style:{},setAttribute(name,value){this[name]=value;}},gradient={setAttribute(name,value){this[name]=value;}};
  let tick;
  vm.runInNewContext(script,{document:{getElementById:()=>({getBoundingClientRect:()=>({width}),querySelector:selector=>({'#fuse':path,'#spark':spark,'#fuseTrail':trail,'#fuseTrailGradient':gradient})[selector]})},cancelAnimationFrame(){},requestAnimationFrame:fn=>{tick=fn;return 1;},matchMedia:()=>({matches:reduced}),performance:{now:()=>0}});
  return{path,spark,trail,gradient,tick:now=>tick?.(now)};
}
test('supplied fuse and spark use the same measured progress and stop together',()=>{
  const p=fusePreview();p.tick(4464);assert.equal(p.path.style.strokeDashoffset,'500');assert.equal(p.spark.transform,'translate(500 42)');assert.equal(p.spark.style.opacity,'1');
  p.tick(4898);assert.equal(p.path.style.strokeDashoffset,'0');assert.equal(p.spark.style.opacity,'0');assert.equal(p.trail.style.opacity,'0');
  p.tick(5084);assert.equal(p.path.style.opacity,'0');
});
test('orange-to-black fuse trail follows the spark and grows up to 100 screen pixels at either stage size',()=>{
  for(const [width,height] of [[260.47387,260.47387],[660,660],[660,492]]){
    const p=fusePreview({width,height});p.tick(4800);
    const length=Number(p.trail.style.strokeDasharray.split(' ')[0]);
    assert.ok(Math.abs(length*Math.min(width,height)/992.1-100)<0.000001);
    assert.equal(p.trail.d,'original-path');assert.equal(p.trail.style.opacity,'1');
    const distance=(4800-4030)/868*1000;
    assert.equal(p.gradient.x2,distance);assert.equal(p.gradient.x1,distance-length);
    assert.equal(Number(p.trail.style.strokeDashoffset),-(distance-length));
  }
  const p=fusePreview();p.tick(4031);assert.ok(Number(p.trail.style.strokeDasharray.split(' ')[0])<100,'the trail cannot extend before the start of the path');
  const reduced=fusePreview({reduced:true});reduced.tick(4464);assert.equal(reduced.trail.style.opacity,'0');
});
