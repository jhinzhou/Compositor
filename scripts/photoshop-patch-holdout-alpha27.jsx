#target photoshop
(function(){
 var base='/Users/zhoujin/Documents/PS/Compositor_Electron',source=new File(base+'/artifacts/photoshop-native/inputs/alpha27-soft-domain-holdout.png'),out=new Folder(base+'/artifacts/photoshop-native/outputs/tools-alpha27-soft-domain-holdout'),stamp=String(new Date().getTime()),s=stringIDToTypeID,oldDialogs=app.displayDialogs,previous=null;
 try{previous=app.activeDocument;}catch(ignore){}if(!out.exists&&!out.create())throw Error('Cannot create owned probe folder');
 var cases=[
 {id:'slanted-aa',points:[[155,48],[193,66],[198,94],[163,106],[143,78]],feather:0},
 {id:'curved-polygon-aa',points:[[190,76],[188,87],[181,96],[170,100],[159,96],[151,87],[149,76],[151,65],[159,56],[170,52],[181,56],[188,65]],feather:0},
 {id:'slanted-feather2',points:[[155,48],[193,66],[198,94],[163,106],[143,78]],feather:2},
 {id:'slanted-feather6',points:[[155,48],[193,66],[198,94],[163,106],[143,78]],feather:6},
 {id:'lowpeak6-feather8',points:[[169,71],[175,71],[175,77],[169,77]],feather:8},
 {id:'lowpeak14-feather8',points:[[165,67],[179,67],[179,81],[165,81]],feather:8}
 ];
 function savePNG(d,name){var p=new PNGSaveOptions();p.compression=6;p.interlaced=false;d.saveAs(new File(out.fsName+'/'+name),p,true,Extension.LOWERCASE);}
 function text(name,body){var f=new File(out.fsName+'/'+name);f.encoding='UTF8';f.lineFeed='Unix';if(!f.open('w'))throw Error('Cannot write owned probe metadata');f.write(body);f.close();}
 text('execution-entered-'+stamp+'.txt','native entry reached; prepared owned physical sources; no ExtendScript File.copy loop\n');
 try{app.displayDialogs=DialogModes.NO;for(var i=0;i<cases.length;i++){
  var item=cases[i],input=new File(base+'/artifacts/photoshop-native/inputs/alpha27-probe-owned-'+item.id+'.png'),opened=null,d=null,maskDoc=null,ownedChannel=null;if(!input.exists||input.length===0)throw Error('Prepared owned probe input missing or empty: '+input.fsName+'; run generator before native capture');
  try{
   opened=app.open(input);d=opened.duplicate('alpha27-soft-domain-holdout-'+stamp+'-'+item.id,false);opened.close(SaveOptions.DONOTSAVECHANGES);opened=null;app.activeDocument=d;if(Number(d.width.as('px'))!==256||Number(d.height.as('px'))!==192)throw Error('Unexpected owned source dimensions');if(d.activeLayer.isBackgroundLayer)d.activeLayer.isBackgroundLayer=false;savePNG(d,item.id+'-source.png');d.selection.select(item.points,SelectionType.REPLACE,item.feather,true);
   // Store the exact selection on the original owned document before duplicate:
   // duplicate need not preserve active selection, but it copies alpha channels.
   // Load the copied alpha explicitly before generating the mask.
   ownedChannel=d.channels.add();ownedChannel.name='alpha27-owned-selection-'+stamp;d.selection.store(ownedChannel,SelectionType.REPLACE);d.activeChannels=[d.channels[0],d.channels[1],d.channels[2]];maskDoc=d.duplicate('alpha27-independent-mask-owned-'+stamp,false);app.activeDocument=maskDoc;var channel=maskDoc.channels.getByName(ownedChannel.name);maskDoc.selection.load(channel,SelectionType.REPLACE);maskDoc.selection.selectAll();var black=new SolidColor(),white=new SolidColor();black.rgb.red=black.rgb.green=black.rgb.blue=0;white.rgb.red=white.rgb.green=white.rgb.blue=255;maskDoc.activeChannels=[maskDoc.channels[0],maskDoc.channels[1],maskDoc.channels[2]];maskDoc.selection.fill(black,ColorBlendMode.NORMAL,100,false);maskDoc.selection.load(channel,SelectionType.REPLACE);maskDoc.selection.fill(white,ColorBlendMode.NORMAL,100,false);maskDoc.selection.deselect();channel.remove();savePNG(maskDoc,item.id+'-mask.png');maskDoc.close(SaveOptions.DONOTSAVECHANGES);maskDoc=null;app.activeDocument=d;ownedChannel.remove();ownedChannel=null;d.activeChannels=[d.channels[0],d.channels[1],d.channels[2]];
   var desc=new ActionDescriptor(),target=new ActionReference(),offset=new ActionDescriptor();target.putProperty(s('channel'),s('selection'));desc.putReference(s('null'),target);offset.putUnitDouble(s('horizontal'),s('pixelsUnit'),-108);offset.putUnitDouble(s('vertical'),s('pixelsUnit'),28);desc.putObject(s('from'),s('offset'),offset);desc.putEnumerated(s('patchMode'),s('patchModeType'),s('patchNormal'));desc.putBoolean(s('useSource'),true);desc.putBoolean(s('transparency'),false);desc.putInteger(s('healSmoothFactor'),5);var error='';try{executeAction(s('patchSelection'),desc,DialogModes.NO);}catch(e){error=e.message;}savePNG(d,item.id+'-output.png');text(item.id+'.txt',['Photoshop='+app.version,'id='+item.id,'source=project self-authored procedural texture; not a public-domain photo','offset=-108,28','nativePoints='+item.points.join(';'),'nativeFeather='+item.feather,'healSmoothFactor=5','patchMode=patchNormal','useSource=true','transparency=false','activeHistory='+d.activeHistoryState.name,'error='+error,'provenance=explicit native Photoshop Action Manager; exact selection stored on copied native alpha channel before black/white mask fill'].join('\n')+'\n');
  }finally{if(ownedChannel){try{app.activeDocument=d;ownedChannel.remove();}catch(ignore){}}if(maskDoc){try{maskDoc.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}}if(d){try{d.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}}if(opened){try{opened.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}}/* Prepared immutable owned source kept for safe rerun; only duplicate edited. */}
 }}finally{app.displayDialogs=oldDialogs;if(previous){try{app.activeDocument=previous;}catch(ignore){}}}
 return 'Owned native alpha27 soft-domain holdout completed; check each case history/error';
}());
