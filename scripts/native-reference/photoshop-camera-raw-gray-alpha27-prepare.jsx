#target photoshop
(function(){
 var input=new File('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/alpha27-camera-raw-native/gray-source.png'),opened=null;
 if($.global.alpha27GrayOwned)throw Error('Owned gray document already exists.');
 $.global.alpha27GrayPrevious=app.documents.length?app.activeDocument:null;
 try{opened=app.open(input);var d=opened.duplicate('alpha27-camera-raw-gray-owned',false);opened.close(SaveOptions.DONOTSAVECHANGES);opened=null;$.global.alpha27GrayOwned=d;app.activeDocument=d;d.activeLayer.name='alpha27-camera-raw-owned';d.selection.deselect();}
 finally{if(opened)opened.close(SaveOptions.DONOTSAVECHANGES);}
})();
