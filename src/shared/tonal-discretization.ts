/** Photoshop 27.11 native Threshold controls use encoded RGB .30/.59/.11.
 * RGB8 rounds brightness to a byte before the inclusive cutoff. RGB16 retains
 * source brightness and maps only the control cutoff into the native 15+1 grid.
 */
export function thresholdWhite(r:number,g:number,b:number,alpha:number,level:number,depth:8|16=16):boolean {
  const weighted=30*r+59*g+11*b
  return depth===8?Math.floor(255*weighted/(100*alpha)+.5)>=level:32768*weighted>=100*Math.floor(level*32768/255)*alpha
}
/** Equal-width input bins, followed by equally spaced output palette entries.
 * Native RGB8 truncates entries to bytes; RGB16 truncates in Photoshop's
 * 15+1-bit palette, then expands the result into our full-range source domain.
 * RGB16 rounds the evaluated color into the native 15+1 input lattice for this
 * deliberately discrete operation only; source storage and alpha stay exact.
 */
export function posterizeChannel(value:number,levels:number,depth:8|16=16):number {
  const value01=Math.max(0,Math.min(1,value)),scale=depth===8?255:32768,input=depth===8?value01*255/256:Math.round(value01*32768)/32768,bin=Math.min(levels-1,Math.floor(input*levels))
  return Math.floor(bin*scale/(levels-1))/scale
}
