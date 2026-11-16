import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function fixture({fail=false}={}){
  const rows=[['#','Name','Hidden'],['1','Visible',''],['3','Target',''],['-1','Hidden','TRUE'],['-3','Hidden too','TRUE']];
  const figure={id:'Other::3',raw:{'#':'3'},sheetRow:3};
  const context={SECRET_DEMO_MODE:false,window:{collectorFirebaseUser:'user'},activeCollection:'Other',COLLECTIONS:['First','Other'],SHEET_ID:'sheet',clean:v=>String(v??'').trim(),figureNumber:f=>f.raw['#'],resolveFigureSheetRow:async()=>{},restoreSheetsAccess:async()=>{},selected:new Set([figure.id]),wished:new Set(),removedOwned:new Set(),removedWished:new Set(),customTagsByFigure:{[figure.id]:['tag']},persist(){},persistCustomTags(){},
    sheetsRequest:async(url,options)=>{
      if(!options)return{json:async()=>({values:rows})};
      if(fail)throw Error('Write failed');
      assert.ok(url.endsWith('/values:batchUpdate'));
      const {data}=JSON.parse(options.body);
      for(const item of data){const [,col,row]=item.range.match(/!([A-Z]+)(\d+)$/);rows[Number(row)-1][col.charCodeAt(0)-65]=item.values[0][0]}
      return{json:async()=>({})};
    }};
  vm.createContext(context);
  vm.runInContext(extract('function normalizedHeader(','function loadImageFile(')+extract('async function updateFigureHiddenInSheet(','async function toggleFigureHidden('),context);
  return{context,figure,rows};
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
