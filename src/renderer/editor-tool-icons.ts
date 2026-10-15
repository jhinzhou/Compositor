export interface ToolIconStroke {readonly d:string;readonly dash?:string;readonly fill?:string}
export interface ToolIconGeometry {readonly key:string;readonly strokes:readonly ToolIconStroke[]}
const path=(d:string,dash?:string):ToolIconStroke=>({d,...(dash?{dash}:{})})
// These monochrome geometries have distinct silhouettes at 17–18 CSS pixels.
// No undefined dynamic component or generic fallback stands in for a tool.
const geometry:Record<string,readonly ToolIconStroke[]>={
 frame:[path('M3 4h18v16H3ZM3 4l18 16M21 4 3 20')],
 pen:[path('m4 20 4-13 10-5 4 4-5 10-13 4Zm0 0 9-9m2-1a2 2 0 1 1-4 0 2 2 0 1 1 4 0')],
 'path-selection':[{d:'m5 2 14 12-7 1-3 7Z',fill:'currentColor'}],
 'direct-selection':[path('m5 2 14 12-7 1-3 7Z')],
 dodge:[path('M6 9a6 6 0 1 1 12 0 6 6 0 1 1-12 0Zm6 6v7')],
 burn:[path('M4 13V9a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0v5a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v5c0 5-12 8-16-3Z')],
 sponge:[path('m3 7 15-3 3 13-15 3ZM7 10h.01m5-1h.01m4 4h.01m-7 3h.01')],
 'history-brush':[path('M4 9a8 8 0 1 1 2 10M4 4v5h5m4 2 7-7 3 3-7 7-4 1Z')],
 'art-history-brush':[path('M3 8a7 7 0 0 1 12-3M3 3v5h5m0 8 8-8 4 4-8 8-6 2Zm6-6 4 4M18 3v4m-2-2h4')],
 move:[path('M12 2v20M2 12h20m-13-7 3-3 3 3m-6 14 3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3')],
 'marquee-rectangle':[path('M4 4h16v16H4Z','3 2')],
 'marquee-single-row':[path('M3 11h18v2H3Z','2 2')],
 'marquee-single-column':[path('M11 3h2v18h-2Z','2 2')],
 'mixer-brush':[path('m9 14 8-9 4 4-8 9-5 2Zm0 0c-5 0-3 6-7 7 7 2 11-1 11-3M4 2v6m-3-3h6')],
 pencil:[path('m3 17 13-13 5 5-13 13-6 1ZM13 7l5 5M3 17l5 5')],
 'paint-bucket':[path('m4 11 8-8 9 9-8 8ZM7 8l7 7m-4-12 4 4M20 15c-3 4-3 6 0 6s3-2 0-6Z')],
 'marquee-ellipse':[path('M20 12a8 6 0 1 1-16 0 8 6 0 1 1 16 0','3 2')],
 'selection-brush':[path('M20 12a8 8 0 1 1-8-8','2 2'),path('m8 17 2-5 7-7 3 3-7 7-5 2Zm7-10 3 3')],
 'lasso-freehand':[path('M17 17c7-4 5-13-5-13S1 15 7 18c3 2 9 1 8-2-1-3-6 0-3 3l3 2')],
 'lasso-polygon':[path('m3 4 18 2-5 14-10-4ZM6 16v5l3-2')],
 'lasso-magnetic':[path('m2 4 20 2-5 15-12-5Z'),path('M9 8v4a3 3 0 0 0 6 0V8m-6 2h2m2 0h2')],
 object:[path('M3 3h14v14H3Z','3 2'),path('m12 11 8 5-4 1-2 4Z')],
 'quick-selection':[path('M4 6v-2h4m6 0h4v4M4 12v6h4','2 2'),path('m10 17 2-4 6-6 3 3-6 6-5 1ZM18 19h4m-2-2v4')],
 magic:[path('m4 20 13-13 3 3L7 23Zm10-10 3 3M4 3v5m-3-2h6m12-5v4m-2-2h4')],
 crop:[path('M6 2v16h16M2 6h16v16M6 6h12v12')],
 'crop-perspective':[path('m4 5 15-3 2 17-17 3ZM9 4v17m7-18v17M4 10l16-3M4 16l17-3')],
 'crop-straighten':[path('M3 7h18v10H3ZM6 7v4m4-4v6m4-6v4m4-4v6M3 21l18-3')],
 brush:[path('M14 4 21 2 18 9l-7 7-3-3Zm-6 9c-5 1-1 6-6 8 8 2 9-2 9-5')],
 eraser:[path('m3 15 9-11 9 7-8 10H9Zm4-5 9 7M13 21h9')],
 'background-eraser':[path('m3 14 8-10 8 7-7 10H8Zm4-5 8 7M14 21h8'),path('M20 2v6m-3-3h6')],
 'magic-eraser':[path('m2 15 8-10 8 7-7 9H7Zm4-5 8 7M14 21h8'),path('M20 2v4m-2-2h4M4 2v3M2.5 3.5h3')],
 'heal-spot':[path('m4 12 8-8a5 5 0 0 1 7 7l-8 8a5 5 0 0 1-7-7Zm4-4 8 8m-6-5h.01m3-1h.01m-3 4h.01M3 2v4M1 4h4')],
 'heal-sampled':[path('m4 12 8-8a5 5 0 0 1 7 7l-8 8a5 5 0 0 1-7-7Zm4-4 8 8'),path('M13 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0M2 20h4m-2-2v4')],
 remove:[path('m3 15 8-9 7 6-7 9H8Zm4-5 7 6M16 2v6m-3-3h6m1 2v4m-2-2h4')],
 patch:[path('M5 5h14v14H5ZM2 8h6m-6 4h6m-6 4h6m8-8h6m-6 4h6m-6 4h6M8 2v6m4-6v6m4-6v6m-8 8v6m4-6v6m4-6v6')],
 'content-move':[path('M3 3h13v13H3Z','2 2'),path('M9 20h12m-3-3 3 3-3 3M20 8v8m-3-5 3-3 3 3')],
 'red-eye':[path('M2 12c5-8 15-8 20 0-5 8-15 8-20 0Z'),path('M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0M4 3l16 18')],
 clone:[path('M9 4a3 3 0 1 1 6 0c0 3-2 4-2 7h-2c0-3-2-4-2-7ZM5 12h14v5H5ZM3 21h18')],
 smear:[path('M12 2c-1 6-7 9-7 14a7 7 0 0 0 14 0c0-5-6-8-7-14Z')],
 gradient:[path('M3 3h18v18H3ZM12 3v18m3-18v18m3-18v18M6 6h.01M9 8h.01M6 11h.01M9 14h.01M6 18h.01')],
 shape:[path('M4 4h16v16H4Z')],
 text:[path('M3 4h18M12 4v17M8 21h8M3 4v4M21 4v4')],
 eyedropper:[path('m3 21 2-5L17 4l3 3L8 19ZM15 6l3 3m-1-8 6 6')],
 'color-sampler':[path('M12 16a4 4 0 1 1-8 0 4 4 0 1 1 8 0M8 10v12M2 16h12m0-4 7-7-2-2-7 7m0 0 3 3')],
 ruler:[path('M3 7h18v10H3ZM6 7v4m4-4v6m4-6v4m4-4v6')]
}
export function editorToolIcon(tool:string,variant?:string):ToolIconGeometry|undefined {
 let key=tool
 if(tool==='marquee')key=variant==='single-row'?'marquee-single-row':variant==='single-column'?'marquee-single-column':variant==='ellipse'?'marquee-ellipse':'marquee-rectangle'
 else if(tool==='lasso')key=variant==='magnetic'||variant==='lasso-magnetic'?'lasso-magnetic':variant==='polygon'||variant==='lasso-polygon'?'lasso-polygon':'lasso-freehand'
 else if(tool==='crop')key=variant==='perspective'||variant==='perspective-crop'?'crop-perspective':variant==='straighten'?'crop-straighten':'crop'
 else if(tool==='heal')key=variant==='heal'?'heal-sampled':'heal-spot'
 const strokes=geometry[key];return strokes?{key,strokes}:undefined
}
