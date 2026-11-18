// Build-time SVG rasterization only; the website has no renderer dependency.
// See README-pwa.md for the temporary tool installation command.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const requireTool = createRequire(new URL('../tmp/icon-tools/package.json', import.meta.url));
const { Resvg } = requireTool('@resvg/resvg-js');
const source = await fs.readFile(new URL('../assets/splash/splash2.svg', import.meta.url), 'utf8');
// Preserve original geometry/styles; square framing leaves room for app masks.
const icon = source.replace(/<\?xml[^>]*>\s*/, '')
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace(/(<svg\b[^>]*>)/, '$1<title>Collector</title><rect x="50" y="410" width="900" height="900" fill="#ffffff"/>');
const output = new URL('../icons/', import.meta.url);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(new URL('splash2.svg', output), icon);
for (const size of [32, 180, 192, 512]) {
  const png = new Resvg(icon, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
  await fs.writeFile(new URL(`splash2-${size}.png`, output), png);
}
console.log('Created matching favicon and installation icons from the splash2 opening frame.');

// Windows trial: offer the browser-tab outline at 16px, keeping larger app art.
const head = await fs.readFile(new URL('../lego-head.svg', import.meta.url), 'utf8');
const faviconArt = head.match(/<g id="favicon-art"[\s\S]*?<\/g>/)?.[0];
if (!faviconArt) throw new Error('Original outline favicon artwork is missing.');
const smallDesktopIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${faviconArt}</svg>`;
await fs.writeFile(new URL('desktop-outline-16.png', output),
  new Resvg(smallDesktopIcon, {fitTo:{mode:'width',value:16},font:{loadSystemFonts:false}}).render().asPng());

// Mobile has its own artwork. Android supplies the adaptive outline; never
// bake rounded corners into this full-bleed, opaque white maskable canvas.
const mobileSource = await fs.readFile(new URL('../assets/splash/f1.svg', import.meta.url), 'utf8');
function mobileIcon(viewBox) {
  const [x,y,width,height] = viewBox.split(' ');
  return mobileSource.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`)
    .replace(/(<svg\b[^>]*>)/, `$1<title>Collector</title><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/><g transform="translate(495 495) scale(0.85) translate(-495 -495)">`)
    .replace('</svg>', '</g></svg>');
}
const mobile = mobileIcon('45 45 900 900');
const maskable = mobileIcon('95 95 800 800');
await fs.writeFile(new URL('f1.svg', output), mobile);
await fs.writeFile(new URL('f1-maskable.svg', output), maskable);
for (const size of [180, 192, 512]) {
  const png = new Resvg(mobile, {fitTo: {mode:'width', value:size}, font:{loadSystemFonts:false}}).render().asPng();
  await fs.writeFile(new URL(`f1-${size}.png`, output), png);
}
await fs.writeFile(new URL('f1-maskable-512.png', output),
  new Resvg(maskable, {fitTo:{mode:'width',value:512},font:{loadSystemFonts:false}}).render().asPng());
console.log('Created mobile f1 icons with a separate white maskable canvas.');
