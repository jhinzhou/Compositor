#target photoshop
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/gui-alpha28';var out=new Folder(root);if(!out.exists&&!out.create())throw Error('Cannot create owned output');
 for(var i=0;i<app.documents.length;i++)if(app.documents[i].name.indexOf('alpha28-gui-owned')===0)throw Error('Existing task GUI document needs explicit cleanup');
 var previous=app.documents.length?app.activeDocument:null,opened=null,d=null;
 try{opened=app.open(new File('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/inputs/alpha28-probe-owned-slanted-feather25.png'));d=opened.duplicate('alpha28-gui-owned-patch-feather25',false);opened.close(SaveOptions.DONOTSAVECHANGES);opened=null;app.activeDocument=d;d.activeLayer.name='alpha28-tools-owned';d.selection.select([[189,52],[238,63],[252,97],[213,120],[179,85]],SelectionType.REPLACE,2.5,true);var f=new File(root+'/owned-state.txt');f.encoding='UTF8';if(!f.open('w'))throw Error('Cannot save ownership');f.write('previousName='+ (previous?previous.name:'')+'\nownedName='+d.name+'\n');f.close();}
 catch(e){if(opened)opened.close(SaveOptions.DONOTSAVECHANGES);if(d)d.close(SaveOptions.DONOTSAVECHANGES);if(previous)app.activeDocument=previous;throw e;}
})();
