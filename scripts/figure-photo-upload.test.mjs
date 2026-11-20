import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('photo uploads use fresh Drive IDs and the matching row when the ID column is in the middle',async()=>{
  const calls=[];
  const headers=['Name','Photo URL','ID','ALT Photo URL'];
  const rows=[headers,['Other','old-file','24'],['Selected','old-file','8','old-alt']];
  const context={
    activeCollection:'Star Wars',SHEET_ID:'sheet',window:{collectorFirebaseUser:'user'},
    clean:value=>String(value??'').trim(),figureNumber:figure=>figure.raw.ID,
    photoAsPng:async file=>file,collectionPhotoFolder:async()=> 'folder',
    canonicalDrivePhotoUrl:(_,id)=>`https://drive.google.com/file/d/${id}/view`,
    deleteDriveFile:async()=>assert.fail('Successful uploads must not delete files'),
    sheetsRequest:async(url,options={})=>{
      calls.push({url,method:options.method,body:options.body});
      return {json:async()=>options.method==='POST'?{id:`new-${calls.length}`}:{values:rows}};
    }
  };
  vm.createContext(context);
  vm.runInContext([
    extract('function normalizedHeader(','function nextSequentialFigureId('),
    extract('async function uploadFigurePhoto(','async function appendFigureToActiveSheet('),
    extract('async function saveFigurePhotoTarget(','function uploadFigurePhotoTarget(')
  ].join('\n'),context);
  const figure={raw:{ID:'8'},sheetRow:2,image:'old-file',altImage:'old-alt'};
  for(const [target,filename,column] of [['primary','8.png','B'],['alternate','8b.png','D']]){
    const before=calls.length;
    const uploaded=await context.uploadFigurePhoto('png',figure,target);
    await context.saveFigurePhotoTarget(figure,uploaded.url,target);
    const writes=calls.slice(before).filter(call=>call.method);
    assert.deepEqual(writes.map(call=>call.method),['POST','PATCH','PUT']);
    assert.equal(JSON.parse(writes[0].body).name,filename);
    assert.ok(writes[1].url.includes(`/files/${uploaded.fileId}?`));
    assert.ok(decodeURIComponent(writes[2].url).includes(`'Star Wars'!${column}3?`));
  }
});
