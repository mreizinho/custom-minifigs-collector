import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function collectionRenameError('),source.indexOf('function updateRenamedCollectionLocally('));
function fixture({fail=false,names=['Star Wars','Military']}={}){
 const calls=[];
 const context={SECRET_DEMO_MODE:false,window:{collectorFirebaseUser:'user'},SHEET_ID:'sheet',PHOTO_FOLDER_REGISTRY_SHEET:'_CollectorPhotoFolders',restoreSheetsAccess:async()=>{},clean:v=>String(v??'').trim(),sheetsRequest:async(url,options)=>{
  calls.push({url,options});
  if(options){if(fail)throw Error('Save failed');return{json:async()=>({})}}
  if(url.includes('/values/'))return{json:async()=>({values:[['Star Wars'],['Military']]})};
  return{json:async()=>({sheets:[...names.map((title,sheetId)=>({properties:{title,sheetId}})),{properties:{title:'_CollectorPhotoFolders',sheetId:9,gridProperties:{rowCount:100}}}]})};
 }};
 vm.createContext(context);vm.runInContext(code,context);return{context,calls};
}
test('renames sheet title and folder mapping in one batch',async()=>{
 const {context,calls}=fixture();await context.renameCollectionSheet('Star Wars','LEGO');
 const writes=calls.filter(c=>c.options);assert.equal(writes.length,1);
 const requests=JSON.parse(writes[0].options.body).requests;
 assert.equal(requests[0].updateSheetProperties.properties.title,'LEGO');
 assert.equal(requests[1].updateCells.rows[0].values[0].userEnteredValue.stringValue,'LEGO');
 assert.equal(requests[1].updateCells.range.startRowIndex,1);
});
test('rejects duplicate and invalid names without writing',async()=>{
 const {context,calls}=fixture();
 for(const name of ['military','Bad/Name','_Internal',''])await assert.rejects(context.renameCollectionSheet('Star Wars',name));
 assert.equal(calls.filter(c=>c.options).length,0);
});
test('propagates a failed write so local settings are not migrated',async()=>{
 const {context}=fixture({fail:true});await assert.rejects(context.renameCollectionSheet('Star Wars','LEGO'),/Save failed/);
});
test('migrates only the renamed collection ID prefix and keeps primary IDs intact',()=>{
 const {context}=fixture();
 assert.equal(context.renamedFigureKey('Military::12','Military','Army',false),'Army::12');
 assert.equal(context.renamedFigureKey('Misc::12','Military','Army',false),'Misc::12');
 assert.equal(context.renamedFigureKey('12','Star Wars','LEGO',true),'12');
});
