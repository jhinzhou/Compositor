import {lstat,opendir} from 'node:fs/promises'
import {basename,extname,join} from 'node:path'
import {RAW_EXTENSIONS} from '../core/foreign-import'
import {EditorError} from '../shared/contracts'

const imageExtensions=new Set(['png','jpg','jpeg','tif','tiff','psd','psb','bmp','gif','webp','exr','hdr','rgbe','svg','heic','heif','hif',...RAW_EXTENSIONS])
const packageExtensions=new Set(['.comp','.app','.bundle','.framework'])
const nameOrder=new Intl.Collator('en',{numeric:true,sensitivity:'base'})
export const MAX_FOLDER_IMPORT_IMAGES=256

/** Mirrors upstream ImageFolder's direct children and natural filename order.
 * No recursion or package expansion; decoded contents still pass the existing
 * importer. A bounded enumeration rejects over-budget folders before import. */
export async function expandImageImports(inputs:string[]):Promise<{paths:string[];emptyFolders:string[]}>{
  const paths:string[]=[],emptyFolders:string[]=[]
  for(const input of inputs){
    const info=await lstat(input)
    if(!info.isDirectory()||packageExtensions.has(extname(input).toLowerCase()))paths.push(input)
    else {
      const children:string[]=[];let scanned=0
      for await(const entry of await opendir(input)){
        if(++scanned>10_000)throw new EditorError('RESOURCE_LIMIT','Image folder enumeration exceeds the 10000-entry budget.')
        if(entry.name.startsWith('.')||!entry.isFile()||!imageExtensions.has(extname(entry.name).slice(1).toLowerCase()))continue
        children.push(entry.name)
        if(children.length+paths.length>MAX_FOLDER_IMPORT_IMAGES)throw new EditorError('RESOURCE_LIMIT','Import at most 256 images from folders at a time.')
      }
      children.sort((a,b)=>nameOrder.compare(a,b)||a.localeCompare(b,'en'))
      if(!children.length)emptyFolders.push(basename(input))
      paths.push(...children.map(name=>join(input,name)))
    }
    if(paths.length>MAX_FOLDER_IMPORT_IMAGES)throw new EditorError('RESOURCE_LIMIT','Import at most 256 images from folders at a time.')
  }
  return {paths,emptyFolders}
}
