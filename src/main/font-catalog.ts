import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const execute=promisify(execFile)
export interface InstalledFont {family:string;postscriptName?:string;fullName?:string;style?:string}
let cached:Promise<InstalledFont[]>|undefined
/** Fixed OS inventory commands; no executable, script or path accepted from callers. */
export function installedFonts():Promise<InstalledFont[]>{return cached??=readFonts()}
async function readFonts():Promise<InstalledFont[]>{
 const options={timeout:20000,maxBuffer:24*1024*1024,windowsHide:true}
 try{
  if(process.platform==='darwin'){
   const {stdout}=await execute('/usr/sbin/system_profiler',['SPFontsDataType','-json'],options),data=JSON.parse(stdout),fonts:InstalledFont[]=[]
   const visit=(value:unknown):void=>{if(Array.isArray(value)){value.forEach(visit);return}if(!value||typeof value!=='object')return;const item=value as Record<string,unknown>;if(typeof item.family==='string')fonts.push({family:item.family,postscriptName:typeof item.postscript_name==='string'?item.postscript_name:undefined,fullName:typeof item.full_name==='string'?item.full_name:undefined,style:typeof item.style==='string'?item.style:undefined});Object.values(item).filter(v=>typeof v==='object').forEach(visit)};visit(data);return fonts.slice(0,4096)
  }
  const result=process.platform==='win32'?await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name'],options):await execute('fc-list',['--format=%{family}\n'],options)
  return [...new Set(result.stdout.split(/\r?\n/).flatMap(line=>line.split(',')).map(f=>f.trim()).filter(Boolean))].slice(0,4096).map(family=>({family}))
 }catch{return [{family:'Arial'},{family:'Helvetica'},{family:'Times New Roman'},{family:'Courier New'}]}
}
