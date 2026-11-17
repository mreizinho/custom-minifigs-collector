import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../pwa-splash.js',import.meta.url),'utf8');
function launch({installed=true,reduced=false}={}) {
  let now=0,id=0;
  const timers=new Map(),listeners=new Map(),events=[],classes=new Set();
  const layerClasses=new Set(),frame={dataset:{src:'/assets/splash/lego-splash.html'},contentWindow:{},addEventListener(){}};
  const layer={hidden:true,tagName:'DIV',classList:{add:name=>layerClasses.add(name)},querySelector:()=>frame,setAttribute(){},remove(){this.removed=true;}};
  const main={tagName:'MAIN',inert:false},dialog={tagName:'DIALOG',inert:true};
  const document={documentElement:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},body:{children:[layer,main,dialog]},getElementById:()=>layer,addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>events.push(event.type)};
  const window={navigator:{},matchMedia:query=>({matches:query.includes('reduced')?reduced:query.includes('standalone')&&installed}),addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const context={window,document,location:{origin:'https://test.example',search:''},URLSearchParams,CustomEvent:class{constructor(type){this.type=type;}},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,context);
  const tick=ms=>{const target=now+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at).find(([,timer])=>timer.at<=target);if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=target;};
  const message=(overrides={})=>listeners.get('message')?.({origin:context.location.origin,source:frame.contentWindow,data:{type:'collector-splash-animation-complete'},...overrides});
  return{window,layer,frame,classes,layerClasses,main,dialog,events,listeners,tick,message};
}
test('normal browser visits do not load or show the animation',()=>{
  const p=launch({installed:false});assert.equal(p.window.collectorSplash,undefined);assert.equal(p.frame.src,undefined);assert.equal(p.classes.size,0);
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
  const p=launch();p.window.collectorSplash.mount();p.listeners.get('DOMContentLoaded')();p.tick(8000);
  assert.equal(p.main.inert,false);assert.equal(p.classes.size,0);p.tick(320);assert.ok(p.layer.removed);
});
test('reduced motion dismisses without an animated fade',()=>{
  const p=launch({reduced:true});p.window.collectorSplash.mount();p.window.collectorSplash.ready();p.message();p.tick(0);assert.ok(p.layer.removed);
});
test('onboarding is an actionable ready state; no pageshow/visibility replay handlers',()=>{
  const p=launch();p.window.collectorSplash.mount();p.message();p.listeners.get('collector-onboarding-needed')();assert.equal(p.events.length,1);
  assert.equal(p.listeners.has('pageshow'),false);assert.equal(p.listeners.has('visibilitychange'),false);
});
test('production build ships the isolated supplied animation and splash resources',()=>{
  const root=new URL('../dist/',import.meta.url),html=fs.readFileSync(new URL('index.html',root),'utf8');
  for(const file of ['pwa-splash.js','pwa-splash.css','assets/splash/lego-splash.html','assets/splash/head1.svg','assets/splash/head2.svg','assets/splash/head3.svg'])assert.ok(fs.statSync(new URL(file,root)).size>0);
  assert.match(html,/window\.collectorSplash\?\.mount\(\)/);
  const art=fs.readFileSync(new URL('assets/splash/lego-splash.html',root),'utf8');
  assert.ok(!art.includes('id="replay"'));assert.match(art,/prefers-reduced-motion:reduce/);
  assert.match(art,/head-motion 3\.4s/);
  assert.match(art,/show-eyes\{0%,30%\{opacity:0\}43%,100%\{opacity:1\}/);
  assert.match(art,/show-two\{0%,30%\{opacity:0\}43%,63%\{opacity:1\}/);
  assert.ok(!art.includes('<div class="controls">'));
});
function morph({reduced=false}={}) {
  const html=fs.readFileSync(new URL('../assets/splash/lego-splash.html',import.meta.url),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const messages=[],microtasks=[];let end,changed;
  const art={addEventListener:(name,fn)=>{assert.equal(name,'animationend');end=fn;}};
  const reduce={matches:reduced,addEventListener:(name,fn)=>{assert.equal(name,'change');changed=fn;}};
  vm.runInNewContext(script,{document:{querySelector:()=>art},matchMedia:()=>reduce,parent:{postMessage:(message,origin)=>messages.push({message,origin})},location:{origin:'https://test.example'},queueMicrotask:fn=>microtasks.push(fn)});
  return{art,messages,end:event=>end(event),change:event=>changed(event),flush:()=>microtasks.forEach(fn=>fn())};
}
test('morph reports completion once, only when its root head-motion animation finishes',()=>{
  const p=morph();assert.equal(p.messages.length,0);
  p.end({target:p.art,animationName:'show-eyes'});p.end({target:{},animationName:'head-motion'});assert.equal(p.messages.length,0);
  p.end({target:p.art,animationName:'head-motion'});p.end({target:p.art,animationName:'head-motion'});
  assert.equal(p.messages.length,1);assert.equal(p.messages[0].message.type,'collector-splash-animation-complete');assert.equal(p.messages[0].origin,'https://test.example');
});
test('morph reduced-motion completes without waiting for an animationend, including preference changes',()=>{
  const initial=morph({reduced:true});initial.flush();assert.equal(initial.messages.length,1);
  const later=morph();later.change({matches:true});assert.equal(later.messages.length,1);
});
