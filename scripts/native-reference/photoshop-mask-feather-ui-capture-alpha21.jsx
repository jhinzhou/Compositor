#target photoshop
/* Captures only the prepared disposable reference; verifies live properties. */
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/mask-feather-ui-study-alpha21',d=app.activeDocument,c=charIDToTypeID,s=stringIDToTypeID;
 if(!/^alpha21-mask-reference(?:-(?:edge|inverse|hole))?$/.test(d.activeLayer.name))throw Error('Prepared reference must be active');
 var r=new ActionReference();r.putEnumerated(c('Lyr '),c('Ordn'),c('Trgt'));var descriptor=executeActionGet(r),density=descriptor.getInteger(s('userMaskDensity')),feather=descriptor.getUnitDoubleValue(s('userMaskFeather'));
 var shape=d.activeLayer.name.replace('alpha21-mask-reference','').replace('-','')||'center';
 var name=shape+'-densityByte'+density+'-feather'+feather,log=new File(root+'/native-results.tsv');log.encoding='UTF-8';log.open('a');log.writeln(name+'\tPARAMS\tPhotoshop='+app.version+'\tdensityByte='+density+'\tfeather='+feather);
 var po=new PhotoshopSaveOptions();po.layers=true;po.alphaChannels=true;d.saveAs(new File(root+'/'+name+'.psd'),po,true,Extension.LOWERCASE);d.saveAs(new File(root+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 log.writeln(name+'\tPASS\t'+d.width.as('px')+'x'+d.height.as('px'));log.close();
})();
