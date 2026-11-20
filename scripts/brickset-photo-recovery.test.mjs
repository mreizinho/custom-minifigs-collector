import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../brickset-photo-recovery.js',import.meta.url),'utf8');
function recovery({active=true,code='col069',detail=false}={}){
  let handler;
  class Image{
    constructor(){this.src=`https://img.bricklink.com/ItemImage/MN/0/${code}.png`;this.dataset={};this.classes=new Set();this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};}
    get currentSrc(){return this.src;}
    closest(selector){return selector==='#catalogue .card'&&!detail?{dataset:{bricksetCode:code}}:selector==='#detail'&&detail?{}:null;}
  }
  const image=new Image();
  vm.runInNewContext(source,{document:{addEventListener:(name,fn,options)=>{assert.equal(name,'error');assert.equal(options.capture,true);handler=fn;}},HTMLImageElement:Image,isBricksetCollection:()=>active,activeDetailFigure:detail?{source:'brickset',character:code}:null,fallbackImageSource:()=> 'lego-figure-outline.svg?v=4',URL});
  const error=(target=image)=>{const event={target,stopped:false,stopImmediatePropagation(){this.stopped=true;}};handler(event);return event;};
  return{image,error};
}
test('failed photos use the visible card reference on any page, not the first page figure',()=>{
  for(const code of ['38014pb01','cas473','col069','col070']){
    const p=recovery({code});assert.equal(p.image.dataset.bricksetPhotoFallback,undefined);
    assert.equal(p.error().stopped,true);assert.equal(p.image.src,`https://images.brickset.com/minifigs/large/${code}.jpg`);
    assert.equal(p.image.title,'Photo from Brickset');assert.ok(p.image.classes.has('bricklink-photo'));
  }
});
test('a missing Brickset alternate falls through to the existing thumbnail placeholder without retrying',()=>{
  const p=recovery();p.error();const fallback=p.image.src;
  assert.equal(p.error().stopped,false);assert.equal(p.image.src,fallback);assert.equal(p.error().stopped,false);
});
test('detail photos try Brickset once, then use a clean local placeholder',()=>{
  const p=recovery({detail:true});p.error();assert.ok(p.image.src.includes('images.brickset.com'));
  assert.equal(p.error().stopped,true);assert.equal(p.image.src,'lego-figure-outline.svg?v=4');assert.ok(p.image.classes.has('fallback-image'));
  assert.equal(p.error().stopped,false);assert.equal(p.image.dataset.bricksetPhotoFallback,'placeholder');
});
test('normal collections, unrelated photo hosts and non-images are unaffected',()=>{
  const other=recovery({active:false});assert.equal(other.error().stopped,false);assert.equal(other.image.dataset.bricksetPhotoFallback,undefined);
  const p=recovery();p.image.src='https://example.com/photo.png';assert.equal(p.error().stopped,false);assert.equal(p.image.dataset.bricksetPhotoFallback,undefined);
  assert.equal(p.error({}).stopped,false);
});
test('production registers recovery before Brickset starts loading photos and keeps hidden broken images hidden',()=>{
  const root=new URL('../dist/',import.meta.url),html=fs.readFileSync(new URL('index.html',root),'utf8');
  assert.ok(html.indexOf('src="brickset-photo-recovery.js')>html.indexOf('src="app.js'));
  assert.ok(html.indexOf('src="brickset-photo-recovery.js')<html.indexOf('src="brickset-collection.js'));
  assert.ok(fs.statSync(new URL('brickset-photo-recovery.js',root)).size>0);
  const css=fs.readFileSync(new URL('styles.css',root),'utf8');assert.ok(css.includes('#catalogue .image-wrap img[hidden]{display:none!important}'));
});
