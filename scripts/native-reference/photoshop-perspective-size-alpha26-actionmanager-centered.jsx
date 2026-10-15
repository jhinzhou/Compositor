#target photoshop
/* Candidate native-kernel experiment. Run manually through Photoshop Browse.
 * This is an ActionManager reference, not a GUI interaction reference.
 * No width, height or resolution target is supplied. Only task-created documents
 * are edited/closed. Install the scoped perspectiveCrop observer before running.
 * Descriptor structure follows the original r-bin action example on Adobe
 * Community (2021-08-03); actual Photoshop acceptance must be measured locally.
 */
(function () {
 var source = new File('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/inputs/alpha24-retouch-source.png');
 var base = new Folder('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/perspective-size-alpha26-actionmanager-centered');
 var cases = [
  {name:'axis',corners:[[35,25],[236,25],[236,159],[35,159]]},
  {name:'affine',corners:[[80,40],[410,60],[410,260],[80,240]]},
  {name:'old-quad',corners:[[60,40],[430,55],[400,280],[75,260]]},
  {name:'strong-trapezoid',corners:[[90,40],[420,40],[340,270],[140,270]]},
  {name:'opposite-quad',corners:[[30,70],[350,20],[470,250],[70,290]]},
  {name:'old-quad-translate',corners:[[80,20],[450,35],[420,260],[95,240]]},
  {name:'old-quad-mirror',corners:[[82,55],[452,40],[437,260],[112,280]]},
  {name:'old-quad-half-turn',corners:[[112,40],[437,60],[452,280],[82,265]]},
  {name:'camera-valid-holdout',corners:[[65,35],[440,65],[395,285],[80,250]]}
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
