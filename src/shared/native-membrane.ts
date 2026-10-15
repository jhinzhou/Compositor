// Compositor HealPixels.c membrane port; MIT notice: licenses/Compositor-MIT.txt.
const OUTSIDE=0,RING=1,HOLE=2,F=Math.fround
export function healMembrane(value:Float32Array,role:Uint8Array,w:number,h:number,depth=0,charge?:(work:number)=>void):void {
 let iterations=300
 if(w>32&&h>32&&depth<16){const cw=Math.ceil(w/2),ch=Math.ceil(h/2),coarse=new Float32Array(cw*ch*4),coarseRole=new Uint8Array(cw*ch)
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){let known=0,hole=0;const ks=new Float32Array(4),hs=new Float32Array(4);for(let j=0;j<2;j++)for(let i=0;i<2;i++){const fx=x*2+i,fy=y*2+j;if(fx>=w||fy>=h)continue;const p=fy*w+fx;if(role[p]===RING){known++;for(let c=0;c<4;c++)ks[c]+=value[p*4+c]}else if(role[p]===HOLE){hole++;for(let c=0;c<4;c++)hs[c]+=value[p*4+c]}}
   const q=y*cw+x;if(known){coarseRole[q]=RING;for(let c=0;c<4;c++)coarse[q*4+c]=ks[c]/known}else if(hole){coarseRole[q]=HOLE;for(let c=0;c<4;c++)coarse[q*4+c]=hs[c]/hole}}
  healMembrane(coarse,coarseRole,cw,ch,depth+1,charge);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,q=Math.floor(y/2)*cw+Math.floor(x/2);if(role[p]===HOLE&&coarseRole[q]===HOLE)for(let c=0;c<4;c++)value[p*4+c]=coarse[q*4+c]}iterations=40
 }
 const sum=new Float32Array(4)
 for(let it=0;it<iterations;it++){charge?.(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(role[p]!==HOLE)continue;sum.fill(0);let n=0;for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx<0||ny<0||nx>=w||ny>=h)continue;const q=ny*w+nx;if(role[q]===OUTSIDE)continue;for(let c=0;c<4;c++)sum[c]+=value[q*4+c];n++}if(n)for(let c=0;c<4;c++)value[p*4+c]+=F(F(1.8)*F(F(sum[c]/n)-value[p*4+c]))}
}
}
