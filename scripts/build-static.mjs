import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'dist');
const productionFiles = [
  'index.html',
  'manifest.webmanifest',
  'manifest-mobile.webmanifest',
  'manifest-desktop.webmanifest',
  'pwa-install.js',
  'pwa-theme.js',
  'pwa-theme.css',
  'pwa-splash.js',
  'pwa-splash.css',
  'desktop-window.js',
  'desktop-window.css',
  'assets/splash',
  'icons',
  'app.js',
  'brickset-collection.js',
  'brickset-collection.css',
  'demo-catalogue.js',
  'assets/demo',
  'firebase-sync.js',
  'release-calendar.js',
  'OneSignalSDKWorker.js',
  'mobile-tag-behavior.js',
  'mobile-keyboard-dismiss.js',
  'date-time-format.js',
  'date-time-picker.js',
  'date-time-picker.css',
  'header.css',
  'palette.css',
  'styles.css',
  'release-calendar.css',
  'lego-head.svg',
  'notification-lego-head.png',
  'notification-lego-head-white.png',
  'color-picker-24.png',
  'lego-figure.svg',
  'lego-figure-dark.svg',
  'lego-figure-outline.svg',
  'lego-figure-outline-dark.svg',
  'privacy.html',
  'buymecoffee.png',
  'buymecoffee-inverted.png',
  'admin'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of productionFiles) {
  await cp(path.join(projectRoot, entry), path.join(outputDirectory, entry), {
    recursive: true,
    force: true
  });
}

// Both install entry points use the same application and shared-origin data.
const appHtml = await readFile(path.join(outputDirectory, 'index.html'), 'utf8');
for (const platform of ['mobile', 'desktop']) {
  const directory = path.join(outputDirectory, platform);
  await mkdir(directory, { recursive: true });
  let html = appHtml.replace('<head>', '<head>\n  <base href="/">')
    .replace('/manifest-desktop.webmanifest', `/manifest-${platform}.webmanifest`);
  if (platform === 'desktop') {
    html = html.replace('</head>', '  <link rel="stylesheet" href="/desktop-window.css?v=20261118-11">\n  <script src="/desktop-window.js?v=20261118-03" defer></script>\n</head>')
      .replace('<body>', '<body>\n  <div id="desktopWindowTitlebar" aria-label="Application title bar" hidden><img src="/lego-head.svg?v=3#outline" alt=""><span class="desktop-window-title">Custom Minifigs <span class="desktop-window-accent">Collector</span></span></div>');
  }
  await writeFile(path.join(directory, 'index.html'), html);
}
console.log(`Static production site created at ${outputDirectory}`);
