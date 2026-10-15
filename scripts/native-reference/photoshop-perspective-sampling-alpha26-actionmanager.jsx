#target photoshop
/* Candidate native-kernel experiment. Run manually through Photoshop Browse.
 * This is an ActionManager reference, not a GUI interaction reference.
 * No width, height or resolution target is supplied. Only task-created documents
 * are edited/closed. Install the scoped perspectiveCrop observer before running.
 * Descriptor structure follows the original r-bin action example on Adobe
 * Community (2021-08-03); actual Photoshop acceptance must be measured locally.
 */
(function () {
 var source = new File('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/alpha26-sampling/perspective-sampling-calibration.png');
 var base = new Folder('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/perspective-sampling-alpha26-actionmanager');
 var cases = [
 {name:'exact-ui-quad-down',corners:[[20,0],[351,40],[321,239],[25,221]],target:[300,200]},
 {name:'exact-ui-quad-up',corners:[[20,0],[351,40],[321,239],[25,221]],target:[600,400]},
 {name:'calibration-requested',corners:[[20,15],[351,40],[321,239],[25,221]],target:[300,200]},
 {name:'axis-full-down',corners:[[0,0],[384,0],[384,256],[0,256]],target:[300,200]}
 ];
 function quote(value) {return '"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})+'"';}
 function json(value) {if(value===null)return 'null';if(typeof value==='number')return isFinite(value)?String(value):quote(String(value));if(typeof value==='string')return quote(value);if(typeof value==='boolean')return value?'true':'false';if(value instanceof Array){var parts=[];for(var i=0;i<value.length;i++)parts.push(json(value[i]));return '['+parts.join(',')+']';}var parts=[];for(var key in value)if(value.hasOwnProperty(key))parts.push(quote(key)+':'+json(value[key]));return '{'+parts.join(',')+'}';}
 function write(name,value) {var file=new File(base.fsName+'/'+name);file.encoding='UTF8';if(!file.open('w'))throw Error('Cannot write experiment record.');file.write(json(value));file.close();}
 if(!source.exists)throw Error('Missing original alpha24 source PNG.');
 if(!base.exists&&!base.create())throw Error('Cannot create experiment directory.');
 var initial=app.documents.length?app.activeDocument:null,previousDialogs=app.displayDialogs,owned=null;
 var record={photoshopVersion:app.version,referenceKind:'native-actionmanager',creationMode:'quadrilateral descriptor with native GUI paint center at source midpoint; no output dimensions supplied',sourcePath:source.fsName,source:null,cases:[]};
 try {
  app.displayDialogs=DialogModes.NO;
  for(var index=0;index<cases.length;index++) {
   var item=cases[index];owned=app.open(source);owned.activeLayer.name='alpha26-tools-owned';owned.selection.deselect();
   if(!record.source)record.source={width:owned.width.as('px'),height:owned.height.as('px')};
   var action=new ActionDescriptor(),quad=new ActionDescriptor(),center=new ActionDescriptor();
   center.putUnitDouble(stringIDToTypeID('horizontal'),stringIDToTypeID('pixelsUnit'),owned.width.as('px')/2);
   center.putUnitDouble(stringIDToTypeID('vertical'),stringIDToTypeID('pixelsUnit'),owned.height.as('px')/2);
   quad.putObject(stringIDToTypeID('center'),stringIDToTypeID('paint'),center);
   for(var corner=0;corner<4;corner++) {
    var point=new ActionDescriptor();
    point.putUnitDouble(stringIDToTypeID('horizontal'),stringIDToTypeID('pixelsUnit'),item.corners[corner][0]);
    point.putUnitDouble(stringIDToTypeID('vertical'),stringIDToTypeID('pixelsUnit'),item.corners[corner][1]);
    quad.putObject(stringIDToTypeID('quadCorner'+corner),stringIDToTypeID('offset'),point);
   }
   action.putObject(stringIDToTypeID('to'),stringIDToTypeID('quadrilateral'),quad);
   action.putUnitDouble(stringIDToTypeID('width'),stringIDToTypeID('pixelsUnit'),item.target[0]);action.putUnitDouble(stringIDToTypeID('height'),stringIDToTypeID('pixelsUnit'),item.target[1]);
   executeAction(stringIDToTypeID('perspectiveCrop'),action,DialogModes.NO);
   var output=new File(base.fsName+'/'+item.name+'.png'),options=new PNGSaveOptions();options.interlaced=false;
   owned.saveAs(output,options,true,Extension.LOWERCASE);
   record.cases.push({name:item.name,corners:item.corners,width:owned.width.as('px'),height:owned.height.as('px'),history:owned.activeHistoryState.name,geometryVerified:true,referenceKind:'native-actionmanager',creationMode:record.creationMode,nativePath:output.fsName});
   write('cohort.json',record);
   owned.close(SaveOptions.DONOTSAVECHANGES);owned=null;
  }
 } catch(cause) {record.error=String(cause);write('cohort.json',record);throw cause;}
 finally {
  if(owned&&owned.activeLayer.name==='alpha26-tools-owned')owned.close(SaveOptions.DONOTSAVECHANGES);
  app.displayDialogs=previousDialogs;
  if(initial)try{app.activeDocument=initial;}catch(ignore){}
 }
})();
