#target photoshop
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native';
 if(app.documents.length)$.global.alpha21CropBefore=app.activeDocument;
 var d=app.open(new File(root+'/inputs/crop-alpha20-source.png'));
 if(d.activeLayer.isBackgroundLayer)d.activeLayer.isBackgroundLayer=false;
 d.activeLayer.name='alpha21-crop-ui';$.global.alpha21CropDoc=d;
})();
