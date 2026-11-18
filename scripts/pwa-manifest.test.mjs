import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
test('production build contains an installable standalone manifest and correctly sized home-screen icons',async()=>{
  const dist=path.join(root,'dist'),html=await fs.readFile(path.join(dist,'index.html'),'utf8');
  assert.match(html,/rel="manifest" href="\/manifest-desktop.webmanifest"/);
  assert.match(html,/rel="apple-touch-icon" href="\/icons\/splash2-180.png"/);
  assert.match(html,/src="\/pwa-theme\.js/);
  assert.ok((await fs.stat(path.join(dist,'pwa-theme.js'))).size>0);
  const manifest=JSON.parse(await fs.readFile(path.join(dist,'manifest.webmanifest'),'utf8'));
  assert.equal(manifest.name,'Collector');
  assert.equal(manifest.short_name,'Collector');
  assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');assert.equal(manifest.id,'/');
  assert.notEqual(manifest.prefer_related_applications,true);
  assert.ok(manifest.icons.some(icon=>icon.purpose.includes('maskable')));
  for(const size of [192,512]){
    const icon=manifest.icons.find(icon=>icon.sizes===`${size}x${size}`);assert.ok(icon);
    const data=await fs.readFile(path.join(dist,icon.src));
    assert.equal(data.readUInt32BE(16),size);assert.equal(data.readUInt32BE(20),size);
  }
  const apple=await fs.readFile(path.join(dist,'icons/splash2-180.png'));
  assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
  const worker=await fs.readFile(path.join(dist,'OneSignalSDKWorker.js'),'utf8');
  assert.ok(worker.includes('OneSignalSDK.sw.js'));
});
test('initial HTML retains the mobile-compatible splash2 fallback and existing desktop installation icons',async()=>{
  const dist=path.join(root,'dist');
  for(const page of ['index.html','privacy.html']){
    const html=await fs.readFile(path.join(dist,page),'utf8');
    assert.match(html,/rel="icon" type="image\/svg\+xml" href="\/icons\/splash2.svg"/);
    assert.match(html,/rel="icon" type="image\/png" sizes="32x32" href="\/icons\/splash2-32.png"/);
    assert.ok(!html.includes('favicon-outline'));
  }
  const manifest=JSON.parse(await fs.readFile(path.join(dist,'manifest.webmanifest'),'utf8'));
  assert.ok(manifest.icons.every(icon=>icon.src.startsWith('/icons/splash2-')));
  const original=await fs.readFile(path.join(dist,'assets/splash/splash2.svg'),'utf8');
  const icon=await fs.readFile(path.join(dist,'icons/splash2.svg'),'utf8');
  assert.deepEqual(icon.match(/<path\b[^>]*>/g),original.match(/<path\b[^>]*>/g));
  assert.equal(icon.match(/<style>[\s\S]*?<\/style>/)[0],original.match(/<style>[\s\S]*?<\/style>/)[0]);
  const small=await fs.readFile(path.join(dist,'icons/splash2-32.png'));
  assert.equal(small.readUInt32BE(16),32);assert.equal(small.readUInt32BE(20),32);
});
test('mobile and desktop installations have distinct non-overlapping identities and working shared-app entry points',async()=>{
  const dist=path.join(root,'dist'),apps=[];
  for(const platform of ['mobile','desktop']){
    const manifest=JSON.parse(await fs.readFile(path.join(dist,`manifest-${platform}.webmanifest`),'utf8'));
    assert.equal(manifest.name,'Collector');assert.equal(manifest.short_name,'Collector');
    assert.equal(manifest.id,`/${platform}/`);assert.equal(manifest.scope,`/${platform}/`);assert.equal(manifest.start_url,`/${platform}/`);
    assert.equal(manifest.background_color,'#ffffff');
    const html=await fs.readFile(path.join(dist,platform,'index.html'),'utf8');
    assert.ok(html.includes('<base href="/">'));
    assert.ok(html.includes(`href="/manifest-${platform}.webmanifest"`));
    assert.ok(html.includes('/assets/splash/lego-splash.html'));
    for(const icon of manifest.icons)assert.ok((await fs.stat(path.join(dist,icon.src))).size>0);
    apps.push(manifest);
  }
  assert.notEqual(apps[0].id,apps[1].id);
  assert.ok(!apps[0].scope.startsWith(apps[1].scope)&&!apps[1].scope.startsWith(apps[0].scope));
});
test('mobile uses f1 with a separate full-bleed white maskable icon; desktop keeps splash2',async()=>{
  const dist=path.join(root,'dist');
  const mobile=JSON.parse(await fs.readFile(path.join(dist,'manifest-mobile.webmanifest'),'utf8'));
  const desktop=JSON.parse(await fs.readFile(path.join(dist,'manifest-desktop.webmanifest'),'utf8'));
  assert.ok(desktop.icons.filter(icon=>icon.sizes!=='16x16').every(icon=>icon.src.includes('splash2')));
  const smallDesktop=desktop.icons.find(icon=>icon.sizes==='16x16');
  assert.equal(smallDesktop.src,'/icons/desktop-outline-16.png');
  const smallPng=await fs.readFile(path.join(dist,smallDesktop.src));
  assert.equal(smallPng.readUInt32BE(16),16);assert.equal(smallPng.readUInt32BE(20),16);
  assert.ok(mobile.icons.every(icon=>icon.src.includes('f1')));
  const mask=mobile.icons.find(icon=>icon.purpose==='maskable');
  assert.equal(mask.src,'/icons/f1-maskable-512.png');
  assert.ok(mobile.icons.some(icon=>icon.purpose==='any'));
  const original=await fs.readFile(path.join(dist,'assets/splash/f1.svg'),'utf8');
  const icon=await fs.readFile(path.join(dist,'icons/f1-maskable.svg'),'utf8');
  assert.deepEqual(icon.match(/<path\b[^>]*>/g),original.match(/<path\b[^>]*>/g));
  assert.match(icon,/<rect x="95" y="95" width="800" height="800" fill="#ffffff"\/>/);
  assert.ok(!icon.includes('<image'));
  assert.match(icon,/transform="translate\(495 495\) scale\(0\.85\) translate\(-495 -495\)"/);
  const png=await fs.readFile(path.join(dist,mask.src));
  assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);
});
