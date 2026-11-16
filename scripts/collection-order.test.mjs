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
