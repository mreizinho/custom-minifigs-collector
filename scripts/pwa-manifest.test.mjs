import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('production build contains an installable standalone manifest and correctly sized home-screen icons',async()=>{
  const dist=path.join(root,'dist'),html=await fs.readFile(path.join(dist,'index.html'),'utf8');
  assert.match(html,/rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html,/rel="apple-touch-icon" href="\/icons\/apple-touch-icon.png"/);
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
  const apple=await fs.readFile(path.join(dist,'icons/apple-touch-icon.png'));
  assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
  const worker=await fs.readFile(path.join(dist,'OneSignalSDKWorker.js'),'utf8');
  assert.ok(worker.includes('OneSignalSDK.sw.js'));
});
