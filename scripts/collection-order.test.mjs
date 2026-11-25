import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function mergeCollectionMenuOrder('),source.indexOf('function orderedCollectionMenuNames(')),context);
const plain=value=>JSON.parse(JSON.stringify(value));
test('saved menu order ignores deleted names and includes new collections once',()=>{
 assert.deepEqual(plain(context.mergeCollectionMenuOrder(['Star Wars','Military','LEGO Star Wars','New'],['LEGO Star Wars','Deleted','Military','Military'])),['LEGO Star Wars','Military','Star Wars','New']);
});
test('dragging the first collection changes menu order without changing ID-defining source order',()=>{
 const source=['Star Wars','Military','Misc'];
 assert.deepEqual(plain(context.moveCollectionMenuName(source,'Star Wars','Military',true)),['Military','Star Wars','Misc']);
 assert.deepEqual(source,['Star Wars','Military','Misc']);
});
test('supports upward drops and ignores invalid or self drops',()=>{
 const names=['A','B','C'];
 assert.deepEqual(plain(context.moveCollectionMenuName(names,'C','A')),['C','A','B']);
 assert.deepEqual(plain(context.moveCollectionMenuName(names,'C','C')),names);
 assert.deepEqual(plain(context.moveCollectionMenuName(names,'Missing','B')),names);
});
test('PWA number shortcuts follow the visible collection order and ignore unavailable slots',()=>{
 const selected=[];
 let installed=true,modal=false;
 const shortcut=vm.createContext({
   window:{matchMedia:()=>({matches:installed})},navigator:{},
   document:{documentElement:{classList:{contains:()=>false}},querySelector:()=>modal},
   orderedCollectionMenuNames:()=>['Military','Star Wars','Brickset'],
   selectCollection:name=>selected.push(name)
 });
 vm.runInContext(source.slice(source.indexOf('function handleCollectionNumberShortcut('),source.indexOf("document.addEventListener('keydown',handleCollectionNumberShortcut)")),shortcut);
 const press=(key,overrides={})=>{
   const event={key,ctrlKey:true,preventDefault(){this.defaultPrevented=true;},...overrides};
   shortcut.handleCollectionNumberShortcut(event);
   return Boolean(event.defaultPrevented);
 };
 assert.equal(press('1'),true);
 assert.equal(press('3'),true);
 assert.equal(press('9'),false);
 assert.equal(press('2',{altKey:true}),false);
 assert.equal(press('2',{repeat:true}),true);
 modal=true;assert.equal(press('2'),false);
 modal=false;installed=false;assert.equal(press('2'),false);
 assert.deepEqual(selected,['Military','Brickset']);
});
