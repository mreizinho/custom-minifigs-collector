import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),context=vm.createContext({URL,encodeURIComponent});
vm.runInContext(source.slice(source.indexOf('function bricklinkCatalogueUrl('),source.indexOf('function render(){')),context);
test('links the actual figure reference from BrickLink image URLs',()=>{
 assert.equal(context.bricklinkCatalogueUrl('https://img.bricklink.com/ML/sw0001a.jpg'),'https://www.bricklink.com/v2/catalog/catalogitem.page?M=sw0001a');
 assert.equal(context.bricklinkCatalogueUrl('https://img.bricklink.com/ItemImage/MN/0/sw0687.t1.png?cache=1'),'https://www.bricklink.com/v2/catalog/catalogitem.page?M=sw0687');
});
test('uploaded and unrelated images never get a BrickLink link',()=>{
 for(const url of ['', 'https://drive.google.com/file/d/example/view','https://example.com/sw0687.jpg','https://img.bricklink.com.evil.example/ML/sw0687.jpg','javascript:alert(1)'])assert.equal(context.bricklinkCatalogueUrl(url),'');
});
