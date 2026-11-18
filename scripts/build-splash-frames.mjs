// Replace frame payloads only; preserve all animation CSS, scripts and sizing.
import fs from 'node:fs/promises';
const target = new URL('../assets/splash/lego-splash.html', import.meta.url);
let html = await fs.readFile(target, 'utf8');
for (let frame=1; frame<=6; frame++) {
  const svg = await fs.readFile(new URL(`../assets/splash/frames/frame${frame}.svg`, import.meta.url));
  if (!svg.toString('utf8').includes('viewBox="0 0 992.1 992.1"')) throw new Error(`Unexpected canvas for frame${frame}`);
  const element = new RegExp(`<image\\b[^>]*\\bid="frame${frame}"[^>]*>`, 'g');
  const matches = html.match(element);
  if (matches?.length !== 1) throw new Error(`Expected exactly one image for frame${frame}`);
  const payload = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  html = html.replace(element, tag => tag.replace(/\bhref="[^"]*"/, `href="${payload}"`));
}
await fs.writeFile(target, html);
console.log('Replaced all six inline SVG frame payloads; animation behavior unchanged.');
