import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../pwa-install.js',import.meta.url),'utf8');
function select(pathname,ua,touch=0){
  const manifest={},window={},root={dataset:{}};
  vm.runInNewContext(source,{window,location:{pathname},navigator:{userAgent:ua,maxTouchPoints:touch},document:{documentElement:root,querySelector:()=>manifest}});
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
