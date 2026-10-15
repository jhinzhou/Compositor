#target photoshop
/* Self-authored fixtures only. Original active document remains untouched. */
(function(){
 var studyRoot='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native',studyOutput=studyRoot+'/outputs/adjustments-alpha22-v2',studyBefore=app.documents.length?app.activeDocument:null,studyDialogs=app.displayDialogs;
 var studyLog=new File(studyOutput+'/native-results.tsv');studyLog.encoding='UTF-8';studyLog.open('w');studyLog.writeln('Photoshop\t'+app.version);app.displayDialogs=DialogModes.NO;
 function runStudy(studyName,studyKind,studyAmount,studyDepth){var studyDoc=null;try{studyDoc=app.open(new File(studyRoot+'/inputs/adjustments-alpha22-source.png'));if(studyDepth==16)studyDoc.bitsPerChannel=BitsPerChannelType.SIXTEEN;studyLog.writeln(studyName+'\tBEFORE\t'+studyAmount+'\t'+studyDepth);
  if(studyKind=='threshold')studyDoc.activeLayer.threshold(studyAmount);else studyDoc.activeLayer.posterize(studyAmount);
  studyDoc.saveAs(new File(studyOutput+'/'+studyName+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);studyLog.writeln(studyName+'\tPASS\t'+studyAmount+'\t'+studyDoc.bitsPerChannel);
 }catch(studyError){studyLog.writeln(studyName+'\tFAIL\t'+studyError);}finally{if(studyDoc)studyDoc.close(SaveOptions.DONOTSAVECHANGES);}}
 try{runStudy('threshold-128-8','threshold',128,8);runStudy('threshold-64-8','threshold',64,8);runStudy('posterize-4-8','posterize',4,8);runStudy('posterize-8-8','posterize',8,8);runStudy('threshold-128-16','threshold',128,16);runStudy('threshold-64-16','threshold',64,16);runStudy('posterize-4-16','posterize',4,16);runStudy('posterize-8-16','posterize',8,16);}finally{app.displayDialogs=studyDialogs;if(studyBefore)app.activeDocument=studyBefore;studyLog.close();}
})();
