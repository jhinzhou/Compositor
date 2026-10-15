#target photoshop
(function(){
 var base='/Users/zhoujin/Documents/PS/Compositor_Electron',source=new File(base+'/artifacts/photoshop-native/inputs/alpha26-wood-background.jpg'),folder=new Folder(base+'/artifacts/photoshop-native/outputs/tools-alpha26-third-natural-diffusion'),owned=new File(folder.fsName+'/owned-mask-source-'+String(new Date().getTime())+'.jpg'),opened=null,d=null,previous=null,oldDialogs=app.displayDialogs;
 try{previous=app.activeDocument;}catch(ignore){}
 try{
  app.displayDialogs=DialogModes.NO;if(!folder.exists&&!folder.create())throw Error('Cannot create owned mask folder');if(!source.copy(owned.fsName))throw Error('Cannot create fresh owned source');opened=app.open(owned);d=opened.duplicate('alpha26-heldout-mask-owned',false);opened.close(SaveOptions.DONOTSAVECHANGES);opened=null;app.activeDocument=d;
  if(d.mode!==DocumentMode.RGB||d.bitsPerChannel!==BitsPerChannelType.EIGHT)throw Error('Expected owned RGB8 source');if(d.activeLayer.isBackgroundLayer)d.activeLayer.isBackgroundLayer=false;
  var black=new SolidColor(),white=new SolidColor();black.rgb.red=black.rgb.green=black.rgb.blue=0;white.rgb.red=white.rgb.green=white.rgb.blue=255;
  d.selection.selectAll();d.selection.fill(black,ColorBlendMode.NORMAL,100,false);d.selection.deselect();d.selection.select([[185,80],[220,78],[234,101],[222,133],[192,138],[174,111]],SelectionType.REPLACE,0,true);d.selection.fill(white,ColorBlendMode.NORMAL,100,false);d.selection.deselect();var png=new PNGSaveOptions();png.compression=6;png.interlaced=false;d.saveAs(new File(folder.fsName+'/selection-mask.png'),png,true,Extension.LOWERCASE);
  return 'Saved exact native heldout selection mask '+d.width.as('px')+'x'+d.height.as('px');
 }finally{if(d){try{d.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}}if(opened){try{opened.close(SaveOptions.DONOTSAVECHANGES);}catch(ignore){}}owned.remove();app.displayDialogs=oldDialogs;if(previous){try{app.activeDocument=previous;}catch(ignore){}}}
}());
