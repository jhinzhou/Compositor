import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod'
import { EditorError, type BridgeInfo, type EditorState } from '../shared/contracts'
import { modelEndpoint, runModelAgent, type ModelConfig, type ModelMessage, type ModelTool } from './model-client'
const configSchema=z.object({protocol:z.enum(['openai-compatible','anthropic']),endpoint:z.string().max(4096),model:z.string().trim().min(1).max(500),apiKey:z.string().max(8192).optional(),clearKey:z.boolean().optional(),maxTokens:z.number().int().min(1).max(131072).optional(),timeoutMs:z.number().int().min(1000).max(600000).optional()}).strict()
export class AgentController {
 private config?:ModelConfig
 private messages:ModelMessage[]=[]
 private tools:ModelTool[]=[]
 private controller?:AbortController
 private status:'idle'|'running'|'cancelled'|'error'='idle'
 private error?:string
 private streamingText=''
 private sessionId?:string
 private lastTask?:{sessionId:string;documentId:string;taskId:string}
 private previews:{stage:'before'|'after';mimeType:string;data:string}[]=[]
 constructor(private bridge:()=>BridgeInfo,private state:()=>Promise<EditorState>,private notify:(state:unknown)=>void,private persist?:(config:ModelConfig)=>Promise<void>){}
 snapshot(){const {apiKey:_,...config}=this.config??{};return {config:this.config?config:undefined,configured:!!this.config,conversation:this.messages.map((message,index)=>({...message,id:String(index),toolName:message.name})),tools:this.tools,status:this.status,error:this.error,streamingText:this.streamingText,canUndo:!!this.lastTask,previews:this.previews}}
 private publish(){this.notify(this.snapshot())}
 async configure(input:unknown){if(this.controller)throw new EditorError('AGENT_BUSY','Stop the agent before changing its service.');const parsed=configSchema.parse(input);const {clearKey,...value}=parsed;const apiKey=clearKey?undefined:value.apiKey??this.config?.apiKey;const config={...value,apiKey};modelEndpoint(config);await this.persist?.(config);this.config=config;this.error=undefined;this.publish();return this.snapshot()}
 clear(){if(this.controller)throw new EditorError('AGENT_BUSY','Stop the agent before clearing this conversation.');this.messages=[];this.lastTask=undefined;this.previews=[];this.error=undefined;this.streamingText='';this.publish();return this.snapshot()}
 cancel(){this.controller?.abort();return this.snapshot()}
 async restore(config:ModelConfig|undefined){if(config){const parsed=configSchema.parse(config);modelEndpoint(parsed);this.config=parsed;this.publish()}}
 async send(input:unknown){const {text}=z.object({text:z.string().trim().min(1).max(32000)}).strict().parse(input);if(!this.config)throw new EditorError('MODEL_REQUIRED','Configure your model service first.');if(this.controller)throw new EditorError('AGENT_BUSY','The agent is already running.');const controller=this.controller=new AbortController()
  try{const state=await this.state();if(controller.signal.aborted){this.controller=undefined;return this.snapshot()}if(this.sessionId!==state.sessionId){this.messages=[];this.previews=[];this.lastTask=undefined;this.sessionId=state.sessionId}
   this.messages.push({role:'user',content:text});this.status='running';this.streamingText='';this.error=undefined;this.publish();void this.run(state,this.config,controller);return this.snapshot()
  }catch(error){if(this.controller===controller)this.controller=undefined;throw error}
 }
 async undoLast(){if(this.controller)throw new EditorError('AGENT_BUSY','Stop the agent before undoing its task.');if(!this.lastTask)throw new EditorError('TASK_NOT_FOUND','There is no agent task to undo.');const state=await this.state(),task=this.lastTask;if(state.sessionId!==task.sessionId)throw new EditorError('SESSION_EXPIRED','Switch back to the document this agent edited before undoing.')
  const bridge=this.bridge(),client=new Client({name:'compositor-agent-undo',version:'0.3.0'}),transport=new StdioClientTransport({command:bridge.mcpCommand,args:bridge.mcpArgs,env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'})
  try{await client.connect(transport);const result=await client.callTool({name:'history.undo_task',arguments:{...task,expectedRevision:state.revision,idempotencyKey:randomUUID()}});if(result.isError)throw new Error((result.content[0] as {text?:string}).text??'The agent task cannot be undone after later user edits.');this.lastTask=undefined;this.publish();return this.snapshot()}finally{await client.close().catch(()=>{})}
 }
 private async run(state:EditorState,config:ModelConfig,controller:AbortController){let client:Client|undefined,taskId:string|undefined;const deadline=setTimeout(()=>controller.abort(),299000);const identity=(revision=state.revision)=>({sessionId:state.sessionId,documentId:state.manifest.documentID,expectedRevision:revision,idempotencyKey:randomUUID()})
  try{const bridge=this.bridge();client=new Client({name:'compositor-built-in-agent',version:'0.3.0'});const transport=new StdioClientTransport({command:bridge.mcpCommand,args:bridge.mcpArgs,env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined)),ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});await client.connect(transport)
   const begun=await client.callTool({name:'task.begin',arguments:{...identity(),label:'Agent conversation edit'}});if(begun.isError)throw new Error('The document could not begin an agent task.');const parsed=begun.structuredContent??JSON.parse((begun.content[0] as {text:string}).text);taskId=(parsed as {taskId:string}).taskId;if(taskId){this.lastTask={sessionId:state.sessionId,documentId:state.manifest.documentID,taskId};this.previews=[]}if(!taskId)throw new Error('The editor returned no task ID.');const cancelTask=()=>{void client!.callTool({name:'task.cancel',arguments:{sessionId:state.sessionId,documentId:state.manifest.documentID,idempotencyKey:randomUUID(),taskId}}).catch(()=>{})};controller.signal.addEventListener('abort',cancelTask,{once:true});if(controller.signal.aborted)cancelTask()
   const capture=async(stage:'before'|'after')=>{try{const current=await this.state();if(current.sessionId!==state.sessionId)return;const result=await client!.callTool({name:'document.preview',arguments:{sessionId:state.sessionId,expectedRevision:current.revision,maxDimension:512}});if(!result.isError)for(const content of result.content)if(content.type==='image')this.previews.push({stage,mimeType:content.mimeType,data:content.data});this.publish()}catch{}};await capture('before')
   const listed=await client.listTools();this.tools=listed.tools.filter(tool=>!tool.name.startsWith('task.')&&tool.name!=='history.undo_task').map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema as Record<string,unknown>}));this.publish()
   const instruction:ModelMessage={role:'system',content:`You are the Compositor image editing agent. Use only the provided MCP tools to edit. The current document session is ${state.sessionId}, document ID ${state.manifest.documentID}. Inspect capabilities and current state before editing, use that current revision and a fresh unique idempotencyKey, and preview before and after substantial edits. All writes are bound to this document and task ${taskId}. Do not guess image content or say a tool succeeded when it returned an error. Coordinates are document pixels. Ask the user when their intended result is ambiguous. The task execution limit is five minutes. User edits may cause revision conflicts; inspect fresh state and adapt without undoing the user's work.`}
   const result=await runModelAgent(config,{messages:[instruction,...this.messages],signal:controller.signal,host:{listTools:async()=>this.tools,callTool:async(name,args,signal)=>{
    if(signal?.aborted)throw new Error('Agent cancelled.');if(['document.apply','document.apply_batch','history.undo'].includes(name)&&args.sessionId!==state.sessionId)throw new Error('This agent task can edit only its starting document.');if(name==='document.apply'||name==='document.apply_batch')args={...args,taskId};return client!.callTool({name,arguments:args},{timeout:150000,signal})
   }},onEvent:event=>{
    if(event.type==='text')this.streamingText+=event.text
    else if(event.type==='assistant'){this.streamingText='';this.messages.push(event.message)}
    else if(event.type==='tool-result'){const content=(event.result as {content?:{type:string;text?:string;mimeType?:string;data?:string}[]}).content??[];this.messages.push({role:'tool',name:event.call.name,toolCallId:event.call.id,content:content.filter(item=>item.type==='text').map(item=>item.text??'').join('\n'),images:content.filter(item=>item.type==='image').map(item=>({mimeType:item.mimeType!,data:item.data!})),error:event.error})}
    this.publish()
   }})
   this.messages=result.messages.filter(message=>message.role!=='system');await capture('after');this.status='idle'
  }catch(error){this.status=controller.signal.aborted?'cancelled':'error';this.error=controller.signal.aborted?undefined:error instanceof Error?error.message:'The agent request failed.'}
  finally{clearTimeout(deadline);if(client&&taskId){try{await client.callTool({name:controller.signal.aborted?'task.cancel':'task.finish',arguments:{sessionId:state.sessionId,documentId:state.manifest.documentID,idempotencyKey:randomUUID(),taskId,...(controller.signal.aborted?{}:{state:this.status==='error'?'failed':'completed',message:this.error})}})}catch{}}
   await client?.close().catch(()=>{});if(this.controller===controller)this.controller=undefined;this.streamingText='';this.publish()
  }
 }
}
