<script setup lang="ts">
import { useI18n } from './i18n'
const { t, tm } = useI18n()
import { computed, nextTick, ref, watch } from 'vue'
import type { ModelConfig, ModelMessage, ModelProtocol, ModelTool } from '../main/model-client'
export type AgentConfiguration = Omit<ModelConfig, 'apiKey'> & { apiKey?: string; clearKey?: boolean }
export type AgentChatEntry = { id: string; role: ModelMessage['role']; content: string; toolName?: string; error?: boolean; images?: { mimeType: string; data: string }[] }
const props = withDefaults(defineProps<{ conversation: AgentChatEntry[]; config?: Omit<ModelConfig, 'apiKey'>; configured?: boolean; status?: 'idle' | 'running' | 'cancelled' | 'error'; tools?: ModelTool[]; streamingText?: string; error?: string; documentTitle?: string;configureModel?:(config:AgentConfiguration)=>Promise<boolean>;sendMessage?:(text:string)=>Promise<boolean>;canUndo?:boolean;previews?:{stage:string;mimeType:string;data:string}[] }>(), { status: 'idle', configured: false, tools: () => [], streamingText: '' })
const emit = defineEmits<{ configure: [config: Omit<ModelConfig, 'apiKey'> & { apiKey?: string; clearKey?: boolean }]; send: [text: string]; cancel: []; clear: [];undo:[];close:[] }>()
const input = ref(''), showSettings = ref(!props.configured), transcript = ref<HTMLElement>(), prompt = ref<HTMLTextAreaElement>(), settingsError = ref(''), sendError = ref(''), settingsBusy = ref(false), sending = ref(false)
const endpoint = ref(props.config?.endpoint ?? ''), model = ref(props.config?.model ?? ''), protocol = ref<ModelProtocol>(props.config?.protocol ?? 'openai-compatible'), apiKey = ref(''), clearKey = ref(false), maxTokens = ref(props.config?.maxTokens ?? 4096), timeoutSeconds = ref((props.config?.timeoutMs ?? 120000) / 1000)
const running = computed(() => props.status === 'running'), canSend = computed(() => props.configured && !running.value && !sending.value && !!input.value.trim())
watch(() => props.config, config => { if (config) { endpoint.value = config.endpoint; model.value = config.model; protocol.value = config.protocol; maxTokens.value = config.maxTokens ?? 4096; timeoutSeconds.value = (config.timeoutMs ?? 120000) / 1000 } })
watch(() => [props.conversation.length, props.streamingText], async () => { await nextTick(); if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight })
async function configure(): Promise<boolean> {
  if(settingsBusy.value || running.value)return false
  settingsError.value = ''
  try { const url = new URL(endpoint.value.trim()); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error() } catch { settingsError.value = 'Enter an HTTP(S) service URL without embedded credentials.'; return false }
  if (!model.value.trim()) { settingsError.value = 'Enter the model name provided by your service.'; return false }
  const config:AgentConfiguration={ protocol: protocol.value, endpoint: endpoint.value.trim(), model: model.value.trim(), ...(apiKey.value ? { apiKey: apiKey.value } : {}), ...(clearKey.value ? { clearKey: true } : {}), maxTokens: Math.max(1, Math.min(131072, Math.round(maxTokens.value))), timeoutMs: Math.max(1000, Math.min(600000, timeoutSeconds.value * 1000)) }
  settingsBusy.value=true
  try {
    if(props.configureModel){if(!await props.configureModel(config)){settingsError.value='Settings could not be saved. Check the application error and try again.';return false}}
    else emit('configure',config)
    apiKey.value='';clearKey.value=false;showSettings.value=false;return true
  }catch{settingsError.value='Settings could not be saved. Check the application error and try again.';return false}
  finally{settingsBusy.value=false}
}
async function send(): Promise<boolean> {
  if(!canSend.value)return false
  const text=input.value.trim();sending.value=true;sendError.value=''
  try {
    if(props.sendMessage){if(!await props.sendMessage(text)){sendError.value='The message was not accepted. Check the application error and try again.';return false}}
    else emit('send',text)
    input.value='';void nextTick(()=>prompt.value?.focus());return true
  }catch{sendError.value='The message was not accepted. Check the application error and try again.';return false}
  finally{sending.value=false}
}
function promptKey(event: KeyboardEvent): void { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() } }
function cancelSettings(): void { if(settingsBusy.value)return;apiKey.value = ''; settingsError.value = ''; clearKey.value = false; showSettings.value = false }
</script>
<template>
  <section class="agent-chat" :aria-label="t('Agent conversation')">
    <header><strong>{{ t('Agent') }}</strong><span>{{ config?.model || t('Configure a model') }}</span><button :aria-label="t('Model settings')" :disabled="running || settingsBusy || sending" @click="showSettings = !showSettings">{{ t('Settings') }}</button><button class="agent-close" type="button" :aria-label="t('Close Agent')" @click="emit('close')">×</button></header>
    <form v-if="showSettings" class="model-settings" :aria-busy="settingsBusy" @submit.prevent="configure"><fieldset :disabled="settingsBusy">
      <label>{{ t('Protocol') }}<select v-model="protocol" :aria-label="t('Model protocol')"><option value="openai-compatible">{{ t('OpenAI compatible · Chat Completions') }}</option><option value="anthropic">{{ t('Anthropic · Messages') }}</option></select></label>
      <label>{{ t('Service URL') }}<input v-model="endpoint" :aria-label="t('Model service URL')" type="url" :placeholder="t('API base ending in /v1, or complete request URL')" required autocomplete="off" spellcheck="false" /></label>
      <label>{{ t('Model') }}<input v-model="model" :aria-label="t('Model name')" required :placeholder="t('Model ID from your provider')" autocomplete="off" spellcheck="false" /></label>
      <label>{{ t('API key') }}<input v-model="apiKey" :aria-label="t('Model API key')" type="password" autocomplete="off" :placeholder="t(configured ? 'Leave blank to keep the current key' : 'Optional for a local service')" /></label>
      <label v-if="configured" class="clear-key"><input v-model="clearKey" type="checkbox" /> {{ t('Clear the current key') }}</label>
      <div class="model-numbers"><label>{{ t('Output tokens') }}<input v-model.number="maxTokens" :aria-label="t('Model output tokens')" type="number" min="1" max="131072" /></label><label>{{ t('Timeout (s)') }}<input v-model.number="timeoutSeconds" :aria-label="t('Model timeout seconds')" type="number" min="1" max="600" /></label></div>
      <p>{{ t('Connect the service you choose. The API key is encrypted by the system and saved on this computer. Clear the current key to remove it. Use a /v1 API base or the complete request URL (for example, /chat/completions).') }}</p>
      <p v-if="settingsError" class="agent-error" role="alert">{{ tm(settingsError) }}</p>
      <div class="settings-actions"><button type="button" @click="cancelSettings">{{ t('Cancel') }}</button><button type="submit">{{t(settingsBusy ? 'Saving…' : 'Apply settings')}}</button></div></fieldset>
    </form>
    <div v-else ref="transcript" class="agent-transcript" role="log" aria-live="polite" aria-relevant="additions text">
      <div v-if="!conversation.length && !streamingText" class="agent-empty"><strong>{{ t('Edit with your agent') }}</strong><p>{{ t('Describe the result you want. The agent can inspect the document, edit through MCP tools, and preview its work.') }}</p><p v-if="documentTitle">{{ t('Current document: {title}', {title:documentTitle}) }}</p></div>
      <article v-for="entry in conversation.filter(item => item.role !== 'system')" :key="entry.id" :class="['agent-message', entry.role, { failed: entry.error }]">
        <small>{{ entry.role === 'user' ? t('You') : entry.role === 'tool' ? entry.toolName ?? t('Editor tool') : t('Agent') }}</small>
        <details v-if="entry.role === 'tool'"><summary>{{ t(entry.error ? 'Tool returned an error' : 'Tool result') }}</summary><pre>{{ entry.content }}</pre></details><p v-else>{{ entry.content }}</p>
        <img v-for="(image, index) in entry.images" :key="index" :src="`data:${image.mimeType};base64,${image.data}`" :alt="t('Editor preview')" />
      </article>
      <div v-if="previews?.length" class="agent-comparison"><figure v-for="image in previews" :key="image.stage"><figcaption>{{t(image.stage)}}</figcaption><img :src="`data:${image.mimeType};base64,${image.data}`" :alt="t('{stage} agent edit', {stage:t(image.stage)})"></figure></div><article v-if="streamingText" class="agent-message assistant"><small>{{ t('Agent') }}</small><p>{{ streamingText }}</p></article>
      <p v-if="error" class="agent-error" role="alert">{{ tm(error) }}</p>
    </div>
    <div class="agent-status" role="status"><span :class="{ busy: running }">{{ t(running ? 'Working…' : status === 'cancelled' ? 'Cancelled' : status === 'error' ? 'Request failed' : configured ? 'Ready' : 'Configure your service') }}</span><span>{{ tools.length ? t('{count} MCP tools', {count:tools.length}) : t('MCP connects when a task starts') }}</span></div>
    <form class="agent-composer" @submit.prevent="send"><textarea ref="prompt" v-model="input" :aria-label="t('Message to agent')" :placeholder="t('Describe an edit…')" :disabled="!configured || running || sending" rows="3" @keydown="promptKey" /><p v-if="sendError" class="agent-error" role="alert">{{tm(sendError)}}</p><div><button type="button" :disabled="running || sending || !conversation.length" @click="emit('clear')">{{ t('Clear chat') }}</button><button type="button" :disabled="running||sending||!canUndo" @click="emit('undo')">{{ t('Undo agent edits') }}</button><span>{{ t('Shift + Return for a new line') }}</span><button v-if="running" type="button" @click="emit('cancel')">{{ t('Stop') }}</button><button v-else type="submit" :disabled="!canSend">{{t(sending ? 'Sending…' : 'Send')}}</button></div></form>
  </section>
