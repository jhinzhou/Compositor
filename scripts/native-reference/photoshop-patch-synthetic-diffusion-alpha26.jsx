/* Owned native calibration documents only. Do not invoke from a product runtime.
 * Run by the root operator in Photoshop after reviewing the exact descriptor.
 * No user documents, presets, preferences or current tool options are changed. */
#target photoshop
(function () {
 var base='/Users/zhoujin/Documents/PS/Compositor_Electron',sourceFile=new File(base+'/artifacts/photoshop-native/inputs/alpha24-retouch-source.png'),out=new Folder(base+'/artifacts/photoshop-native/outputs/tools-alpha26-synthetic-diffusion'),stamp=String(new Date().getTime()),s=stringIDToTypeID;
 if(!sourceFile.exists)throw new Error('Owned authored synthetic source is missing.');if(!out.exists&&!out.create())throw new Error('Cannot create owned calibration output folder.');
 var enums=[1,5,7],points=[[335,135],[386,135],[386,186],[335,186]],oldDialogs=app.displayDialogs,oldActive=null;
 try{oldActive=app.activeDocument;}catch(ignore){}
 function savePNG(doc,name){var options=new PNGSaveOptions();options.compression=6;options.interlaced=false;doc.saveAs(new File(out.fsName+'/'+name),options,true,Extension.LOWERCASE);}
 function textFile(name,body){var f=new File(out.fsName+'/'+name);f.encoding='UTF8';if(!f.open('w'))throw new Error('Cannot write native calibration metadata.');f.write(body);f.close();}
 function history(doc){var lines=[];for(var i=0;i<doc.historyStates.length;i++)lines.push('history='+doc.historyStates[i].name);return lines.join('\n');}
 function bounds(doc){try{var b=doc.selection.bounds;return [b[0].as('px'),b[1].as('px'),b[2].as('px'),b[3].as('px')].join(',');}catch(ignore){return 'none';}}
 var summary=['Photoshop='+app.version,'cohort=alpha26-synthetic-explicit-healSmoothFactor','source=self-authored alpha24-retouch-source.png; no public photograph','offset=-160,0','patchMode=patchNormal','useSource=true','transparency=false','parameter=healSmoothFactor integer from live Photoshop currentToolOptions; output differences still need verification'];
 try{
  app.displayDialogs=DialogModes.NO;
  for(var i=0;i<enums.length;i++){
   var parameter=enums[i],ownedInput=new File(out.fsName+'/owned-source-'+stamp+'-'+i+'.png'),opened=null,d=null;
   if(!sourceFile.copy(ownedInput.fsName))throw new Error('Cannot create fresh owned source copy.');
   try{
    opened=app.open(ownedInput);d=opened.duplicate('alpha26-patch-diffusion-'+stamp+'-'+parameter,false);opened.close(SaveOptions.DONOTSAVECHANGES);opened=null;app.activeDocument=d;
    if(d.mode!==DocumentMode.RGB||d.bitsPerChannel!==BitsPerChannelType.EIGHT)throw new Error('Expected RGB8 native JPEG source.');
    if(d.activeLayer.isBackgroundLayer)d.activeLayer.isBackgroundLayer=false;
    d.selection.select(points,SelectionType.REPLACE,0,true);savePNG(d,'diffusion-'+parameter+'-source.png');
    var before=d.activeHistoryState.name,desc=new ActionDescriptor(),offset=new ActionDescriptor(),target=new ActionReference();target.putProperty(s('channel'),s('selection'));desc.putReference(s('null'),target);offset.putUnitDouble(s('horizontal'),s('pixelsUnit'),-160);offset.putUnitDouble(s('vertical'),s('pixelsUnit'),0);desc.putObject(s('from'),s('offset'),offset);desc.putEnumerated(s('patchMode'),s('patchModeType'),s('patchNormal'));desc.putBoolean(s('useSource'),true);desc.putBoolean(s('transparency'),false);desc.putInteger(s('healSmoothFactor'),parameter);
    executeAction(s('patchSelection'),desc,DialogModes.NO);
    savePNG(d,'diffusion-'+parameter+'-output.png');textFile('diffusion-'+parameter+'.txt',['Photoshop='+app.version,'width='+d.width.as('px'),'height='+d.height.as('px'),'selection='+bounds(d),'healSmoothFactor='+parameter,'patchMode=patchNormal','useSource=true','transparency=false','offset=-160,0','beforeHistory='+before,'activeHistory='+d.activeHistoryState.name,history(d),'execution=explicit Photoshop Action Manager descriptor; not GUI drag','effectiveDiffusion=explicit healSmoothFactor; verify pixel differences'].join('\n')+'\n');summary.push('completed='+parameter+'; activeHistory='+d.activeHistoryState.name);
   }finally{if(d){try{d.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}}if(opened){try{opened.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}}ownedInput.remove();}
  }
  textFile('cohort-'+stamp+'.txt',summary.join('\n')+'\n');
 }catch(error){summary.push('error='+error.message);textFile('cohort-'+stamp+'-error.txt',summary.join('\n')+'\n');throw error;
 }finally{app.displayDialogs=oldDialogs;if(oldActive){try{app.activeDocument=oldActive;}catch(ignore){}}}
 return summary.join('\n');
}());
