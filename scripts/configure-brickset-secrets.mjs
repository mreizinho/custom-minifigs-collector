import { spawnSync } from 'node:child_process';
const names = ['BRICKSET_API_KEY', 'BRICKSET_USER_HASH'], secrets = {};
for (const name of names) {
  if (!process.env[name]?.trim()) throw Error(`Missing ${name}`);
  secrets[name] = process.env[name].trim();
}
const result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx --yes wrangler secret bulk'], {
  input: JSON.stringify(secrets), encoding: 'utf8', windowsHide: true
});
if (result.error || result.status !== 0) {
  console.error('Brickset secret configuration failed. Check Cloudflare authentication.');
  process.exitCode = 1;
} else console.log('Configured the two Brickset Worker secrets.');
