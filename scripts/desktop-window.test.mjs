import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../desktop-window.js',import.meta.url),'utf8');
function launch({platform='desktop',supported=true,visible=false}={}){
  const classes=new Set(),titlebar={hidden:true};let changed;
  const overlay={visible,addEventListener:(name,fn)=>{assert.equal(name,'geometrychange');changed=fn;}};
  vm.runInNewContext(source,{window:{collectorPwaPlatform:platform},navigator:supported?{windowControlsOverlay:overlay}:{},document:{getElementById:()=>titlebar,documentElement:{classList:{toggle:(name,active)=>active?classes.add(name):classes.delete(name)}}}});
  return{titlebar,classes,change:visible=>{overlay.visible=visible;changed?.();},listening:!!changed};
}
test('custom titlebar follows native overlay visibility, including maximize/fullscreen/toggle changes',()=>{
  const p=launch({visible:true});assert.equal(p.titlebar.hidden,false);assert.ok(p.classes.has('desktop-window-overlay'));
  p.change(false);assert.equal(p.titlebar.hidden,true);assert.equal(p.classes.size,0);
  p.change(true);assert.equal(p.titlebar.hidden,false);
});
test('ordinary tabs and unsupported browsers keep the normal layout',()=>{
  for(const options of [{visible:false},{supported:false}]){
    const p=launch(options);assert.equal(p.titlebar.hidden,true);assert.equal(p.classes.size,0);
  }
});
test('mobile does not activate or subscribe to the desktop titlebar',()=>{
  const p=launch({platform:'mobile',visible:true});assert.equal(p.titlebar.hidden,true);assert.equal(p.listening,false);assert.equal(p.classes.size,0);
});
test('production injects custom titlebar only into the desktop entry and preserves mobile manifest',()=>{
  const root=new URL('../dist/',import.meta.url);
  const desktop=fs.readFileSync(new URL('desktop/index.html',root),'utf8');
  assert.ok(desktop.includes('id="desktopWindowTitlebar"'));assert.ok(desktop.includes('/desktop-window.css'));assert.ok(desktop.includes('/desktop-window.js'));
  assert.ok(desktop.includes('<img src="/lego-head.svg?v=3#outline" alt="">'));
  for(const page of ['index.html','mobile/index.html']){
    const html=fs.readFileSync(new URL(page,root),'utf8');assert.ok(!html.includes('desktopWindowTitlebar'));assert.ok(!html.includes('desktop-window.js'));
  }
  const desktopManifest=JSON.parse(fs.readFileSync(new URL('manifest-desktop.webmanifest',root),'utf8'));
  assert.deepEqual(desktopManifest.display_override,['window-controls-overlay']);assert.equal(desktopManifest.display,'standalone');
  const mobileManifest=JSON.parse(fs.readFileSync(new URL('manifest-mobile.webmanifest',root),'utf8'));
  assert.equal(mobileManifest.display_override,undefined);assert.equal(mobileManifest.name,'Collector');
});
