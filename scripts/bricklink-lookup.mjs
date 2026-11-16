import { lookup } from '../worker/bricklink.js';
export { authorization, lookup } from '../worker/bricklink.js';
import { pathToFileURL } from 'node:url';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const credentials={consumerKey:process.env.BRICKLINK_CONSUMER_KEY,consumerSecret:process.env.BRICKLINK_CONSUMER_SECRET,token:process.env.BRICKLINK_TOKEN,tokenSecret:process.env.BRICKLINK_TOKEN_SECRET};
  try{console.log(JSON.stringify(await lookup(process.argv[2]||'sw0001',credentials),null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
