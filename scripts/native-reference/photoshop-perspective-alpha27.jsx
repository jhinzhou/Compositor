#target photoshop
/* alpha.27 bounded native experiment, 20 fresh owned documents.
 * Explicit interpolation is a CANDIDATE per-operation ActionManager field.
 * Different requested names are NOT proof that Photoshop honored it: compare
 * decoded output hashes and returned descriptor fields after actual execution.
 * No preferences or notifiers are changed. No automatic+Image Size stages.
 * All user documents, the previous active document and dialogs are retained.
 */
(function () {
 var inputRoot='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/alpha27-perspective/inputs';
 var base=new Folder('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/perspective-alpha27');
 var cases=[],methods=['bicubicAutomatic','bicubic','bicubicSharper','bicubicSmoother'];
 var full=[[0,0],[384,0],[384,256],[0,256]],calibration=[[28,18],[348,37],[323,234],[37,222]];
 function add(name,corners,target,method,sourceVariant,normalLayer,referenceRole){cases.push({name:name,corners:corners,target:target,method:method,sourceVariant:sourceVariant||'calibration-opaque',normalLayer:!!normalLayer,referenceRole:referenceRole||'calibration'});}
 for(var m=0;m<methods.length;m++){
  add('axis-down-'+methods[m],full,[300,200],methods[m]);
  add('axis-up-'+methods[m],full,[600,400],methods[m]);
  add('perspective-down-'+methods[m],calibration,[300,200],methods[m]);
 }
 // Same opaque RGB on an ordinary layer distinguishes background edge policy.
 add('axis-up-normal-layer',full,[600,400],'bicubicAutomatic','calibration-opaque',true);
 // Root retains this independent reference until calibration decisions freeze.
 add('unseen-alpha-perspective-up',[[7,12],[367,24],[354,248],[16,238]],[500,320],'bicubicAutomatic','holdout-alpha',false,'holdout');
 var autoQuads=[
  {name:'gentle-left',q:[[42,26],[343,38],[326,229],[52,222]]},
  {name:'gentle-right',q:[[41,38],[342,26],[332,222],[58,229]]},
  {name:'strong-left',q:[[66,17],[350,65],[300,239],[34,209]]},
  {name:'strong-right',q:[[34,65],[318,17],[350,209],[84,239]]},
  {name:'gentle-translate',q:[[54,17],[355,29],[338,220],[64,213]]},
  {name:'gentle-half-turn',q:[[58,27],[332,34],[342,230],[41,218]]}
 ];
 for(var i=0;i<autoQuads.length;i++)add('auto-'+autoQuads[i].name,autoQuads[i].q,null,null,'calibration-opaque',false,'size-holdout');
 function quote(value) {return '"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})+'"';}
 function json(value) {if(value===null)return 'null';if(typeof value==='number')return isFinite(value)?String(value):quote(String(value));if(typeof value==='string')return quote(value);if(typeof value==='boolean')return value?'true':'false';if(value instanceof Array){var parts=[];for(var i=0;i<value.length;i++)parts.push(json(value[i]));return '['+parts.join(',')+']';}var parts=[];for(var key in value)if(value.hasOwnProperty(key))parts.push(quote(key)+':'+json(value[key]));return '{'+parts.join(',')+'}';}
 function write(name,value) {var file=new File(base.fsName+'/'+name);file.encoding='UTF8';if(!file.open('w'))throw Error('Cannot write experiment record.');file.write(json(value));file.close();}

 if(cases.length>20)throw Error('Native experiment case limit exceeded.');
 if(!base.exists&&!base.create())throw Error('Cannot create native output directory.');
 var initial=app.documents.length?app.activeDocument:null,previousDialogs=app.displayDialogs,owned=null,runID=String(new Date().getTime())+'-'+String(Math.floor(Math.random()*1000000));
 var record={photoshopVersion:app.version,referenceKind:'native-actionmanager',interpolationPreferenceBefore:String(app.preferences.interpolation),sourceInputs:inputRoot,limits:['Interpolation requests require output/descriptor validation; unknown action fields may be silently ignored.','Each case opens a fresh authored source; exported before-source PNG enables actual RGBA verification.','No user preference or notifier writes; direct perspective only, no Image Size stage.','Root retains unseen-alpha and auto geometry references separately until calibration freeze.'],cases:[]};
 function savePNG(doc,name){var output=new File(base.fsName+'/'+name),options=new PNGSaveOptions();options.interlaced=false;doc.saveAs(output,options,true,Extension.LOWERCASE);return output.fsName;}
 function enumValue(desc,key){try{var id=stringIDToTypeID(key);if(!desc||!desc.hasKey(id))return null;return {type:typeIDToStringID(desc.getEnumerationType(id)),value:typeIDToStringID(desc.getEnumerationValue(id))};}catch(ignore){return null;}}
 try {
  app.displayDialogs=DialogModes.NO;
  for(var index=0;index<cases.length;index++) {
   var item=cases[index],source=new File(inputRoot+'/'+item.sourceVariant+'.png'),row={name:item.name,sourceVariant:item.sourceVariant,referenceRole:item.referenceRole,corners:item.corners,requestedTarget:item.target,requestedInterpolation:item.method,referenceKind:'native-actionmanager',interpolationFieldStatus:'UNPROVEN_UNTIL_OUTPUT_COMPARISON',creationMode:item.target?'Direct perspectiveCrop with explicit output dimensions':'Direct perspectiveCrop with no output dimensions; native automatic size'};
   if(!source.exists)throw Error('Missing authored source '+source.fsName);
   try {
    var ownedInput=new File(base.fsName+'/alpha27-owned-input-'+runID+'-'+index+'.png');
    if(ownedInput.exists||!source.copy(ownedInput.fsName))throw Error('Cannot create fresh owned input copy.');
    owned=app.open(ownedInput);owned.selection.deselect();row.ownedInputPath=ownedInput.fsName;
    row.sourcePath=source.fsName;row.sourceWidth=owned.width.as('px');row.sourceHeight=owned.height.as('px');row.backgroundAtOpen=owned.activeLayer.isBackgroundLayer;
    if(item.normalLayer&&owned.activeLayer.isBackgroundLayer){var original=owned.activeLayer;var copy=original.duplicate();original.remove();owned.activeLayer=copy;}
    row.backgroundBeforeCrop=owned.activeLayer.isBackgroundLayer;row.nativeSourcePath=savePNG(owned,item.name+'-source.png');
    var action=new ActionDescriptor(),quad=new ActionDescriptor(),center=new ActionDescriptor();
    center.putUnitDouble(stringIDToTypeID('horizontal'),stringIDToTypeID('pixelsUnit'),row.sourceWidth/2);
    center.putUnitDouble(stringIDToTypeID('vertical'),stringIDToTypeID('pixelsUnit'),row.sourceHeight/2);
    quad.putObject(stringIDToTypeID('center'),stringIDToTypeID('paint'),center);
    for(var corner=0;corner<4;corner++){var point=new ActionDescriptor();point.putUnitDouble(stringIDToTypeID('horizontal'),stringIDToTypeID('pixelsUnit'),item.corners[corner][0]);point.putUnitDouble(stringIDToTypeID('vertical'),stringIDToTypeID('pixelsUnit'),item.corners[corner][1]);quad.putObject(stringIDToTypeID('quadCorner'+corner),stringIDToTypeID('offset'),point);}
    action.putObject(stringIDToTypeID('to'),stringIDToTypeID('quadrilateral'),quad);
    if(item.target){action.putUnitDouble(stringIDToTypeID('width'),stringIDToTypeID('pixelsUnit'),item.target[0]);action.putUnitDouble(stringIDToTypeID('height'),stringIDToTypeID('pixelsUnit'),item.target[1]);}
    if(item.method)action.putEnumerated(stringIDToTypeID('interpolation'),stringIDToTypeID('interpolationType'),stringIDToTypeID(item.method));
    var returned=executeAction(stringIDToTypeID('perspectiveCrop'),action,DialogModes.NO);
    row.returnedInterpolation=enumValue(returned,'interpolation');row.width=owned.width.as('px');row.height=owned.height.as('px');row.backgroundAfterCrop=owned.activeLayer.isBackgroundLayer;row.history=owned.activeHistoryState.name;row.geometryVerified=true;row.nativePath=savePNG(owned,item.name+'.png');row.status='NATIVE_OUTPUT_CAPTURED';
   }catch(cause){row.status='NATIVE_CASE_FAILED';row.error=String(cause);}
   finally{if(owned)owned.close(SaveOptions.DONOTSAVECHANGES);owned=null;}
   record.cases.push(row);write('cohort.json',record);
  }
 }catch(cause){record.error=String(cause);write('cohort.json',record);throw cause;}
 finally {
  if(owned)owned.close(SaveOptions.DONOTSAVECHANGES);
  app.displayDialogs=previousDialogs;
  if(initial)try{app.activeDocument=initial;}catch(ignore){}
  record.interpolationPreferenceAfter=String(app.preferences.interpolation);record.userPreferenceUnchanged=record.interpolationPreferenceBefore===record.interpolationPreferenceAfter;write('cohort.json',record);
 }
})();
