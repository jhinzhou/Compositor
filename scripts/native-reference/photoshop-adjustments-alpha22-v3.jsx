#target photoshop
/* Independent generated inputs only. Do not overwrite v2 evidence. */
(function(){
 var studyRoot='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native',studyOutput=studyRoot+'/outputs/adjustments-alpha22-v3',studyBefore=app.documents.length?app.activeDocument:null,studyDialogs=app.displayDialogs;
 var studyLog=new File(studyOutput+'/native-results.tsv');studyLog.encoding='UTF-8';studyLog.open('w');studyLog.writeln('Photoshop\t'+app.version);app.displayDialogs=DialogModes.NO;
 function runStudy(studyName,studyInput,studyKind,studyAmount,studyDepth){var studyDoc=null;try{
  studyDoc=app.open(new File(studyRoot+'/inputs/'+studyInput));if(studyDepth==16)studyDoc.bitsPerChannel=BitsPerChannelType.SIXTEEN;
  studyLog.writeln(studyName+'\tBEFORE\t'+studyInput+'\t'+studyKind+'\t'+studyAmount+'\t'+studyDepth);
  if(studyKind=='threshold')studyDoc.activeLayer.threshold(studyAmount);
  if(studyKind=='posterize')studyDoc.activeLayer.posterize(studyAmount);
  studyDoc.saveAs(new File(studyOutput+'/'+studyName+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
  studyLog.writeln(studyName+'\tPASS\t'+studyDoc.bitsPerChannel);
 }catch(studyError){studyLog.writeln(studyName+'\tFAIL\t'+studyError);}finally{if(studyDoc)studyDoc.close(SaveOptions.DONOTSAVECHANGES);}}
 try{
  runStudy('source-noop-8','adjustments-alpha22-source.png','noop',0,8);
  runStudy('source-noop-16','adjustments-alpha22-source.png','noop',0,16);
  runStudy('source-posterize-2-8','adjustments-alpha22-source.png','posterize',2,8);
  runStudy('source-posterize-3-8','adjustments-alpha22-source.png','posterize',3,8);
  runStudy('source-posterize-5-8','adjustments-alpha22-source.png','posterize',5,8);
  runStudy('source-posterize-255-8','adjustments-alpha22-source.png','posterize',255,8);
  runStudy('source-threshold-1-8','adjustments-alpha22-source.png','threshold',1,8);
  runStudy('source-threshold-127-8','adjustments-alpha22-source.png','threshold',127,8);
  runStudy('source-threshold-255-8','adjustments-alpha22-source.png','threshold',255,8);
  runStudy('source-posterize-2-16','adjustments-alpha22-source.png','posterize',2,16);
  runStudy('source-posterize-3-16','adjustments-alpha22-source.png','posterize',3,16);
  runStudy('source-posterize-5-16','adjustments-alpha22-source.png','posterize',5,16);
  runStudy('source-posterize-255-16','adjustments-alpha22-source.png','posterize',255,16);
  runStudy('source-threshold-1-16','adjustments-alpha22-source.png','threshold',1,16);
  runStudy('source-threshold-127-16','adjustments-alpha22-source.png','threshold',127,16);
  runStudy('source-threshold-255-16','adjustments-alpha22-source.png','threshold',255,16);
  runStudy('deep-noop-16','adjustments-alpha22-deep.png','noop',0,16);
  runStudy('deep-posterize-2-16','adjustments-alpha22-deep.png','posterize',2,16);
  runStudy('deep-posterize-3-16','adjustments-alpha22-deep.png','posterize',3,16);
  runStudy('deep-posterize-5-16','adjustments-alpha22-deep.png','posterize',5,16);
  runStudy('deep-posterize-255-16','adjustments-alpha22-deep.png','posterize',255,16);
  runStudy('deep-threshold-1-16','adjustments-alpha22-deep.png','threshold',1,16);
  runStudy('deep-threshold-127-16','adjustments-alpha22-deep.png','threshold',127,16);
  runStudy('deep-threshold-255-16','adjustments-alpha22-deep.png','threshold',255,16);
  runStudy('alpha-noop-8','adjustments-alpha22-alpha.png','noop',0,8);
  runStudy('alpha-noop-16','adjustments-alpha22-alpha.png','noop',0,16);
  runStudy('alpha-threshold-64-8','adjustments-alpha22-alpha.png','threshold',64,8);
  runStudy('alpha-threshold-128-8','adjustments-alpha22-alpha.png','threshold',128,8);
  runStudy('alpha-posterize-4-8','adjustments-alpha22-alpha.png','posterize',4,8);
  runStudy('alpha-posterize-8-8','adjustments-alpha22-alpha.png','posterize',8,8);
  runStudy('alpha-threshold-64-16','adjustments-alpha22-alpha.png','threshold',64,16);
  runStudy('alpha-threshold-128-16','adjustments-alpha22-alpha.png','threshold',128,16);
  runStudy('alpha-posterize-4-16','adjustments-alpha22-alpha.png','posterize',4,16);
  runStudy('alpha-posterize-8-16','adjustments-alpha22-alpha.png','posterize',8,16);
 }finally{app.displayDialogs=studyDialogs;if(studyBefore)app.activeDocument=studyBefore;studyLog.close();}
})();
