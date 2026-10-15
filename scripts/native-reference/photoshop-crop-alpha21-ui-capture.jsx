#target photoshop
(function(){
 var d=app.activeDocument;if(!/^alpha21-crop-ui/.test(d.activeLayer.name))throw Error('Expected self-authored crop reference');
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/crop-alpha21-ui';var folder=new Folder(root);if(!folder.exists)folder.create();
 var name='capture-'+new Date().getTime(),f=new File(root+'/'+name+'.txt');f.encoding='UTF-8';f.open('w');
 f.writeln('Photoshop='+app.version+' width='+d.width.as('px')+' height='+d.height.as('px'));f.writeln('layer='+d.activeLayer.name+' bounds='+d.activeLayer.bounds);
 var ref=new ActionReference();ref.putEnumerated(stringIDToTypeID('layer'),stringIDToTypeID('ordinal'),stringIDToTypeID('targetEnum'));f.writeln(executeActionGet(ref).toStream());f.close();
 var o=new PhotoshopSaveOptions();o.layers=true;d.saveAs(new File(root+'/'+name+'.psd'),o,true,Extension.LOWERCASE);d.saveAs(new File(root+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 $.global.alpha21CropCapture=name;
})();
