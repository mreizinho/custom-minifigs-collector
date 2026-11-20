import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../desktop-window.js',import.meta.url),'utf8');
function launch({platform='desktop',supported=true,visible=false,installed=false,focused=false}={}){
  const classes=new Set(),titlebar={hidden:true},windowEvents=new Map();let changed;
  const overlay={visible,addEventListener:(name,fn)=>{assert.equal(name,'geometrychange');changed=fn;}};
  vm.runInNewContext(source,{window:{collectorPwaPlatform:platform,matchMedia:()=>({matches:installed}),addEventListener:(name,fn)=>windowEvents.set(name,fn)},navigator:supported?{windowControlsOverlay:overlay}:{},document:{hasFocus:()=>focused,getElementById:()=>titlebar,documentElement:{classList:{toggle:(name,active)=>active?classes.add(name):classes.delete(name)}}}});
  return{titlebar,classes,focus:value=>{focused=value;windowEvents.get(value?'focus':'blur')?.();},change:visible=>{overlay.visible=visible;changed?.();},listening:!!changed};
}
test('custom titlebar follows native overlay visibility, including maximize/fullscreen/toggle changes',()=>{
  const p=launch({visible:true});assert.equal(p.titlebar.hidden,false);assert.ok(p.classes.has('desktop-window-overlay'));
  p.change(false);assert.equal(p.titlebar.hidden,true);assert.equal(p.classes.size,0);
  p.change(true);assert.equal(p.titlebar.hidden,false);
});
test('the installed desktop outline follows window focus with or without the native overlay',()=>{
  for (const supported of [true,false]) {
    const p=launch({installed:true,focused:true,supported});
    assert.ok(p.classes.has('desktop-window-active'));
    p.focus(false);assert.equal(p.classes.has('desktop-window-active'),false);
    p.focus(true);assert.ok(p.classes.has('desktop-window-active'));
  }
  const tab=launch({focused:true});tab.focus(true);
  assert.equal(tab.classes.has('desktop-window-active'),false);
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
