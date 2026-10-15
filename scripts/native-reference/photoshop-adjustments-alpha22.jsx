#target photoshop
/* Self-authored fixtures only. Original active document remains untouched. */
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native',out=root+'/outputs/adjustments-alpha22',before=app.documents.length?app.activeDocument:null,oldDialogs=app.displayDialogs;
 var log=new File(out+'/native-results.tsv');log.encoding='UTF-8';log.open('w');log.writeln('Photoshop\t'+app.version);app.displayDialogs=DialogModes.NO;
 try{for(var depth=8;depth<=16;depth+=8)for(var i=0;i<4;i++){
  var d=null;try{d=app.open(new File(root+'/inputs/adjustments-alpha22-source.png'));if(depth===16)d.bitsPerChannel=BitsPerChannelType.SIXTEEN;
   var kind=i<2?'threshold':'posterize',value=i===0?128:i===1?64:i===2?4:8;
   if(kind==='threshold')d.activeLayer.threshold(value);else d.activeLayer.posterize(value);
   var name=kind+'-'+value+'-'+depth;d.saveAs(new File(out+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);log.writeln(name+'\tPASS\t'+d.bitsPerChannel);
  }catch(e){log.writeln('FAIL\t'+e);}finally{if(d)d.close(SaveOptions.DONOTSAVECHANGES);}
 }}finally{app.displayDialogs=oldDialogs;if(before)app.activeDocument=before;log.close();}
})();
