#target photoshop
/* Self-authored white source only. Preserve all already-open user documents. */
(function(){
 var root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native',out=root+'/outputs/feather-study',before=app.documents.length?app.activeDocument:null;
 new Folder(out).create();var log=new File(out+'/native-results.tsv');log.encoding='UTF-8';log.open('w');log.writeln('Photoshop\t'+app.version);
 function rectangle(d,b,type){d.selection.select([[UnitValue(b[0],'px'),UnitValue(b[1],'px')],[UnitValue(b[0]+b[2],'px'),UnitValue(b[1],'px')],[UnitValue(b[0]+b[2],'px'),UnitValue(b[1]+b[3],'px')],[UnitValue(b[0],'px'),UnitValue(b[1]+b[3],'px')]],type||SelectionType.REPLACE,0,false);}
 function run(name,b,r,extra){var d=null;try{d=app.open(new File(root+'/inputs/opaque-white.png'));rectangle(d,b);if(extra==='hole')rectangle(d,[112,80,32,32],SelectionType.DIMINISH);if(extra==='inverse')d.selection.invert();if(r)d.selection.feather(r);if(extra==='repeat')d.selection.feather(r);d.selection.invert();d.selection.clear();d.selection.deselect();d.saveAs(new File(out+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);log.writeln(name+'\tPASS');}catch(e){log.writeln(name+'\tFAIL\t'+e);}finally{if(d)d.close(SaveOptions.DONOTSAVECHANGES);}}
 var radii=[0,1,2,3,5,10,20,40];for(var i=0;i<radii.length;i++)run('center-f'+radii[i],[88,56,80,80],radii[i]);
 for(var j=0;j<3;j++){var r=[3,10,20][j];run('edge-f'+r,[0,32,80,80],r);run('hole-f'+r,[64,32,128,128],r,'hole');run('inverse-f'+r,[88,56,80,80],r,'inverse');run('repeat-f'+r,[88,56,80,80],r,'repeat');}
 run('tiny-f40',[126,94,4,4],40);run('full-f20',[0,0,256,192],20);
 log.close();if(before)app.activeDocument=before;
})();
