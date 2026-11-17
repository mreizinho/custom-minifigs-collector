import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('production build contains an installable standalone manifest and correctly sized home-screen icons',async()=>{
  const dist=path.join(root,'dist'),html=await fs.readFile(path.join(dist,'index.html'),'utf8');
  assert.match(html,/rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html,/rel="apple-touch-icon" href="\/icons\/head2-180.png"/);
  assert.match(html,/src="\/pwa-theme\.js/);
  assert.ok((await fs.stat(path.join(dist,'pwa-theme.js'))).size>0);
  const manifest=JSON.parse(await fs.readFile(path.join(dist,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.name,'Custom Minifigs Collector');
  assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.id,'/');
  assert.notEqual(manifest.prefer_related_applications,true);
  assert.ok(manifest.icons.some(icon=>icon.purpose.includes('maskable')));
  for(const size of [192,512]){
    const icon=manifest.icons.find(icon=>icon.sizes===`${size}x${size}`);assert.ok(icon);
    const data=await fs.readFile(path.join(dist,icon.src));
    assert.equal(data.readUInt32BE(16),size);assert.equal(data.readUInt32BE(20),size);
  }
  const apple=await fs.readFile(path.join(dist,'icons/head2-180.png'));
  assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
  const worker=await fs.readFile(path.join(dist,'OneSignalSDKWorker.js'),'utf8');
  assert.ok(worker.includes('OneSignalSDK.sw.js'));
});
test('tab, privacy page, and installation icons share the supplied head2 artwork',async()=>{
  const dist=path.join(root,'dist');
  for(const page of ['index.html','privacy.html']){
    const html=await fs.readFile(path.join(dist,page),'utf8');
    assert.match(html,/rel="icon" type="image\/svg\+xml" href="\/icons\/head2.svg"/);
    assert.match(html,/rel="icon" type="image\/png" sizes="32x32" href="\/icons\/head2-32.png"/);
    assert.ok(!html.includes('favicon-outline'));
  }
  const manifest=JSON.parse(await fs.readFile(path.join(dist,'manifest.webmanifest'),'utf8'));
  assert.ok(manifest.icons.every(icon=>icon.src.startsWith('/icons/head2-')));
  const original=await fs.readFile(path.join(dist,'assets/splash/head2.svg'),'utf8');
  const icon=await fs.readFile(path.join(dist,'icons/head2.svg'),'utf8');
  assert.deepEqual(icon.match(/<path\b[^>]*>/g),original.match(/<path\b[^>]*>/g));
  assert.equal(icon.match(/<style>[\s\S]*?<\/style>/)[0],original.match(/<style>[\s\S]*?<\/style>/)[0]);
  const small=await fs.readFile(path.join(dist,'icons/head2-32.png'));
  assert.equal(small.readUInt32BE(16),32);assert.equal(small.readUInt32BE(20),32);
});
