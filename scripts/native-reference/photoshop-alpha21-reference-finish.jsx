#target photoshop
(function(){if(app.documents.length && /^alpha21-mask-reference/.test(app.activeDocument.activeLayer.name))app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);if($.global.alpha21MaskBefore)app.activeDocument=$.global.alpha21MaskBefore;})();
