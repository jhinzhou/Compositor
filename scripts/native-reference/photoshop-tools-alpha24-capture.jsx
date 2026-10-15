#target photoshop
(function(){
 var previousDialogs=app.displayDialogs;app.displayDialogs=DialogModes.NO;var d=app.activeDocument;if(d.activeLayer.name!=='alpha24-tools-owned')throw Error('Only owned alpha24 reference document may be captured');
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/tools-alpha24',folder=new Folder(root);if(!folder.exists)folder.create();
 var name='capture-'+new Date().getTime();d.saveAs(new File(root+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
 var f=new File(root+'/'+name+'.txt');f.encoding='UTF-8';f.open('w');f.writeln('Photoshop='+app.version+' width='+d.width.as('px')+' height='+d.height.as('px'));try{f.writeln('selection='+d.selection.bounds)}catch(e){f.writeln('selection=none')}
 f.writeln('activeHistory='+d.activeHistoryState.name);for(var h=0;h<d.historyStates.length;h++)f.writeln('history='+d.historyStates[h].name);f.writeln('samples='+d.colorSamplers.length);for(var i=0;i<d.colorSamplers.length;i++){var s=d.colorSamplers[i];f.writeln('sample='+s.position+' RGB='+s.color.rgb.red+','+s.color.rgb.green+','+s.color.rgb.blue)}
 var r=new ActionReference();r.putEnumerated(stringIDToTypeID('document'),stringIDToTypeID('ordinal'),stringIDToTypeID('targetEnum'));f.writeln(executeActionGet(r).toStream());f.close();
 app.displayDialogs=previousDialogs;
})();
