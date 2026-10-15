#target photoshop
(function(){
 $.global.alpha23ToolsBefore=app.documents.length?app.activeDocument:null;
 var d=app.open(new File('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/inputs/alpha23-tools-source.png'));
 if(d.activeLayer.isBackgroundLayer)d.activeLayer.isBackgroundLayer=false;
 d.activeLayer.name='alpha23-tools-owned';$.global.alpha23ToolsDoc=d;
})();
