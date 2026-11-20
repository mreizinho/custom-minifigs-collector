import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function fixture({fail=false,photos=false,shared=false}={}){
  const rows=[['#','Name','Hidden'],['1','Visible',''],['3','Target',''],['-1','Hidden','TRUE'],['-3','Hidden too','TRUE']];
  const names=new Map([['primary','3.png'],['alternate','3b.png']]);
  if(photos){
    rows[0].push('Photo URL','ALT Photo URL');
    rows[2].push('drive:primary','drive:alternate');
    if(shared)rows[1].push('drive:primary');
  }
  const figure={id:'Other::3',raw:{'#':'3'},sheetRow:3};
  const context={SECRET_DEMO_MODE:false,window:{collectorFirebaseUser:'user'},activeCollection:'Other',COLLECTIONS:['First','Other'],SHEET_ID:'sheet',clean:v=>String(v??'').trim(),figureNumber:f=>f.raw['#'],resolveFigureSheetRow:async()=>{},restoreSheetsAccess:async()=>{},selected:new Set([figure.id]),wished:new Set(),removedOwned:new Set(),removedWished:new Set(),customTagsByFigure:{[figure.id]:['tag']},persist(){},persistCustomTags(){},
    drivePhotoId:value=>String(value??'').match(/^drive:(\w+)$/)?.[1]||'',
    sheetsRequest:async(url,options)=>{
      const fileId=url.match(/drive\/v3\/files\/(\w+)/)?.[1];
      if(fileId){
        if(options)names.set(fileId,JSON.parse(options.body).name);
        return{json:async()=>({name:names.get(fileId),mimeType:'image/png'})};
      }
      if(!options)return{json:async()=>({values:rows})};
      if(fail)throw Error('Write failed');
      assert.ok(url.endsWith('/values:batchUpdate'));
      const {data}=JSON.parse(options.body);
      for(const item of data){const [,col,row]=item.range.match(/!([A-Z]+)(\d+)$/);rows[Number(row)-1][col.charCodeAt(0)-65]=item.values[0][0]}
      return{json:async()=>({})};
    }};
  vm.createContext(context);
  vm.runInContext(extract('function normalizedHeader(','function loadImageFile(')+extract('async function renamePhotosForFigureId(','async function toggleFigureHidden('),context);
  return{context,figure,rows,names};
}
test('hide, unhide, and hide again reuse gaps and preserve figure preferences',async()=>{
  const {context:c,figure:f,rows}=fixture();
  await c.updateFigureHiddenInSheet(f,true);
  assert.equal(f.raw['#'],'-2');assert.equal(f.id,'Other::-2');assert.equal(rows[2][2],'TRUE');
  assert.ok(c.selected.has(f.id));assert.deepEqual(c.customTagsByFigure[f.id],['tag']);
  await c.updateFigureHiddenInSheet(f,false);
  assert.equal(f.raw['#'],'2');assert.equal(rows[2][2],'');
  rows.push(['-2','New hidden','TRUE']);
  await c.updateFigureHiddenInSheet(f,true);
  assert.equal(f.raw['#'],'-4');assert.ok(c.selected.has('Other::-4'));
});
test('failed sheet write leaves the local ID and hidden state unchanged',async()=>{
  const {context:c,figure:f}=fixture({fail:true});
  await assert.rejects(c.updateFigureHiddenInSheet(f,true),/Write failed/);
  assert.equal(f.id,'Other::3');assert.equal(f.raw['#'],'3');assert.equal(f.hidden,undefined);
});
test('empty sequences start at one in their respective direction',()=>{
  const {context:c}=fixture();
  assert.equal(c.nextSequentialFigureId([['#']],0,true),-1);
  assert.equal(c.nextSequentialFigureId([['#'],['-1']],0),1);
});
test('hide and unhide rename both Drive files without changing their sheet links',async()=>{
  const {context,figure,names,rows}=fixture({photos:true});
  assert.equal(await context.updateFigureHiddenInSheet(figure,true),false);
  assert.deepEqual([...names.values()],['-2.png','-2b.png']);
  assert.equal(await context.updateFigureHiddenInSheet(figure,false),false);
  assert.deepEqual([...names.values()],['2.png','2b.png']);
  assert.deepEqual(rows[2].slice(3),['drive:primary','drive:alternate']);
});
test('a photo link shared with another figure keeps its filename',async()=>{
  const {context,figure,names}=fixture({photos:true,shared:true});
  assert.equal(await context.updateFigureHiddenInSheet(figure,true),true);
  assert.deepEqual([...names.values()],['3.png','-2b.png']);
});
