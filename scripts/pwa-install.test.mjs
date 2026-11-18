import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../pwa-install.js',import.meta.url),'utf8');
function select(pathname,ua,touch=0){
  const manifest={},window={},root={dataset:{}};
  vm.runInNewContext(source,{window,location:{pathname},navigator:{userAgent:ua,maxTouchPoints:touch},document:{documentElement:root,querySelector:selector=>selector.includes('apple-touch')?{}:manifest,querySelectorAll:()=>[]}});
  return{platform:window.collectorPwaPlatform,manifest:manifest.href};
}
test('root selects installation metadata by device, not window width',()=>{
  assert.deepEqual(select('/','Android'),{platform:'mobile',manifest:'/manifest-mobile.webmanifest'});
  assert.equal(select('/','Windows NT').platform,'desktop');
  assert.equal(select('/','Macintosh',5).platform,'mobile');
});
test('explicit install routes retain their identity on either device',()=>{
  assert.equal(select('/desktop/','Android').platform,'desktop');
  assert.equal(select('/mobile/index.html','Windows NT').platform,'mobile');
});
test('desktop restores the outline tab icon after parsing; mobile keeps its existing favicon',()=>{
  for(const platform of ['desktop','mobile']){
    const svg={type:'image/svg+xml',href:'/icons/splash2.svg'},png={type:'image/png',remove(){this.removed=true;}};
    const manifest={},apple={};let parsed;
    vm.runInNewContext(source,{window:{},location:{pathname:`/${platform}/`},navigator:{userAgent:'Windows NT'},document:{readyState:'loading',documentElement:{dataset:{}},querySelector:selector=>selector.includes('apple-touch')?apple:manifest,querySelectorAll:()=>[png,svg],addEventListener:(name,callback)=>{assert.equal(name,'DOMContentLoaded');parsed=callback;}}});
    assert.equal(svg.href,'/icons/splash2.svg');parsed();
    assert.equal(svg.href,platform==='desktop'?'/lego-head.svg?v=3#favicon-outline':'/icons/splash2.svg');
    assert.equal(!!png.removed,platform==='desktop');
  }
});
