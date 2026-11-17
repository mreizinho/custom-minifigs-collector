// Build-time SVG rasterization only; the website has no renderer dependency.
// See README-pwa.md for the temporary tool installation command.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const requireTool = createRequire(new URL('../tmp/icon-tools/package.json', import.meta.url));
const { Resvg } = requireTool('@resvg/resvg-js');
const source = await fs.readFile(new URL('../assets/splash/head2.svg', import.meta.url), 'utf8');
// Preserve original geometry/styles; square framing leaves room for app masks.
const icon = source.replace(/<\?xml[^>]*>\s*/, '')
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace('viewBox="0 0 841.9 595.3"', 'viewBox="20.95 -102.35 800 800"')
  .replace(/(<svg\b[^>]*>)/, '$1<title>Custom Minifigs Collector</title><rect x="20.95" y="-102.35" width="800" height="800" fill="#f5f5f2"/>');
const output = new URL('../icons/', import.meta.url);
await fs.mkdir(output, { recursive: true });
await fs.writeFile(new URL('head2.svg', output), icon);
for (const size of [32, 180, 192, 512]) {
  const png = new Resvg(icon, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
  await fs.writeFile(new URL(`head2-${size}.png`, output), png);
}
console.log('Created matching favicon and installation icons from splash head2.svg.');
