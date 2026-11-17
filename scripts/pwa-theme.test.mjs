import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../pwa-theme.js',import.meta.url),'utf8');
function page({saved='light',mobile=true}={}){
  const events=new Map(),observed=[],meta={},scheme={};let mutation;
  const root={style:{},dark:false,classList:{contains:()=>root.dark}},body={dark:false,classList:{contains:()=>body.dark}};
  const context={document:{documentElement:root,body,readyState:'loading',querySelector:selector=>selector.includes('theme-color')?meta:scheme,addEventListener:(name,handler)=>events.set(name,handler)},
    window:{matchMedia:()=>({matches:mobile}),addEventListener:(name,handler)=>events.set(name,handler)},localStorage:{getItem:key=>key===`minifig-theme-${mobile?'mobile':'desktop'}-anonymous`?saved:null},
    getComputedStyle:()=>({getPropertyValue:()=>body.dark||root.dark?'#181917':'#e6e7e4'}),MutationObserver:class{constructor(callback){mutation=callback;}observe(element){observed.push(element);}}};
  vm.createContext(context);vm.runInContext(source,context);
  return{root,body,meta,scheme,events,observed,changed:()=>mutation()};
}
test('restores PWA bar colors from the saved device theme before the page renders',()=>{
  const p=page({saved:'dark'});assert.equal(p.meta.content,'#181917');assert.equal(p.scheme.content,'dark');assert.equal(p.root.style.colorScheme,'dark');
});
test('website theme switches update browser color and root color scheme in both directions',()=>{
  const p=page();p.events.get('DOMContentLoaded')();
  p.body.dark=true;p.changed();assert.equal(p.meta.content,'#181917');assert.equal(p.root.style.colorScheme,'dark');
  p.body.dark=false;p.changed();assert.equal(p.meta.content,'#e6e7e4');assert.equal(p.scheme.content,'light');assert.equal(p.root.style.backgroundColor,'#e6e7e4');
  assert.equal(p.observed.length,2);
});
test('privacy-page root theme and returning to the app also refresh system colors',()=>{
  const p=page();p.root.dark=true;p.events.get('DOMContentLoaded')();assert.equal(p.meta.content,'#181917');
  p.root.dark=false;p.events.get('pageshow')();assert.equal(p.meta.content,'#e6e7e4');
});
