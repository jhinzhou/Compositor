export interface WorldRegion { x: number; y: number; width: number; height: number }
export interface ViewportRenderPlan { region: WorldRegion; width: number; height: number; css: { left: string; top: string; width: string; height: string }; fullDocument: boolean }
// Keep the DOM document-sized, but only allocate the visible raster at display
// resolution. Integer world bounds keep nearest-neighbour pixels aligned when
// panning and avoid a 30k-wide bitmap allocation at high magnification.
export function planViewportRender(input: { document: { width: number; height: number }; viewport: { width: number; height: number }; origin: { x: number; y: number }; zoom: number; deviceScale?: number; overscan?: number }): ViewportRenderPlan {
  const { document, viewport, origin, zoom } = input, dpr = Math.min(4, Math.max(1, input.deviceScale ?? 1)), padding = Math.max(32, Math.min(4_000_000, input.overscan ?? 96))
  if (![document.width,document.height,viewport.width,viewport.height,origin.x,origin.y,zoom,dpr].every(Number.isFinite) || document.width < 1 || document.height < 1 || zoom <= 0) throw new Error('Invalid viewport geometry.')
  const totalWidth = document.width * zoom * dpr, totalHeight = document.height * zoom * dpr
  const fullDocument = totalWidth * totalHeight <= 4_000_000 && Math.max(totalWidth,totalHeight) <= 4096
  let x = fullDocument ? 0 : Math.max(0,Math.min(document.width-1,Math.floor((-origin.x-padding)/zoom)))
  let y = fullDocument ? 0 : Math.max(0,Math.min(document.height-1,Math.floor((-origin.y-padding)/zoom)))
  const right = fullDocument ? document.width : Math.max(x+1,Math.min(document.width,Math.ceil((viewport.width-origin.x+padding)/zoom)))
  const bottom = fullDocument ? document.height : Math.max(y+1,Math.min(document.height,Math.ceil((viewport.height-origin.y+padding)/zoom)))
  const region = { x,y,width:right-x,height:bottom-y }, resolution = Math.min(zoom*dpr,8192/region.width,8192/region.height,Math.sqrt(16_000_000/(region.width*region.height)))
  return { region,width:Math.max(1,Math.ceil(region.width*resolution)),height:Math.max(1,Math.ceil(region.height*resolution)),css:{left:`${x*zoom}px`,top:`${y*zoom}px`,width:`${region.width*zoom}px`,height:`${region.height*zoom}px`},fullDocument }
}
