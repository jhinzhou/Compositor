/** Normalize a canvas drag to a document-pixel rectangle, clipped before ML preprocessing. */
export function objectSelectionBounds(start:[number,number],end:[number,number],document:{width:number;height:number},square=false):[number,number,number,number]|undefined {
 if(![...start,...end,document.width,document.height].every(Number.isFinite)||document.width<1||document.height<1)throw Error('Invalid object selection geometry.')
 let dx=end[0]-start[0],dy=end[1]-start[1];if(square){const side=Math.max(Math.abs(dx),Math.abs(dy));dx=(dx<0?-1:1)*side;dy=(dy<0?-1:1)*side}
 const left=Math.max(0,Math.floor(Math.min(start[0],start[0]+dx))),top=Math.max(0,Math.floor(Math.min(start[1],start[1]+dy))),right=Math.min(document.width,Math.ceil(Math.max(start[0],start[0]+dx))),bottom=Math.min(document.height,Math.ceil(Math.max(start[1],start[1]+dy)))
 return right>left&&bottom>top?[left,top,right-left,bottom-top]:undefined
}
