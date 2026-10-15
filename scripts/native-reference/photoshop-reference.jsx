#target photoshop
// Run manually through Photoshop File > Scripts > Browse. Only opens our
// self-authored fixture; never edits or closes any previously open document.
(function () {
 var root = '/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native';
 var before = app.documents.length ? app.activeDocument : null;
 var out = root + '/outputs/v3'; new Folder(out).create();
 var log = new File(out + '/native-results.tsv'); log.encoding = 'UTF-8'; log.open('w');
 log.writeln('Photoshop\t' + app.version);
 function run(name, depth, operation, psd) {
  var d = null;
  try {
   d = app.open(new File(root + '/inputs/analysis-grid.png'));
   if (depth === 16) d.bitsPerChannel = BitsPerChannelType.SIXTEEN;
   operation(d);
   var options = psd ? new PhotoshopSaveOptions() : new PNGSaveOptions();
   if (psd) { options.layers = true; options.embedColorProfile = true; }
   else options.interlaced = false;
   d.saveAs(new File(out + '/' + name + (psd ? '.psd' : '.png')), options, true, Extension.LOWERCASE);
   var profile='untagged';try{profile=d.colorProfileName;}catch(ignore){}
   log.writeln(name + '\tPASS\t' + d.bitsPerChannel + '\t' + profile);
  } catch (e) { log.writeln(name + '\tFAIL\t' + e.toString()); }
  finally { if (d) d.close(SaveOptions.DONOTSAVECHANGES); }
 }
 for (var n = 0; n < 2; n++) {
  var depth = n ? 16 : 8, prefix = 'rgb' + depth + '-';
  run(prefix+'identity', depth, function(d){});
  run(prefix+'levels-gamma125', depth, function(d){d.activeLayer.adjustLevels(0,255,1.25,0,255);});
  run(prefix+'levels-range', depth, function(d){d.activeLayer.adjustLevels(23,221,.85,11,240);});
  run(prefix+'gaussian3', depth, function(d){d.activeLayer.applyGaussianBlur(3);});
  run(prefix+'invert', depth, function(d){d.activeLayer.invert();});
  run(prefix+'hsl', depth, function(d){var desc=new ActionDescriptor();desc.putBoolean(stringIDToTypeID('colorize'),false);var list=new ActionList(), v=new ActionDescriptor();v.putInteger(charIDToTypeID('H   '),25);v.putInteger(charIDToTypeID('Strt'),30);v.putInteger(charIDToTypeID('Lght'),-10);list.putObject(charIDToTypeID('Hst2'),v);desc.putList(charIDToTypeID('Adjs'),list);executeAction(charIDToTypeID('HStr'),desc,DialogModes.NO);});
  run(prefix+'layered', depth, function(d){var l=d.activeLayer.duplicate();l.name='Top half opacity';l.opacity=50;},true);
 }
 run('selection-feather10',8,function(d){d.selection.select([[new UnitValue(160,'px'),new UnitValue(80,'px')],[new UnitValue(240,'px'),new UnitValue(80,'px')],[new UnitValue(240,'px'),new UnitValue(160,'px')],[new UnitValue(160,'px'),new UnitValue(160,'px')]]);d.selection.feather(10);d.selection.invert();d.selection.clear();d.selection.deselect();});
 run('selection-tiny-feather40',8,function(d){d.selection.select([[new UnitValue(196,'px'),new UnitValue(116,'px')],[new UnitValue(204,'px'),new UnitValue(116,'px')],[new UnitValue(204,'px'),new UnitValue(124,'px')],[new UnitValue(196,'px'),new UnitValue(124,'px')]]);d.selection.feather(40);d.selection.invert();d.selection.clear();d.selection.deselect();});
 run('crop-300x200',8,function(d){d.crop([new UnitValue(60,'px'),new UnitValue(40,'px'),new UnitValue(360,'px'),new UnitValue(240,'px')]);});
 run('rgb16-layered-rle',16,function(d){d.activeLayer.duplicate();},true);
 log.close(); if (before) app.activeDocument = before;
})();
