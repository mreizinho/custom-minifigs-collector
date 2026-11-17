// Rasterize the site's existing vector head mark; no image service or dependency.
import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../icons');
await fs.mkdir(output,{recursive:true});
const shapes=[[31,5,38,15,3],[10,20,80,67,14],[25,87,50,8,1]];
const background=[245,245,242],ink=[36,38,36];
function stroke(x,y,[left,top,width,height,radius]){
  const dx=Math.abs(x-left-width/2)-(width/2-radius),dy=Math.abs(y-top-height/2)-(height/2-radius);
  const distance=Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0)-radius;
  return Math.abs(distance)<=4.25;
}
const crcTable=Array.from({length:256},(_,value)=>{for(let n=0;n<8;n++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function chunk(type,data){
  const label=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);
  let crc=0xffffffff;for(const byte of Buffer.concat([label,data]))crc=crcTable[(crc^byte)&255]^(crc>>>8);
  checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([length,label,data,checksum]);
}
function png(size){
  const rows=Buffer.alloc(size*(size*3+1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let coverage=0;
    for(let sy=0;sy<4;sy++)for(let sx=0;sx<4;sx++){
      const px=(((x+(sx+.5)/4)/size)*100-17)/.66,py=(((y+(sy+.5)/4)/size)*100-17)/.66;
      if(shapes.some(shape=>stroke(px,py,shape)))coverage++;
    }
    const offset=y*(size*3+1)+1+x*3;
    for(let c=0;c<3;c++)rows[offset+c]=Math.round(background[c]+(ink[c]-background[c])*coverage/16);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
await fs.writeFile(path.join(output,'app-icon.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Custom Minifigs Collector</title><desc>Based on the site's existing LEGO-style head mark by Marco Petrucci for the Noun Project.</desc><rect width="100" height="100" fill="#f5f5f2"/><g transform="translate(17 17) scale(.66)" fill="none" stroke="#242624" stroke-width="8.5" stroke-linejoin="round">${shapes.map(([x,y,width,height,rx])=>`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}"/>`).join('')}</g></svg>\n`);
for(const [name,size] of [['app-icon-192.png',192],['app-icon-512.png',512],['apple-touch-icon.png',180]])await fs.writeFile(path.join(output,name),png(size));
console.log('Created app icons from the existing head mark.');
