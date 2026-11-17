import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const mobilePinchZoomStates='),app.indexOf('function clearMobileImageZoom('));
function zoom(){
  const properties=new Map(),listeners=new Map();
  const pane={clientWidth:390,clientHeight:844,dataset:{},style:{setProperty:(key,value)=>properties.set(key,value)},addEventListener:(type,handler)=>listeners.set(type,handler),setPointerCapture(){}};
  const context={AbortController,Math,Map,WeakMap,Date,pane};vm.createContext(context);vm.runInContext(source+'\nenableMobilePinchZoom(pane);',context);
  const event=(id,x,y)=>({pointerType:'touch',pointerId:id,clientX:x,clientY:y,target:{closest:()=>true},preventDefault(){}});
  return{properties,pane,down:(id,x,y)=>listeners.get('pointerdown')(event(id,x,y)),move:(id,x,y)=>listeners.get('pointermove')(event(id,x,y)),up:(id,x,y)=>listeners.get('pointerup')(event(id,x,y))};
}
test('mobile fullscreen starts fitted, centered, and without a previous pan offset',()=>{
  const {properties}=zoom();
  assert.equal(properties.get('--mobile-photo-scale'),'1.000');
  assert.equal(properties.get('--mobile-photo-x'),'0.0px');
  assert.equal(properties.get('--mobile-photo-y'),'0.0px');
});
test('pinch zoom remains available and drag offsets stay bounded',()=>{
  const state=zoom();state.down(1,100,200);state.down(2,200,200);state.move(2,300,200);
  assert.equal(state.properties.get('--mobile-photo-scale'),'2.000');
  state.up(2,300,200);state.up(1,100,200);state.down(3,100,100);state.move(3,10000,10000);
  assert.equal(state.properties.get('--mobile-photo-x'),'195.0px');
  assert.equal(state.properties.get('--mobile-photo-y'),'422.0px');
});
