import {toRaw} from 'vue'
/** IPC structured clone cannot accept reactive proxies, even nested in plain records. */
export function rpcValue<T>(value:T):T{
 if(!value||typeof value!=='object')return value
 const raw=toRaw(value)
 if(ArrayBuffer.isView(raw)||raw instanceof ArrayBuffer||raw instanceof Blob)return raw
 if(Array.isArray(raw))return raw.map(item=>rpcValue(item)) as T
 return Object.fromEntries(Object.entries(raw).map(([key,item])=>[key,rpcValue(item)])) as T
}
