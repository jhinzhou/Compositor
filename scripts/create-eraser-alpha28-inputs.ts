/** Authored eraser control; no user business images or downloads. */
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
const p=new PNG({width:240,height:160}),colors=[[64,64,64],[96,64,64],[97,64,64],[64,96,64],[64,64,97],[96,96,96]]
for(let y=0;y<160;y++)for(let x=0;x<240;x++){let rgba:number[];if(y<48)rgba=[...colors[Math.floor(x/40)],255];else if(y<112){rgba=[36,90,204,y>95?128:255];if(x>=80&&x<120&&y>=64&&y<96)rgba=[220,35,38,255];if(x>=120&&x<128&&y>=64&&y<96){const a=(128-x)/8;rgba=[Math.round(36*(1-a)+220*a),Math.round(90*(1-a)+35*a),Math.round(204*(1-a)+38*a),255];}}else{const same=(x<60||x>=180),diagonal=x>=100&&x<140&&x-100===y-112;rgba=[...(same||diagonal?[64,64,64]:[240,240,240]),255];}p.data.set(rgba,(y*240+x)*4)}
const folder='artifacts/alpha28-eraser-inputs';await mkdir(folder,{recursive:true});const bytes=PNG.sync.write(p);await writeFile(folder+'/eraser-calibration.png',bytes);await writeFile(folder+'/manifest.json',JSON.stringify({dimensions:[240,160],sourceSHA256:createHash('sha256').update(p.data).digest('hex'),fileSHA256:createHash('sha256').update(bytes).digest('hex'),origin:'Self-authored per-channel32/33 tolerance steps, blue background/red object/mixed edge, alpha128 band and disconnected/diagonal regions'},null,2));console.log('Authored eraser native control ready.');
