#target photoshop
(function(){if(app.documents.length&&/^alpha21-crop-ui/.test(app.activeDocument.activeLayer.name))app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);if($.global.alpha21CropBefore)app.activeDocument=$.global.alpha21CropBefore;})();
