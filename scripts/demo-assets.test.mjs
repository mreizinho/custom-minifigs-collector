import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('all demo photos are local assets included in the production build',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'demo-catalogue.js'),'utf8'),context);
 assert.equal(context.window.DEMO_CATALOGUE.length,12);
 for(const figure of context.window.DEMO_CATALOGUE)for(const field of ['Photo URL','ALT Photo URL']){
  const url=figure[field];assert.match(url,/^assets\/demo\/star-wars\/[0-9]+-(main|alt)\.png$/);
  const source=fs.readFileSync(path.join(root,url)),built=fs.readFileSync(path.join(root,'dist',url));
  assert.ok(source.length>0);assert.ok(source.equals(built));
 }
});
