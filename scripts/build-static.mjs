import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'dist');
const productionFiles = [
  'index.html',
  'app.js',
  'demo-catalogue.js',
  'firebase-sync.js',
  'release-calendar.js',
  'OneSignalSDKWorker.js',
  'mobile-tag-behavior.js',
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
  'lego-figure.svg',
  'lego-figure-dark.svg',
  'lego-figure-outline.svg',
  'lego-figure-outline-dark.svg',
  'privacy.html',
  'privacy-policy.svg',
  'gear-716652.png',
  'buymecoffee.png',
  'buymecoffee-inverted.png',
  'admin',
  'assets'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of productionFiles) {
  await cp(path.join(projectRoot, entry), path.join(outputDirectory, entry), {
    recursive: true,
    force: true
  });
}

console.log(`Static production site created at ${outputDirectory}`);
