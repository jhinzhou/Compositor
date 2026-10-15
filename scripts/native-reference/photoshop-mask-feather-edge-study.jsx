#target photoshop
/* Prepares one disposable self-authored white reference. Feather is edited in
 * the real Photoshop Properties panel; capture script checks descriptor readback. */
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native';
 if(app.documents.length&&/^alpha20-mask-reference/.test(app.activeDocument.activeLayer.name))app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
 var d=app.open(new File(root+'/inputs/opaque-white.png'));d.activeLayer.isBackgroundLayer=false;d.activeLayer.name='alpha20-mask-reference-edge';
 d.selection.select([[0,16],[90,16],[90,176],[0,176]],SelectionType.REPLACE,0,false);
 var c=charIDToTypeID,a=new ActionDescriptor(),r=new ActionReference();a.putClass(c('Nw  '),c('Chnl'));r.putEnumerated(c('Chnl'),c('Chnl'),c('Msk '));a.putReference(c('At  '),r);a.putEnumerated(c('Usng'),c('UsrM'),c('RvlS'));executeAction(c('Mk  '),a,DialogModes.NO);d.selection.deselect();
 $.global.alpha20MaskDoc=d;
})();
