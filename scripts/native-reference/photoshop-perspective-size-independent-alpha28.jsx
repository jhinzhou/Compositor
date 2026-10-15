#target photoshop
/* alpha.28 native background and DOM Image Size controls, 8 fresh owned documents.
 * Explicit interpolation is a CANDIDATE per-operation ActionManager field.
 * Different requested names are NOT proof that Photoshop honored it: compare
 * decoded output hashes and returned descriptor fields after actual execution.
 * No preferences or notifiers are changed. No automatic+Image Size stages.
 * All user documents, the previous active document and dialogs are retained.
 */
(function () {
 var inputRoot='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/alpha28-sampling-inputs';
 var base=new Folder('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/perspective-alpha28-size-independent');
 var cases=[{"name": "independent-strong", "corners": [[74, 32], [441, 103], [407, 345], [28, 276]], "target": null, "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "size-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "independent-half", "corners": [[165.0, 112.0], [348.5, 147.5], [331.5, 268.5], [142.0, 234.0]], "target": null, "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "size-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "independent-larger", "corners": [[52.15999999999997, 12.799999999999983], [463.20000000000005, 92.32], [425.12, 363.36], [0.6399999999999864, 286.08000000000004]], "target": null, "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "size-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "independent-quarter-turn", "corners": [[108, 28], [352, 74], [281, 441], [39, 407]], "target": null, "method": null, "sourceVariant": "size-holdout-quarter-turn", "referenceRole": "size-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "independent-asymmetric", "corners": [[133, 17], [448, 95], [298, 361], [56, 214]], "target": null, "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "size-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "independent-one-vanishing-point", "corners": [[75, 70], [437, 70], [390, 315], [122, 315]], "target": null, "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "size-independent-after-freeze", "operation": "perspectiveCrop"}];
 function quote(value) {return '"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})+'"';}
 function json(value) {if(value===null)return 'null';if(typeof value==='number')return isFinite(value)?String(value):quote(String(value));if(typeof value==='string')return quote(value);if(typeof value==='boolean')return value?'true':'false';if(value instanceof Array){var parts=[];for(var i=0;i<value.length;i++)parts.push(json(value[i]));return '['+parts.join(',')+']';}var parts=[];for(var key in value)if(value.hasOwnProperty(key))parts.push(quote(key)+':'+json(value[key]));return '{'+parts.join(',')+'}';}
 function write(name,value) {var file=new File(base.fsName+'/'+name);file.encoding='UTF8';if(!file.open('w'))throw Error('Cannot write experiment record.');file.write(json(value));file.close();}

 if(cases.length>20)throw Error('Native experiment case limit exceeded.');
 if(!base.exists&&!base.create())throw Error('Cannot create native output directory.');
 var initial=app.documents.length?app.activeDocument:null,previousDialogs=app.displayDialogs,owned=null,runID=String(new Date().getTime())+'-'+String(Math.floor(Math.random()*1000000));
 var record={photoshopVersion:app.version,referenceKind:'native-actionmanager',interpolationPreferenceBefore:String(app.preferences.interpolation),sourceInputs:inputRoot,limits:['Interpolation requests require output/descriptor validation; unknown action fields may be silently ignored.','Each case opens a fresh authored source; exported before-source PNG enables actual RGBA verification.','No user preference or notifier writes. Background uses direct perspectiveCrop. Explicit DOM Image Size is an independent axis-only control, not a two-stage perspective crop.','Independent size cohort captured after nearest-depth model SHA freeze f26949c57de80292fb6b3eaac2ab4f70ae28d31c05551c124ad2fc1e49293793; no coefficient fitting.'],cases:[]};
 function savePNG(doc,name){var output=new File(base.fsName+'/'+name),options=new PNGSaveOptions();options.interlaced=false;doc.saveAs(output,options,true,Extension.LOWERCASE);return output.fsName;}
 function enumValue(desc,key){try{var id=stringIDToTypeID(key);if(!desc||!desc.hasKey(id))return null;return {type:typeIDToStringID(desc.getEnumerationType(id)),value:typeIDToStringID(desc.getEnumerationValue(id))};}catch(ignore){return null;}}
 try {
  app.displayDialogs=DialogModes.NO;
  for(var index=0;index<cases.length;index++) {
   var item=cases[index],source=new File(inputRoot+'/'+item.sourceVariant+'.png'),row={name:item.name,sourceVariant:item.sourceVariant,referenceRole:item.referenceRole,operation:item.operation,corners:item.corners,requestedTarget:item.target,requestedInterpolation:item.method,referenceKind:'native-actionmanager',interpolationFieldStatus:'UNPROVEN_UNTIL_OUTPUT_COMPARISON',creationMode:item.target?'Direct perspectiveCrop with explicit output dimensions':'Direct perspectiveCrop with no output dimensions; native automatic size'};
   if(!source.exists)throw Error('Missing authored source '+source.fsName);
   try {
    var ownedInput=new File(base.fsName+'/alpha28-owned-input-'+runID+'-'+index+'.png');
    if(ownedInput.exists||!source.copy(ownedInput.fsName))throw Error('Cannot create fresh owned input copy.');
    owned=app.open(ownedInput);owned.selection.deselect();row.ownedInputPath=ownedInput.fsName;
    row.sourcePath=source.fsName;row.sourceWidth=owned.width.as('px');row.sourceHeight=owned.height.as('px');row.backgroundAtOpen=owned.activeLayer.isBackgroundLayer;
    if(item.background){owned.activeLayer.isBackgroundLayer=true;if(!owned.activeLayer.isBackgroundLayer)throw Error('Native background conversion was not honored.');}
    if(item.normalLayer&&owned.activeLayer.isBackgroundLayer){var original=owned.activeLayer;var copy=original.duplicate();original.remove();owned.activeLayer=copy;}
    row.backgroundBeforeCrop=owned.activeLayer.isBackgroundLayer;row.nativeSourcePath=savePNG(owned,item.name+'-source.png');
    var action=new ActionDescriptor(),quad=new ActionDescriptor(),center=new ActionDescriptor();
    center.putUnitDouble(stringIDToTypeID('horizontal'),stringIDToTypeID('pixelsUnit'),row.sourceWidth/2);
    center.putUnitDouble(stringIDToTypeID('vertical'),stringIDToTypeID('pixelsUnit'),row.sourceHeight/2);
    quad.putObject(stringIDToTypeID('center'),stringIDToTypeID('paint'),center);
    for(var corner=0;corner<4;corner++){var point=new ActionDescriptor();point.putUnitDouble(stringIDToTypeID('horizontal'),stringIDToTypeID('pixelsUnit'),item.corners[corner][0]);point.putUnitDouble(stringIDToTypeID('vertical'),stringIDToTypeID('pixelsUnit'),item.corners[corner][1]);quad.putObject(stringIDToTypeID('quadCorner'+corner),stringIDToTypeID('offset'),point);}
    action.putObject(stringIDToTypeID('to'),stringIDToTypeID('quadrilateral'),quad);
    if(item.target){action.putUnitDouble(stringIDToTypeID('width'),stringIDToTypeID('pixelsUnit'),item.target[0]);action.putUnitDouble(stringIDToTypeID('height'),stringIDToTypeID('pixelsUnit'),item.target[1]);}
    var returned=null;
    if(item.operation==='resizeImage'){
     owned.resizeImage(new UnitValue(item.target[0],'px'),new UnitValue(item.target[1],'px'),undefined,ResampleMethod[item.method]);row.referenceKind='native-dom-image-size';row.interpolationFieldStatus='SUPPORTED_DOM_EXPLICIT_RESAMPLE_METHOD';row.creationMode='DOM Image Size only; no perspective stage, no preference write';
    }else{
     if(item.method)action.putEnumerated(stringIDToTypeID('interpolation'),stringIDToTypeID('interpolationType'),stringIDToTypeID(item.method));
     returned=executeAction(stringIDToTypeID('perspectiveCrop'),action,DialogModes.NO);
    }
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
