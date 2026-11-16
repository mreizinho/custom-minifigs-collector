import { spawnSync } from 'node:child_process';

// Run with --env-file=.env.bricklink. Values go directly to Wrangler's stdin.
const names=['BRICKLINK_CONSUMER_KEY','BRICKLINK_CONSUMER_SECRET','BRICKLINK_TOKEN','BRICKLINK_TOKEN_SECRET'];
const secrets={};
for(const name of names){if(!process.env[name])throw Error(`Missing ${name}`);secrets[name]=process.env[name]}
const result=spawnSync('cmd.exe',['/d','/s','/c','npx --yes wrangler secret bulk'],{input:JSON.stringify(secrets),encoding:'utf8',windowsHide:true});
// Print only status; never echo subprocess output that might include credentials.
if(result.error||result.status!==0){console.error('Cloudflare secret configuration failed. Check Wrangler authentication and account permissions.');process.exitCode=1}
else console.log('Configured the four BrickLink Worker secrets.');
