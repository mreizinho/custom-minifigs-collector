import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../desktop-modal-chrome.js',import.meta.url),'utf8');
function page({platform='desktop',installed=true}={}){
  const classes=new Set(),events=new Map(),observed=[];
  const root={style:{backgroundColor:'rgb(230, 231, 228)',setProperty(key,value){this[key]=value;}},classList:{add:name=>classes.add(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  const body={tagName:'BODY',backgroundColor:'rgb(230, 231, 228)',themeBackground:'',getPropertyValue(){return this.themeBackground;}},header={borderBottomColor:'rgb(209, 210, 207)',scrolled:false,classList:{contains:()=>header.scrolled}},theme={content:'#e6e7e4'};
  let open=[],changed,reads=0;
  vm.runInNewContext(source,{window:{collectorPwaPlatform:platform,matchMedia:()=>({matches:installed}),addEventListener:(name,fn)=>events.set(name,fn)},document:{documentElement:root,body,querySelector:selector=>selector.includes('theme-color')?theme:header,querySelectorAll:()=>open},getComputedStyle:node=>{reads++;return node;},MutationObserver:class{constructor(fn){changed=fn;}observe(...args){observed.push(args);}}});
  return{root,body,header,theme,classes,observed,events,reads:()=>reads,setOpen:dialogs=>{open=dialogs;changed([{type:'attributes',target:dialogs[0]||body}]);},notify:records=>changed(records)};
}
const dialog=color=>({tagName:'DIALOG',backgroundColor:color});
test('desktop modal blends actual backdrop into scrollbar and native theme hint, then restores',()=>{
  const p=page();p.setOpen([dialog('rgba(32, 33, 30, 0.5)')]);
  assert.equal(p.theme.content,'rgb(131, 132, 129)');assert.equal(p.root.style.backgroundColor,p.theme.content);
  assert.equal(p.root.style['--desktop-scrollbar-thumb'],'rgb(84, 85, 83)');
  assert.equal(p.root.style['--desktop-modal-gutter-line'],'rgb(121, 122, 119)');
  assert.ok(p.classes.has('desktop-modal-dimmed'));assert.equal(p.body.backgroundColor,'rgb(230, 231, 228)');
  p.setOpen([]);assert.equal(p.theme.content,'rgb(230, 231, 228)');assert.equal(p.classes.has('desktop-modal-dimmed'),false);assert.equal(p.root.style['--desktop-scrollbar-thumb'],'rgb(136, 136, 136)');
});
test('nested modal backdrops compose and closing one retains the remaining dimming',()=>{
  const p=page(),first=dialog('rgba(0, 0, 0, 0.5)'),second=dialog('rgba(0, 0, 0, 0.5)');
  p.setOpen([first]);p.setOpen([second,first]);assert.equal(p.theme.content,'rgb(58, 58, 57)');
  p.setOpen([first]);assert.equal(p.theme.content,'rgb(115, 116, 114)');assert.ok(p.classes.has('desktop-modal-dimmed'));
});
test('theme changes while a popup is open restore the current theme, not a stale saved color',()=>{
  const p=page();p.setOpen([dialog('rgba(0, 0, 0, 0.5)')]);
  p.body.backgroundColor='rgb(24, 25, 23)';p.notify([{type:'attributes',target:p.body}]);assert.equal(p.theme.content,'rgb(12, 13, 12)');
  p.setOpen([]);assert.equal(p.theme.content,'rgb(24, 25, 23)');assert.equal(p.root.style.backgroundColor,p.theme.content);
});
test('theme switches use the target color while the body is still transitioning',()=>{
  const p=page();
  p.body.themeBackground='#181917';
  p.notify([{type:'attributes',target:p.body}]);
  assert.equal(p.theme.content,'rgb(24, 25, 23)');
  assert.equal(p.root.style['--desktop-scrollbar-background'],p.theme.content);
  p.setOpen([dialog('rgba(0, 0, 0, 0.5)')]);
  assert.equal(p.theme.content,'rgb(12, 13, 12)');
  p.body.backgroundColor='rgb(24, 25, 23)';
  p.body.themeBackground='#e6e7e4';
  p.notify([{type:'attributes',target:p.body}]);
  assert.equal(p.theme.content,'rgb(115, 116, 114)');
  p.setOpen([]);
  assert.equal(p.theme.content,'rgb(230, 231, 228)');
  assert.equal(p.root.style['--desktop-scrollbar-background'],p.theme.content);
});
test('transparent dialogs do not dim chrome and catalogue mutations do not recompute styles',()=>{
  const p=page();p.setOpen([dialog('rgba(0, 0, 0, 0)')]);assert.equal(p.classes.has('desktop-modal-dimmed'),false);
  const reads=p.reads();p.notify([{type:'attributes',target:{tagName:'SPAN'}},{type:'childList',removedNodes:[{nodeType:1,tagName:'ARTICLE',querySelector:()=>null}]}]);assert.equal(p.reads(),reads);
});
test('mobile does not activate desktop scrollbar styling or register observers',()=>{
  const p=page({platform:'mobile'});assert.equal(p.theme.content,'#e6e7e4');assert.equal(p.observed.length,0);assert.equal(p.reads(),0);assert.equal(p.classes.size,0);
});
test('browser tabs share PWA scrollbar themes and dimming without changing browser theme hints',()=>{
  const p=page({installed:false});assert.ok(p.classes.has('desktop-scrollbars'));
  p.body.themeBackground='#181917';p.notify([{type:'attributes',target:p.body}]);
  assert.equal(p.root.style['--desktop-scrollbar-background'],'rgb(24, 25, 23)');
  p.setOpen([dialog('rgba(0, 0, 0, 0.5)')]);assert.equal(p.root.style['--desktop-scrollbar-background'],'rgb(12, 13, 12)');
  p.setOpen([]);assert.equal(p.root.style['--desktop-scrollbar-background'],'rgb(24, 25, 23)');assert.equal(p.theme.content,'#e6e7e4');
});
test('scrolling invalidates the scrollbar shadow and returning to the top clears it',()=>{
  const p=page({installed:false});assert.equal(p.root.style['--desktop-gutter-shadow'],'transparent');
  p.header.scrolled=true;p.notify([{type:'attributes',target:p.header}]);assert.equal(p.root.style['--desktop-gutter-shadow'],'#00000018');
  p.header.scrolled=false;p.notify([{type:'attributes',target:p.header}]);assert.equal(p.root.style['--desktop-gutter-shadow'],'transparent');
});
test('production shares desktop scrollbar resources across entry points with mobile runtime gating',()=>{
  const dist=new URL('../dist/',import.meta.url);
  for(const file of ['index.html','desktop/index.html','mobile/index.html']){
    const html=fs.readFileSync(new URL(file,dist),'utf8');
    assert.equal((html.match(/src="\/desktop-modal-chrome.js/g)||[]).length,1);
    assert.ok(html.includes('/desktop-scrollbars.css'));
  }
  const css=fs.readFileSync(new URL('desktop-scrollbars.css',dist),'utf8');
  assert.match(css,/@media \(min-width:601px\), \(display-mode:standalone\)/);
  assert.match(css,/html.desktop-scrollbars::-webkit-scrollbar-track:vertical \{ margin-top:var\(--desktop-header-bottom\)/);
});
