import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').split(/\r?\n/).find(line=>line.startsWith('const secretSearchTooltip='));
function menu({visible=true,keyword='anim'}={}){
  const listeners=new Map(),events=[];
  const search={value:'Luke',focusCount:0,focus(){this.focusCount++;},dispatchEvent:event=>events.push(event.type)};
  const option={dataset:{secretSearch:keyword},getClientRects:()=>visible?[{}]:[]};
  const tooltip={querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn)};
  vm.runInNewContext(source,{ $:selector=>selector==='#search'?search:tooltip,Event:class{constructor(type){this.type=type;}} });
  const click=(target=option)=>listeners.get('click')({target:{closest:()=>target},preventDefault(){},stopPropagation(){}});
  return{search,events,click};
}
test('hidden shortcut buttons cannot change the search term or run filtering',()=>{
  const p=menu({visible:false});p.click();assert.equal(p.search.value,'Luke');assert.equal(p.events.length,0);assert.equal(p.search.focusCount,0);
});
test('choosing an actual visible shortcut still filters and focuses the search',()=>{
  for(const keyword of ['anim','nophoto','nostatus','preorder']){
    const p=menu({keyword});p.click();assert.equal(p.search.value,keyword);assert.deepEqual(p.events,['input']);assert.equal(p.search.focusCount,1);
  }
});
test('clicking the shortcut heading does not change search',()=>{
  const p=menu();p.click(null);assert.equal(p.search.value,'Luke');assert.equal(p.events.length,0);
});
test('every production search label explicitly targets the search input rather than its hidden menu buttons',()=>{
  for(const file of ['index.html','desktop/index.html','mobile/index.html']){
    const html=fs.readFileSync(new URL('../dist/'+file,import.meta.url),'utf8');
    const label=html.match(/<label\b[^>]*class="search"[^>]*>/)?.[0];
    assert.ok(label?.includes('for="search"'));assert.match(html,/<input id="search" type="search"/);
  }
});
