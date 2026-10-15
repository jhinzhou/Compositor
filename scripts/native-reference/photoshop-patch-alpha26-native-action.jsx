#target photoshop
/* Native Photoshop patch action; only this task's owned layer. GUI sets Diffusion. */
(function(){if(!app.documents.length||app.activeDocument.activeLayer.name!=='alpha26-tools-owned')throw Error('Task-owned document required');
 var s=stringIDToTypeID,d=new ActionDescriptor(),r=new ActionReference();r.putProperty(s('channel'),s('selection'));d.putReference(s('null'),r);var offset=new ActionDescriptor();offset.putUnitDouble(s('horizontal'),s('pixelsUnit'),-95);offset.putUnitDouble(s('vertical'),s('pixelsUnit'),45);d.putObject(s('from'),s('offset'),offset);d.putEnumerated(s('patchMode'),s('patchModeType'),s('patchNormal'));d.putBoolean(s('useSource'),true);d.putBoolean(s('transparency'),false);executeAction(s('patchSelection'),d,DialogModes.NO);
})();
