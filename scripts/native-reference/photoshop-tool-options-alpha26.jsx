#target photoshop
(function(){
 function idName(id){try{var text=typeIDToStringID(id);if(text)return text;}catch(ignore){}try{return typeIDToCharID(id);}catch(ignore2){return String(id);}}
 function quote(text){return '"'+String(text).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f]/g,function(c){var h=c.charCodeAt(0).toString(16);return '\\u'+('0000'+h).slice(-4);})+'"';}
 function encode(value){if(value===null)return 'null';if(typeof value==='string')return quote(value);if(typeof value==='number')return isFinite(value)?String(value):quote(String(value));if(typeof value==='boolean')return value?'true':'false';if(value instanceof Array){var a=[];for(var i=0;i<value.length;i++)a.push(encode(value[i]));return '['+a.join(',')+']';}var a=[];for(var key in value)if(value.hasOwnProperty(key))a.push(quote(key)+':'+encode(value[key]));return '{'+a.join(',')+'}';}
 function readValue(container,key,type,depth){
  if(depth>12)return {omitted:'depth limit'};
  try{
   if(type===DescValueType.BOOLEANTYPE)return container.getBoolean(key);
   if(type===DescValueType.INTEGERTYPE)return container.getInteger(key);
   if(type===DescValueType.LARGEINTEGERTYPE)return container.getLargeInteger(key);
   if(type===DescValueType.DOUBLETYPE)return container.getDouble(key);
   if(type===DescValueType.STRINGTYPE)return container.getString(key);
   if(type===DescValueType.ENUMERATEDTYPE)return {enumType:idName(container.getEnumerationType(key)),value:idName(container.getEnumerationValue(key))};
   if(type===DescValueType.UNITDOUBLE)return {unit:idName(container.getUnitDoubleType(key)),value:container.getUnitDoubleValue(key)};
   if(type===DescValueType.CLASSTYPE)return {className:idName(container.getClass(key))};
   if(type===DescValueType.OBJECTTYPE)return {className:idName(container.getObjectType(key)),value:readDescriptor(container.getObjectValue(key),depth+1)};
   if(type===DescValueType.LISTTYPE){var list=container.getList(key),result=[];for(var i=0;i<Math.min(list.count,256);i++)result.push(readValue(list,i,list.getType(i),depth+1));return result;}
   return {omitted:String(type)};
  }catch(cause){return {readError:String(cause)};}
 }
 function readDescriptor(descriptor,depth){var result={};for(var i=0;i<Math.min(descriptor.count,256);i++){var key=descriptor.getKey(i);result[idName(key)]=readValue(descriptor,key,descriptor.getType(key),depth);}return result;}
 var r=new ActionReference();r.putProperty(stringIDToTypeID('property'),stringIDToTypeID('currentToolOptions'));r.putEnumerated(stringIDToTypeID('application'),stringIDToTypeID('ordinal'),stringIDToTypeID('targetEnum'));var d=executeActionGet(r);var out=new File('/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/crop-events-alpha26/tool-options-'+new Date().getTime()+'.json');out.encoding='UTF8';out.open('w');out.write(encode(readDescriptor(d,0)));out.close();
})();