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
