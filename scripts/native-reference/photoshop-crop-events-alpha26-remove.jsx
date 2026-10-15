#target photoshop
(function(){
 var base=new Folder('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/crop-events-alpha26'),eventFile=new File('/Users/zhoujin/Documents/PS/Compositor_Electron/scripts/native-reference/photoshop-crop-events-alpha26.jsx'),state=new File(base.fsName+'/observer-state.txt'),removed=0;
 for(var i=app.notifiers.length-1;i>=0;i--)if(app.notifiers[i].eventFile.fsName===eventFile.fsName){app.notifiers[i].remove();removed++;}
 var previous=null;if(state.exists){state.encoding='UTF8';if(state.open('r')){previous=state.read();state.close();if(previous==='true'||previous==='false'){app.notifiersEnabled=previous==='true';state.remove();}}}
 var status=new File(base.fsName+'/remove-status.txt');status.encoding='UTF8';if(status.open('w')){status.write('Removed owned entries='+removed+'; restored previous notifiersEnabled='+previous+'; actual notifiersEnabled='+app.notifiersEnabled+'; user notifier entries retained.');status.close();}
})();
