#target photoshop
/* Prepares one disposable self-authored white reference. Feather is edited in
 * the real Photoshop Properties panel; capture script checks descriptor readback. */
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native';
 $.global.alpha21MaskBefore=app.documents.length?app.activeDocument:null;
 var d=app.open(new File(root+'/inputs/opaque-white.png'));d.activeLayer.isBackgroundLayer=false;d.activeLayer.name='alpha21-mask-reference';
 d.selection.select([[88,56],[168,56],[168,136],[88,136]],SelectionType.REPLACE,0,false);
 var c=charIDToTypeID,a=new ActionDescriptor(),r=new ActionReference();a.putClass(c('Nw  '),c('Chnl'));r.putEnumerated(c('Chnl'),c('Chnl'),c('Msk '));a.putReference(c('At  '),r);a.putEnumerated(c('Usng'),c('UsrM'),c('RvlS'));executeAction(c('Mk  '),a,DialogModes.NO);d.selection.deselect();
 $.global.alpha21MaskDoc=d;
})();