</template>
<style scoped>
.agent-chat{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden;color:#ddd;background:#242424;font:13px/1.4 system-ui}
.agent-chat header{display:flex;flex-shrink:0;gap:12px;align-items:center;padding:15px;border-bottom:1px solid #383838}
.agent-chat header strong{font-size:16px}
.agent-chat .agent-close{position:static;display:inline-flex;align-items:center;justify-content:center;min-width:32px;padding:3px;font-size:22px;line-height:24px}
.agent-chat header span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#aaa}
.agent-chat button,.agent-chat input,.agent-chat select,.agent-chat textarea{box-sizing:border-box;color:#ddd;background:#1b1b1b;border:1px solid #484848;border-radius:5px;font:inherit;line-height:20px}
.agent-chat button{min-height:32px;flex-shrink:0;padding:5px 10px;cursor:pointer}
.agent-chat button:disabled{opacity:.4;cursor:default}
.agent-transcript{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px}
.agent-empty{padding:30px 5px;color:#aaa;line-height:1.7}
.agent-empty strong{font-size:18px;color:#ddd}
.agent-message{margin-bottom:16px;overflow-wrap:anywhere}
.agent-message small{display:block;color:#999;font-size:11px;margin-bottom:5px}
.agent-message p{white-space:pre-wrap;line-height:1.6;margin:0}
.agent-message.user{background:#303030;border-radius:7px;padding:10px}
.agent-message img{max-width:100%;max-height:260px;object-fit:contain;display:block;margin-top:8px}
.agent-message details{font-size:11px;color:#aaa}
.agent-message pre{white-space:pre-wrap;max-height:160px;overflow:auto}
.agent-chat .agent-error,.agent-message.failed{color:#ffa67d}
.agent-status{flex-shrink:0;padding:8px 14px;font-size:11px;display:flex;flex-wrap:wrap;gap:4px 10px;justify-content:space-between;color:#999;border-top:1px solid #383838}
.agent-status .busy{color:#6db2ff}
.agent-composer{flex-shrink:0;padding:10px 14px 14px;display:flex;flex-direction:column;gap:8px}
.agent-composer textarea{resize:vertical;height:auto;min-height:65px;max-height:180px;padding:9px;box-sizing:border-box;width:100%}
.agent-composer>div{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.agent-composer span{flex:1 1 100%;order:1;font-size:10px;color:#888}
.model-settings{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;padding:14px;display:flex;flex-direction:column;gap:12px}
.model-settings>*{flex-shrink:0}
.model-settings fieldset{border:0;margin:0;padding:0;min-width:0;display:flex;flex-direction:column;gap:12px}
.model-settings fieldset>*{flex-shrink:0}
.model-settings label{display:flex;flex-direction:column;gap:6px;min-width:0}
.model-settings input,.model-settings select{height:36px;min-height:36px;line-height:20px;padding:7px 8px;box-sizing:border-box;width:100%;min-width:0}
.model-settings select{padding-right:24px;text-overflow:ellipsis}
.model-settings .clear-key{flex-direction:row;align-items:center;font-size:11px}
.model-settings .clear-key input{width:16px;height:16px;min-height:16px;padding:0;flex-shrink:0}
.model-numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.model-settings p{font-size:11px;line-height:1.5;color:#999;margin:0;overflow-wrap:anywhere}
.settings-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px}
.agent-comparison{display:flex;gap:8px}
.agent-comparison figure{margin:0;flex:1;min-width:0}
.agent-comparison img{width:100%;max-height:200px;object-fit:contain}
.agent-comparison figcaption{color:#999;font-size:11px}
@media(max-height:600px){.agent-composer textarea{min-height:45px;max-height:90px}.agent-composer{padding-top:7px;padding-bottom:9px}.agent-empty{padding-top:15px}}
</style>
