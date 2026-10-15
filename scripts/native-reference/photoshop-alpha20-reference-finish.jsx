#target photoshop
/* Only the explicit disposable reference is closed. Existing documents persist. */
(function(){if(app.documents.length&&/^alpha20-mask-reference(?:-(?:edge|inverse|hole))?$/.test(app.activeDocument.activeLayer.name))app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);})();
