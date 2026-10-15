#target photoshop
/* Independent self-authored transparent image and scripted paths. No existing document edits. */
(function(){
 var c=charIDToTypeID,s=stringIDToTypeID,root='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native',out=root+'/outputs/brush-study-v5',before=app.documents.length?app.activeDocument:null,oldForeground=app.foregroundColor;
 var log=new File(out+'/native-results.tsv');log.encoding='UTF-8';log.open('w');log.writeln('Photoshop\t'+app.version);
 function current(){var r=new ActionReference();r.putProperty(c('Prpr'),s('currentToolOptions'));r.putEnumerated(c('capp'),c('Ordn'),c('Trgt'));return executeActionGet(r).getObjectValue(s('currentToolOptions'));}
 function options(opacity,flow){var a=new ActionDescriptor(),r=new ActionReference();r.putClass(s('paintbrushTool'));a.putReference(c('null'),r);var o=current();o.putUnitDouble(s('opacity'),c('#Prc'),opacity);o.putUnitDouble(s('flow'),c('#Prc'),flow);o.putBoolean(s('smoothing'),false);o.putDouble(s('smoothingValue'),0);for(var b=0;b<8;b++)o.putBoolean(s(['useTipDynamics','useScatter','useTexture','useColorDynamics','wetEdges','noise','usePaintDynamics','usePressureOverridesOpacity'][b]),false);o.putBoolean(s('usePressureOverridesSize'),false);a.putObject(c('T   '),c('null'),o);executeAction(c('setd'),a,DialogModes.NO);}
 function tip(hardness,spacing,diameter){var a=new ActionDescriptor(),r=new ActionReference();r.putEnumerated(c('Brsh'),c('Ordn'),c('Trgt'));a.putReference(c('null'),r);var b=new ActionDescriptor();b.putUnitDouble(c('Dmtr'),c('#Pxl'),diameter||32);b.putUnitDouble(c('Hrdn'),c('#Prc'),hardness);b.putUnitDouble(c('Spcn'),c('#Prc'),spacing);b.putUnitDouble(c('Angl'),c('#Ang'),0);b.putUnitDouble(c('Rndn'),c('#Prc'),100);a.putObject(c('T   '),c('Brsh'),b);executeAction(c('setd'),a,DialogModes.NO);}
 function dump(desc,prefix){for(var j=0;j<desc.count;j++){var k=desc.getKey(j),t=desc.getType(k),v='';try{if(t===DescValueType.OBJECTTYPE){dump(desc.getObjectValue(k),prefix+typeIDToStringID(k)+'.');continue;}if(t===DescValueType.UNITDOUBLE)v=desc.getUnitDoubleValue(k);else if(t===DescValueType.INTEGERTYPE)v=desc.getInteger(k);else if(t===DescValueType.DOUBLETYPE)v=desc.getDouble(k);else if(t===DescValueType.BOOLEANTYPE)v=desc.getBoolean(k);else if(t===DescValueType.STRINGTYPE)v=desc.getString(k);}catch(e){v='ERR '+e;}log.writeln(prefix+typeIDToStringID(k)+'\t'+t+'\t'+v);}}var original=null;try{original=current();for(var k=0;k<original.count;k++){var key=original.getKey(k);log.writeln('tool-key\t'+typeIDToStringID(key)+'\t'+original.getType(key)+(original.getType(key)===DescValueType.BOOLEANTYPE?'='+original.getBoolean(key):''));}}catch(e){log.writeln('options-inspect\tFAIL\t'+e);}
 function stroke(d,points){var p=[];for(var i=0;i<points.length;i++){var v=new PathPointInfo();v.kind=PointKind.CORNERPOINT;v.anchor=points[i];v.leftDirection=points[i];v.rightDirection=points[i];p.push(v);}var sub=new SubPathInfo();sub.operation=ShapeOperation.SHAPEADD;sub.closed=false;sub.entireSubPath=p;var path=d.pathItems.add('independent-reference',[sub]);path.strokePath(ToolType.BRUSH,false);path.remove();}
 function run(name,hardness,opacity,flow,spacing,repeat,depth,dot,diameter){var d=null;try{d=app.open(new File(root+'/inputs/brush-study-transparent.png'));if(depth===16)d.bitsPerChannel=BitsPerChannelType.SIXTEEN;var color=new SolidColor();color.rgb.red=200;color.rgb.green=40;color.rgb.blue=100;app.foregroundColor=color;options(opacity,flow);tip(hardness,spacing,diameter);var actual=current();dump(actual,name+'.actual.');log.writeln(name+'\tverified-options\topacity='+actual.getInteger(s('opacity'))+'\tflow='+actual.getInteger(s('flow')));for(var i=0;i<repeat;i++)stroke(d,dot==='quarter'?[[128.25,96.25],[128.26,96.25]]:dot==='half'?[[128.5,96.5],[128.51,96.5]]:dot?[[128,96],[128.01,96]]:[[48,96],[208,96]]);if(depth===16){var po=new PhotoshopSaveOptions();po.layers=true;d.saveAs(new File(out+'/'+name+'.psd'),po,true,Extension.LOWERCASE);}d.saveAs(new File(out+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);log.writeln(name+'\tPASS');}catch(e){log.writeln(name+'\tFAIL\t'+e);}finally{if(d)d.close(SaveOptions.DONOTSAVECHANGES);}}
 run('tip-d8-h90-dot-o100-f100-s25',90,100,100,25,1,8,true,8);
 run('tip-d8-h100-dot-o100-f100-s25',100,100,100,25,1,8,true,8);
 run('tip-d16-h90-dot-o100-f100-s25',90,100,100,25,1,8,true,16);
 run('tip-d16-h100-dot-o100-f100-s25',100,100,100,25,1,8,true,16);
 run('tip-d31-h90-dot-o100-f100-s25',90,100,100,25,1,8,true,31);
 run('tip-d31-h100-dot-o100-f100-s25',100,100,100,25,1,8,true,31);
 run('tip-d32-h90-dot-o100-f100-s25',90,100,100,25,1,8,true,32);
 run('tip-d32-h100-dot-o100-f100-s25',100,100,100,25,1,8,true,32);
 run('tip-d33-h90-dot-o100-f100-s25',90,100,100,25,1,8,true,33);
 run('tip-d33-h100-dot-o100-f100-s25',100,100,100,25,1,8,true,33);
 run('tip-d64-h90-dot-o100-f100-s25',90,100,100,25,1,8,true,64);
 run('tip-d64-h100-dot-o100-f100-s25',100,100,100,25,1,8,true,64);
 run('tip-d32-h0-half-dot-o100-f100-s25',0,100,100,25,1,8,'half',32);
 run('tip-d32-h50-half-dot-o100-f100-s25',50,100,100,25,1,8,'half',32);
 run('tip-d32-h90-half-dot-o100-f100-s25',90,100,100,25,1,8,'half',32);
 run('tip-d32-h99-half-dot-o100-f100-s25',99,100,100,25,1,8,'half',32);
 run('tip-d32-h100-half-dot-o100-f100-s25',100,100,100,25,1,8,'half',32);
 run('rgb16-d32-h100-dot-o1-f100-s25',100,1,100,25,1,16,true,32);
 run('rgb16-d32-h100-dot-o2-f100-s25',100,2,100,25,1,16,true,32);
 run('rgb16-d32-h100-dot-o10-f100-s25',100,10,100,25,1,16,true,32);
 run('rgb16-d32-h100-dot-o50-f100-s25',100,50,100,25,1,16,true,32);
 run('tip-d64-h99-dot-o100-f100-s25',99,100,100,25,1,8,true,64);
 run('tip-d32-h100-quarter-dot-o100-f100-s25',100,100,100,25,1,8,'quarter',32);
 run('tip-d32-h100-o100-f20-s10',100,100,20,10,1,8,false,32);
 if(original)try{var a=new ActionDescriptor(),r=new ActionReference();r.putClass(s('paintbrushTool'));a.putReference(c('null'),r);a.putObject(c('T   '),c('null'),original);executeAction(c('setd'),a,DialogModes.NO);}catch(e){log.writeln('restore-options\tFAIL\t'+e);}app.foregroundColor=oldForeground;log.close();if(before)app.activeDocument=before;
})();
