#target photoshop
/* Self-authored opaque-white diagnostic only. Each case owns one temporary
 * document; never iterate or close documents that were open before this script. */
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native',out=root+'/outputs/mask-properties-study',before=app.documents.length?app.activeDocument:null,dialogs=app.displayDialogs,units=app.preferences.rulerUnits,foreground=app.foregroundColor,background=app.backgroundColor;
 new Folder(out).create();var log=new File(out+'/native-results.tsv');log.encoding='UTF-8';log.open('w');log.writeln('Photoshop\t'+app.version);
 function c(value){return charIDToTypeID(value);}function s(value){return stringIDToTypeID(value);}
 function rectangle(d,b,type){d.selection.select([[b[0],b[1]],[b[0]+b[2],b[1]],[b[0]+b[2],b[1]+b[3]],[b[0],b[1]+b[3]]],type||SelectionType.REPLACE,0,false);}
 function makeMask(){var desc=new ActionDescriptor(),ref=new ActionReference(),at=new ActionReference();ref.putClass(c('Chnl'));desc.putReference(c('Nw  '),ref);at.putEnumerated(c('Chnl'),c('Chnl'),c('Msk '));desc.putReference(c('At  '),at);desc.putEnumerated(c('Usng'),c('UsrM'),c('RvlS'));executeAction(c('Mk  '),desc,DialogModes.NO);}
 function properties(density,feather){var desc=new ActionDescriptor(),ref=new ActionReference(),values=new ActionDescriptor();ref.putEnumerated(c('Lyr '),c('Ordn'),c('Trgt'));desc.putReference(c('null'),ref);values.putUnitDouble(s('userMaskDensity'),c('#Prc'),density);values.putUnitDouble(s('userMaskFeather'),c('#Pxl'),feather);desc.putObject(c('T   '),c('Lyr '),values);executeAction(c('setd'),desc,DialogModes.NO);}
 function run(name,b,density,feather,extra){var d=null;try{
  d=app.open(new File(root+'/inputs/opaque-white.png'));rectangle(d,b);if(extra==='hole')rectangle(d,[112,80,32,32],SelectionType.DIMINISH);makeMask();d.selection.deselect();
  if(extra==='scale-before')d.resizeImage(UnitValue(512,'px'),UnitValue(384,'px'),null,ResampleMethod.NEARESTNEIGHBOR);
  properties(density,feather);
  if(extra==='scale-after')d.resizeImage(UnitValue(512,'px'),UnitValue(384,'px'),null,ResampleMethod.NEARESTNEIGHBOR);
  var options=new PhotoshopSaveOptions();options.layers=true;options.alphaChannels=true;d.saveAs(new File(out+'/'+name+'.psd'),options,true,Extension.LOWERCASE);
  d.saveAs(new File(out+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
  log.writeln(name+'\tPASS\t'+d.width.as('px')+'x'+d.height.as('px'));
 }catch(e){log.writeln(name+'\tFAIL\t'+e);}finally{if(d)d.close(SaveOptions.DONOTSAVECHANGES);}}
 try{app.displayDialogs=DialogModes.NO;app.preferences.rulerUnits=Units.PIXELS;
  var b=[88,56,80,80];run('center-d100-f0',b,100,0);run('center-d100-f3',b,100,3);run('center-d100-f10',b,100,10);run('center-d50-f0',b,50,0);run('center-d50-f10',b,50,10);run('center-d0-f10',b,0,10);run('edge-d100-f10',[0,32,80,80],100,10);run('hole-d100-f10',[64,32,128,128],100,10,'hole');run('scale-before-d100-f10',b,100,10,'scale-before');run('scale-after-d100-f10',b,100,10,'scale-after');
 }finally{log.close();app.displayDialogs=dialogs;app.preferences.rulerUnits=units;app.foregroundColor=foreground;app.backgroundColor=background;if(before)app.activeDocument=before;}
})();
