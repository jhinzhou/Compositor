#target photoshop
(function(){var previous=app.displayDialogs;try{if(app.documents.length&&app.activeDocument.activeLayer.name==='alpha25-tools-owned'){app.displayDialogs=DialogModes.NO;app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);}}finally{app.displayDialogs=previous;}})();
