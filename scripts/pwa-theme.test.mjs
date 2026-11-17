import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../pwa-theme.js',import.meta.url),'utf8');
function page({saved='light',mobile=true,android=false,standalone=false}={}){
  const events=new Map(),observed=[],meta={},scheme={};let mutation;
  const classes=new Set(),viewport={content:'width=device-width,initial-scale=1'};
  const root={style:{setProperty(key,value){this[key]=value;}},dark:false,classList:{contains:()=>root.dark,add:name=>classes.add(name)}},body={dark:false,classList:{contains:()=>body.dark}};
  const context={document:{documentElement:root,body,readyState:'loading',querySelector:selector=>selector.includes('viewport')?viewport:selector.includes('theme-color')?meta:scheme,addEventListener:(name,handler)=>events.set(name,handler)},
    window:{navigator:{userAgent:android?'Android':'Desktop'},matchMedia:query=>({matches:query.includes('display-mode')?standalone:mobile}),addEventListener:(name,handler)=>events.set(name,handler)},localStorage:{getItem:key=>key===`minifig-theme-${mobile?'mobile':'desktop'}-anonymous`?saved:null},
    getComputedStyle:()=>({getPropertyValue:()=>body.dark||root.dark?'#181917':'#e6e7e4'}),MutationObserver:class{constructor(callback){mutation=callback;}observe(element){observed.push(element);}}};
  vm.createContext(context);vm.runInContext(source,context);
  return{root,body,meta,scheme,viewport,classes,events,observed,changed:()=>mutation()};
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
test('edge-to-edge is enabled only for installed Android apps and follows the selected canvas color',()=>{
  const app=page({android:true,standalone:true,saved:'dark'});
  assert.match(app.viewport.content,/viewport-fit=cover/);
  assert.ok(app.classes.has('pwa-edge-to-edge'));
  assert.equal(app.root.style['--pwa-chrome-bg'],'#181917');
  for(const options of [{android:true},{standalone:true},{}]){
    const other=page(options);
    assert.doesNotMatch(other.viewport.content,/viewport-fit/);
    assert.equal(other.classes.size,0);
  }
});
