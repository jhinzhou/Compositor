#target photoshop
(function(){
 var base=new Folder('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/crop-events-alpha28');if(!base.exists)base.create();
 var eventFile=new File('/Users/zhoujin/Documents/PS/Compositor_Electron/scripts/native-reference/photoshop-crop-events-alpha28.jsx'),state=new File(base.fsName+'/observer-state.txt'),installed=false,events={};
 for(var i=0;i<app.notifiers.length;i++)if(app.notifiers[i].eventFile.fsName===eventFile.fsName){installed=true;events[String(app.notifiers[i].event)]=true;}
 if(!installed){state.encoding='UTF8';if(!state.open('w'))throw Error('Cannot preserve original Photoshop notifier state.');state.write(app.notifiersEnabled?'true':'false');state.close();}
 if(!events.Crop)app.notifiers.add('Crop',eventFile);
 if(!events.perspectiveCrop)app.notifiers.add('perspectiveCrop',eventFile);
 if(!events.patchSelection)app.notifiers.add('patchSelection',eventFile);
 app.notifiersEnabled=true;
 var status=new File(base.fsName+'/install-status.txt');status.encoding='UTF8';if(status.open('w')){status.write('Owned Crop and perspectiveCrop observers installed. Original notifiersEnabled retained in observer-state.txt. Existing notifier entries preserved.');status.close();}
})();
