import type {RGBAImage,RasterSelection} from '../../src/core/selection-retouch'
export interface TrimapFixture {name:string;guide:RGBAImage;mask:RasterSelection;trimap:Uint8Array;truth:Float32Array;expected:'supported'|'unsupported';reason:string}
/** Original procedural fixtures; encoded-sRGB F/B compositing, with no external
 * photography or Photoshop output claimed as reference. */
export function trimapFixtures():TrimapFixture[]{
 const width=128,height=96,count=width*height,fixtures:TrimapFixture[]=[]
 const make=(name:string,alpha:(x:number,y:number)=>number,fg:number[],bg:number[],expected:TrimapFixture['expected']='supported',reason='Constant known foreground/background colors in encoded sRGB.',missing=false,variable=false)=>{
  const truth=new Float32Array(count),data=new Uint8Array(count*4),coverage=new Uint8Array(count),trimap=new Uint8Array(count)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,a=Math.min(1,Math.max(0,alpha(x+.5,y+.5)));truth[i]=a;coverage[i]=a>=.5?255:0;trimap[i]=a<=.00001?0:!missing&&a>=.99999?255:128;for(let c=0;c<3;c++){const f=variable&&x>64?[240,20,220][c]:fg[c];data[i*4+c]=Math.round(bg[c]+(f-bg[c])*a)}data[i*4+3]=255}
  fixtures.push({name,truth,guide:{width,height,data},mask:{width,height,coverage},trimap,expected,reason})
 }
 const body=(x:number,y:number)=>x>=30&&x<=64&&y>=14&&y<=82?1:0
 const strands=(x:number,y:number)=>{if(body(x,y))return 1;if(x<64||x>84||y<15||y>81)return 0;let a=0;for(let k=0;k<8;k++){const center=20+k*8+Math.sin((x-64)/7+k)*1.7;a=Math.max(a,.85*Math.exp(-.5*((y-center)/.7)**2))}return a}
 make('subpixel-fine-strands',strands,[35,45,55],[220,230,240])
 make('transparent-soft-edge',(x,y)=>y>=16&&y<=80&&x>=30&&x<=64?1:y>=16&&y<=80&&x>64&&x<84?(84-x)/20:0,[50,95,135],[230,210,185])
 make('antialiased-pointed-corner',(x,y)=>{const edge=76-Math.abs(y-48)*.65;if(x<30||y<16||y>80)return 0;return Math.min(1,Math.max(0,(edge-x)/2))},[30,40,60],[220,230,240])
 make('equal-luminance-color-strands',strands,[255,0,0],[0,76,0])
 make('low-contrast-unsupported',strands,[112,112,112],[115,115,115],'unsupported','F/B distance is below the explicit reliability threshold; original coverage is preserved.')
 make('missing-foreground-anchor-unsupported',strands,[35,45,55],[220,230,240],'unsupported','There is no known foreground anchor; refinement must preserve unknown coverage.',true)
 make('varying-foreground-color-unsupported',strands,[35,45,55],[220,230,240],'unsupported','Unknown strands have a different foreground color from the solid color anchors.',false,true)
 return fixtures
}
export function trimapError(fixture:TrimapFixture,coverage:Uint8Array):{alphaMAE:number;maximumError:number;unknownPixels:number}{
 let error=0,maximumError=0,unknownPixels=0
 for(let i=0;i<coverage.length;i++)if(fixture.trimap[i]===128){const delta=Math.abs(coverage[i]/255-fixture.truth[i]);error+=delta;maximumError=Math.max(maximumError,delta);unknownPixels++}
 return {alphaMAE:unknownPixels?error/unknownPixels:0,maximumError,unknownPixels}
}
