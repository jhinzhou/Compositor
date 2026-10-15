/** Local component labels kept together so root integration does not need to
 * edit the shared application catalog concurrently. */
export const INFO_TOOL_LABELS={
 '8-bit source · 16-bit composite':'8 位源 · 16 位合成','Color samplers':'颜色取样器','Sample size':'取样大小','Point sample':'单点取样','Sample source':'取样来源','Merged high-depth composite':'高位深合成','Current layer source':'当前图层原始像素','Units':'单位','Clear samples':'清除取样点','Remove sample':'移除取样点','No color samples':'暂无颜色取样点','Outside source':'源图范围外','Transparent':'透明','Ruler tool':'标尺工具','Clear ruler':'清除测量','Draw a ruler line':'拖动绘制测量线','Color readings use canonical pixels; current layer ignores opacity, masks and effects.':'颜色读数来自原始像素；当前图层模式不计入不透明度、蒙版和效果。','Shift constrains to 45°. Alt-drag an endpoint adds a protractor arm.':'Shift 约束到 45°；Alt 拖动端点增加量角臂。','Length':'长度','Angle':'角度','Second length':'第二段长度','Included angle':'夹角','Reading pending':'等待读数','Delete sample with Alt-click; drag to move.':'Alt 单击删除取样点；拖动可移动。','Full-range 16-bit':'完整 16 位范围','Floating HDR':'浮点 HDR','Pixels':'像素'
} as const
export function infoToolLabel(locale:string,key:keyof typeof INFO_TOOL_LABELS):string {return locale==='zh-CN'?INFO_TOOL_LABELS[key]:key}
