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
 var base=new Folder('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/perspective-alpha28-sampling-independent');
 var cases=[{"name": "opaque-holdout-axis-up", "corners": [[0, 0], [512, 0], [512, 384], [0, 384]], "target": [768, 576], "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "opaque-holdout-fractional-up", "corners": [[27.25, 20.5], [483.75, 39.25], [453.5, 352.75], [40.25, 329.5]], "target": [720, 540], "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "opaque-holdout-strong-up", "corners": [[74, 32], [441, 103], [407, 345], [28, 276]], "target": [768, 576], "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "opaque-holdout-projective-down", "corners": [[27.25, 20.5], [483.75, 39.25], [453.5, 352.75], [40.25, 329.5]], "target": [192, 144], "method": null, "sourceVariant": "opaque-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "alpha-holdout-axis-up", "corners": [[0, 0], [512, 0], [512, 384], [0, 384]], "target": [768, 576], "method": null, "sourceVariant": "alpha-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "alpha-holdout-fractional-up", "corners": [[27.25, 20.5], [483.75, 39.25], [453.5, 352.75], [40.25, 329.5]], "target": [720, 540], "method": null, "sourceVariant": "alpha-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "alpha-holdout-strong-up", "corners": [[74, 32], [441, 103], [407, 345], [28, 276]], "target": [768, 576], "method": null, "sourceVariant": "alpha-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "alpha-holdout-projective-down", "corners": [[27.25, 20.5], [483.75, 39.25], [453.5, 352.75], [40.25, 329.5]], "target": [192, 144], "method": null, "sourceVariant": "alpha-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}, {"name": "alpha-holdout-edge-up", "corners": [[-3, -2], [510, 12], [501, 383], [3, 370]], "target": [900, 675], "method": null, "sourceVariant": "alpha-holdout", "referenceRole": "sampling-independent-after-freeze", "operation": "perspectiveCrop"}];
 function quote(value) {return '"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f]/g,function(c){return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);})+'"';}
 function json(value) {if(value===null)return 'null';if(typeof value==='number')return isFinite(value)?String(value):quote(String(value));if(typeof value==='string')return quote(value);if(typeof value==='boolean')return value?'true':'false';if(value instanceof Array){var parts=[];for(var i=0;i<value.length;i++)parts.push(json(value[i]));return '['+parts.join(',')+']';}var parts=[];for(var key in value)if(value.hasOwnProperty(key))parts.push(quote(key)+':'+json(value[key]));return '{'+parts.join(',')+'}';}
 function write(name,value) {var file=new File(base.fsName+'/'+name);file.encoding='UTF8';if(!file.open('w'))throw Error('Cannot write experiment record.');file.write(json(value));file.close();}

 if(cases.length>20)throw Error('Native experiment case limit exceeded.');
 if(!base.exists&&!base.create())throw Error('Cannot create native output directory.');
 var initial=app.documents.length?app.activeDocument:null,previousDialogs=app.displayDialogs,owned=null,runID=String(new Date().getTime())+'-'+String(Math.floor(Math.random()*1000000));
 var record={photoshopVersion:app.version,referenceKind:'native-actionmanager',interpolationPreferenceBefore:String(app.preferences.interpolation),sourceInputs:inputRoot,limits:['Interpolation requests require output/descriptor validation; unknown action fields may be silently ignored.','Each case opens a fresh authored source; exported before-source PNG enables actual RGBA verification.','No user preference or notifier writes. Background uses direct perspectiveCrop. Explicit DOM Image Size is an independent axis-only control, not a two-stage perspective crop.','Independent sampling cohort captured after model freeze SHA2786acda885d8c77cc0905539c5e6f71a43442e55272c7faa038cef5f5c285e7. Downsampling is disclosed unchanged residual, no holdout model fit.'],cases:[]};
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
