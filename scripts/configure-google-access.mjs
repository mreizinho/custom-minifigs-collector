// Run from the repository root after filling the ignored .env.google file.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const file='.env.google';
const source=fs.readFileSync(file,'utf8');
const values=Object.fromEntries(source.split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2')];}));
if(!values.GOOGLE_OAUTH_CLIENT_SECRET)throw Error('Fill GOOGLE_OAUTH_CLIENT_SECRET in the ignored .env.google file first.');
function wrangler(command,input){
  const result=spawnSync('cmd.exe',['/d','/s','/c',`npx --yes wrangler ${command}`],{input,encoding:'utf8',windowsHide:true});
  if(result.error||result.status!==0)throw Error('Cloudflare setup failed. Check Wrangler authentication and retry. No credentials were printed.');
  return result.stdout;
}
let config=fs.readFileSync('wrangler.toml','utf8');
if(!config.includes('binding = "GOOGLE_CONNECTIONS"')){
  const output=wrangler('kv namespace create GOOGLE_CONNECTIONS');
  const id=output.match(/(?:"id"\s*:\s*"|id\s*=\s*")([a-f0-9]{32})"/i)?.[1];
  if(!id)throw Error('Could not identify the created namespace. Inspect Cloudflare before retrying.');
  config+=`\n[[kv_namespaces]]\nbinding = "GOOGLE_CONNECTIONS"\nid = "${id}"\n`;
  fs.writeFileSync('wrangler.toml',config);
}
// Keep this key on reruns; rotating it would invalidate stored connections.
if(!values.GOOGLE_TOKEN_ENCRYPTION_KEY){
  values.GOOGLE_TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  fs.appendFileSync(file,`\nGOOGLE_TOKEN_ENCRYPTION_KEY=${values.GOOGLE_TOKEN_ENCRYPTION_KEY}\n`);
}
if(Buffer.from(values.GOOGLE_TOKEN_ENCRYPTION_KEY,'base64').length!==32)throw Error('The encryption key must contain 32 random bytes encoded as base64.');
wrangler('secret bulk',JSON.stringify({GOOGLE_OAUTH_CLIENT_SECRET:values.GOOGLE_OAUTH_CLIENT_SECRET,GOOGLE_TOKEN_ENCRYPTION_KEY:values.GOOGLE_TOKEN_ENCRYPTION_KEY}));
console.log('Configured encrypted Google connection storage and two Worker secrets. Deploy with npx wrangler deploy.');
