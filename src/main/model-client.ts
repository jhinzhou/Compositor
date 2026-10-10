/** Wire formats checked against official Chat Completions streaming and Claude Messages streaming docs. */
export type ModelProtocol = 'openai-compatible' | 'anthropic'
export type ModelConfig = { protocol: ModelProtocol; endpoint: string; model: string; apiKey?: string; maxTokens?: number; timeoutMs?: number }
export type ModelTool = { name: string; description?: string; inputSchema: Record<string, unknown> }
export type ModelToolCall = { id: string; name: string; arguments: string }
export type ModelImage = { mimeType: string; data: string }
export type ModelMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: ModelToolCall[]; toolCallId?: string; name?: string; error?: boolean; images?: ModelImage[] }
export type ModelReply = { content: string; toolCalls: ModelToolCall[]; stopReason: string; usage?: Record<string, number> }
export type ModelRequestOptions = { fetch?: typeof fetch; signal?: AbortSignal; onText?: (text: string) => void }
export class ModelClientError extends Error {
  constructor(public code: 'CONFIG' | 'HTTP' | 'PROTOCOL' | 'TIMEOUT' | 'ABORTED' | 'NETWORK' | 'LIMIT', message: string, public status?: number) { super(message); this.name = 'ModelClientError' }
}
export function modelEndpoint(config: ModelConfig): string {
  if (config.protocol !== 'openai-compatible' && config.protocol !== 'anthropic') throw new ModelClientError('CONFIG', 'Select the model API protocol.')
  if (!config.model?.trim()) throw new ModelClientError('CONFIG', 'Enter a model name.')
  let url: URL
  try { url = new URL(config.endpoint) } catch { throw new ModelClientError('CONFIG', 'Enter a valid model service URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new ModelClientError('CONFIG', 'Use an HTTP(S) service URL without embedded credentials or a fragment.')
  const suffix = config.protocol === 'anthropic' ? '/messages' : '/chat/completions'
  const path = url.pathname.replace(/\/+$/, '')
  if (!path) url.pathname = `/v1${suffix}`
  else if (path.endsWith('/v1')) url.pathname = `${path}${suffix}`
  return url.toString()
}
function safeError(error: unknown, config: ModelConfig): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown model error.'
  return (config.apiKey ? message.split(config.apiKey).join('[redacted]') : message).slice(0, 2000)
}
const textPart = (text: string) => ({ type: 'text', text })
function imageParts(images: ModelImage[] | undefined, protocol: ModelProtocol): unknown[] {
  return (images ?? []).filter(image => ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mimeType)).map(image => protocol === 'anthropic' ? { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } } : { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } })
}
export function modelRequestBody(config: ModelConfig, messages: ModelMessage[], tools: ModelTool[]): Record<string, unknown> {
  const maximum = Math.max(1, Math.min(131072, Math.round(config.maxTokens ?? 4096)))
  if (config.protocol === 'openai-compatible') {
    const wire: unknown[] = [], pendingImages: unknown[] = []
    const flushImages = () => { if (pendingImages.length) { wire.push({ role: 'user', content: [...pendingImages] }); pendingImages.length = 0 } }
    for (const message of messages) {
      if (message.role === 'tool') {
        wire.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content })
        if (message.images?.length) pendingImages.push(textPart(`Image returned by ${message.name ?? 'the editor tool'}.`), ...imageParts(message.images, config.protocol))
      } else { flushImages(); wire.push({ role: message.role, content: message.images?.length ? [textPart(message.content), ...imageParts(message.images, config.protocol)] : message.content || (message.toolCalls?.length ? null : ''), ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) }) }
    }
    flushImages()
    return { model: config.model.trim(), stream: true, max_tokens: maximum, messages: wire, ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema } })), tool_choice: 'auto' } : {}) }
  }
  const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'), wire: { role: string; content: unknown[] }[] = []
  for (const message of messages.filter(message => message.role !== 'system')) {
    let content: unknown[], role: string
    if (message.role === 'tool') { role = 'user'; content = [{ type: 'tool_result', tool_use_id: message.toolCallId, is_error: message.error ?? false, content: [textPart(message.content), ...imageParts(message.images, config.protocol)] }] }
    else { role = message.role; content = [...(message.content ? [textPart(message.content)] : []), ...imageParts(message.images, config.protocol), ...(message.toolCalls ?? []).map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: JSON.parse(call.arguments) }))] }
    if (!content.length) content = [textPart(' ')]
    // Consecutive tool results belong to the same user turn in the Messages protocol.
    if (wire.at(-1)?.role === role) wire.at(-1)!.content.push(...content)
    else wire.push({ role, content })
  }
  return { model: config.model.trim(), stream: true, max_tokens: maximum, messages: wire, ...(system ? { system } : {}), ...(tools.length ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description ?? '', input_schema: tool.inputSchema })) } : {}) }
}
async function* serverEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(), decoder = new TextDecoder(), maximum = 8 * 1024 * 1024
  let pending = '', event = '', data: string[] = [], bytes = 0
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    let finished = false
    while (!finished) {
      if (signal.aborted) throw signal.reason
      const chunk = await reader.read(); finished = chunk.done; bytes += chunk.value?.length ?? 0
      if (bytes > maximum) throw new ModelClientError('LIMIT', 'Model response exceeded the 8 MiB limit.')
      pending += decoder.decode(chunk.value, { stream: !finished })
      let match: RegExpExecArray | null
      while ((match = /\r\n|\n|\r/.exec(pending))) {
        if (match[0] === '\r' && match.index === pending.length - 1 && !finished) break
        const line = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length)
        if (!line) { if (data.length) yield { event, data: data.join('\n') }; event = ''; data = [] }
        else if (line.startsWith('event:')) event = line.slice(6).trimStart()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (pending.length > 1024 * 1024) throw new ModelClientError('LIMIT', 'Model event exceeded the 1 MiB limit.')
    }
    if (pending.startsWith('data:')) data.push(pending.slice(5).replace(/^ /, ''))
    if (data.length) yield { event, data: data.join('\n') }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export async function streamModelReply(config: ModelConfig, messages: ModelMessage[], tools: ModelTool[] = [], options: ModelRequestOptions = {}): Promise<ModelReply> {
  const endpoint = modelEndpoint(config), controller = new AbortController(), timeout = Math.max(1, Math.min(600000, config.timeoutMs ?? 120000))
  const timer = setTimeout(() => controller.abort(new ModelClientError('TIMEOUT', `Model request timed out after ${timeout} ms.`)), timeout)
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  let content = '', stopReason = '', terminal = false, usage: Record<string, number> | undefined
  const calls = new Map<number, ModelToolCall>(), initialInputs = new Map<number, string>()
  function appendText(text: unknown): void { if (typeof text === 'string' && text) { content += text; options.onText?.(text) } }
  try {
    if (signal.aborted) throw signal.reason
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
    if (config.protocol === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (config.apiKey) headers['x-api-key'] = config.apiKey }
    else if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
    const response = await (options.fetch ?? fetch)(endpoint, { method: 'POST', headers, body: JSON.stringify(modelRequestBody(config, messages, tools)), signal, redirect: 'error' })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2000)
      throw new ModelClientError('HTTP', safeError(`Model service returned HTTP ${response.status}: ${detail}`, config), response.status)
    }
    if (!response.body) throw new ModelClientError('PROTOCOL', 'Model service returned no response stream.')
    for await (const event of serverEvents(response.body, signal)) {
      if (signal.aborted) throw signal.reason
      if (event.data === '[DONE]') { terminal = true; break }
      let payload: any
      try { payload = JSON.parse(event.data) } catch { throw new ModelClientError('PROTOCOL', 'Model service sent invalid JSON in its event stream.') }
      if (event.event === 'error' || payload.type === 'error' || payload.error) throw new ModelClientError('PROTOCOL', safeError(payload.error?.message ?? 'Model service returned a streaming error.', config))
      if (config.protocol === 'openai-compatible') {
        if (payload.usage) usage = payload.usage
        const choice = payload.choices?.find((item: any) => item.index === 0) ?? payload.choices?.[0]
        if (!choice) continue
        appendText(choice.delta?.content); appendText(choice.delta?.refusal)
        if (choice.finish_reason) stopReason = choice.finish_reason
        for (const fragment of choice.delta?.tool_calls ?? []) {
          const index = fragment.index
          if (!Number.isInteger(index) || index < 0 || index >= 128) throw new ModelClientError('PROTOCOL', 'Invalid streamed tool call index.')
          const call = calls.get(index) ?? { id: '', name: '', arguments: '' }
          call.id += fragment.id ?? ''; call.name += fragment.function?.name ?? ''; call.arguments += fragment.function?.arguments ?? ''; calls.set(index, call)
        }
      } else {
        if (payload.type === 'message_start') usage = payload.message?.usage
        if (payload.type === 'content_block_start') {
          const block = payload.content_block
          if (block?.type === 'text') appendText(block.text)
          if (block?.type === 'tool_use') {
            if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index >= 128) throw new ModelClientError('PROTOCOL', 'Invalid streamed tool call index.')
            calls.set(payload.index, { id: block.id, name: block.name, arguments: '' }); initialInputs.set(payload.index, JSON.stringify(block.input ?? {}))
          }
        }
        if (payload.type === 'content_block_delta') {
          if (payload.delta?.type === 'text_delta') appendText(payload.delta.text)
          if (payload.delta?.type === 'input_json_delta') { const call = calls.get(payload.index); if (!call) throw new ModelClientError('PROTOCOL', 'Tool input arrived before its content block.'); call.arguments += payload.delta.partial_json ?? '' }
        }
        if (payload.type === 'content_block_stop') { const call = calls.get(payload.index); if (call && !call.arguments) call.arguments = initialInputs.get(payload.index) ?? '{}' }
        if (payload.type === 'message_delta') { stopReason = payload.delta?.stop_reason ?? stopReason; if (payload.usage) usage = { ...usage, ...payload.usage } }
        if (payload.type === 'message_stop') { terminal = true; break }
      }
      if (content.length > 2 * 1024 * 1024 || [...calls.values()].some(call => call.arguments.length > 65536 || call.name.length > 128 || call.id.length > 256)) throw new ModelClientError('LIMIT', 'Model output or tool arguments exceeded the allowed size.')
    }
    if (signal.aborted) throw signal.reason
    if (!stopReason || (config.protocol === 'anthropic' && !terminal)) throw new ModelClientError('PROTOCOL', 'Model stream ended before a complete response. No tools were executed.')
    if (stopReason === 'length' || stopReason === 'max_tokens') throw new ModelClientError('LIMIT', 'Model output was truncated. Increase the output token limit before retrying.')
    const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call)
    if (toolCalls.some(call => !call.id || !call.name)) throw new ModelClientError('PROTOCOL', 'Model returned an incomplete tool call.')
    if (config.protocol === 'anthropic') for (const call of toolCalls) { try { const args = JSON.parse(call.arguments); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error() } catch { throw new ModelClientError('PROTOCOL', 'Model returned invalid tool JSON. No tools were executed.') } }
    if (new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) throw new ModelClientError('PROTOCOL', 'Model returned duplicate tool call identifiers.')
    return { content, toolCalls, stopReason, usage }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    if (options.signal?.aborted) throw new ModelClientError('ABORTED', 'Model request cancelled.')
    if (error instanceof ModelClientError) throw error
    throw new ModelClientError('NETWORK', safeError(error, config))
  } finally { clearTimeout(timer) }
}
export type ModelAgentEvent = { type: 'text'; text: string; round: number } | { type: 'assistant'; message: ModelMessage; round: number } | { type: 'tool-start'; call: ModelToolCall; round: number } | { type: 'tool-result'; call: ModelToolCall; result: unknown; error: boolean; round: number }
export type ModelToolHost = { listTools: () => Promise<ModelTool[]>; callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> }
export type AgentRunOptions = ModelRequestOptions & { messages: ModelMessage[]; host: ModelToolHost; onEvent?: (event: ModelAgentEvent) => void; maxRounds?: number; maxCalls?: number }
function abortCheck(signal?: AbortSignal): void { if (signal?.aborted) throw new ModelClientError('ABORTED', 'Agent task cancelled.') }
async function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  abortCheck(signal)
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ModelClientError('ABORTED', 'Agent task cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
function toolResultMessage(call: ModelToolCall, result: unknown, failed: boolean): ModelMessage {
  const object = result && typeof result === 'object' ? result as { content?: { type?: string; text?: string; mimeType?: string; data?: string }[]; isError?: boolean; structuredContent?: unknown } : undefined
  const images = object?.content?.filter(part => part.type === 'image' && part.mimeType && part.data).map(part => ({ mimeType: part.mimeType!, data: part.data! }))
  const textual = object?.content?.filter(part => part.type !== 'image')
  const content = object?.content ? JSON.stringify({ content: textual, structuredContent: object.structuredContent, isError: object.isError }) : JSON.stringify(result) ?? 'null'
  return { role: 'tool', content: content.slice(0, 262144), toolCallId: call.id, name: call.name, error: failed || object?.isError === true, ...(images?.length ? { images } : {}) }
}
export async function runModelAgent(config: ModelConfig, options: AgentRunOptions): Promise<{ messages: ModelMessage[]; rounds: number; calls: number }> {
  modelEndpoint(config); abortCheck(options.signal)
  const originals = await withAbort(options.host.listTools(), options.signal), mapping = new Map<string, ModelTool>(), messages = structuredClone(options.messages)
  const tools = originals.map((tool, index) => { const name = `mcp_${index}_${tool.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64); mapping.set(name, tool); return { ...tool, name, description: `${tool.description ?? tool.name} (MCP: ${tool.name})` } })
  const maximumRounds = Math.max(1, Math.min(100, options.maxRounds ?? 24)), maximumCalls = Math.max(1, Math.min(1000, options.maxCalls ?? 100))
  let totalCalls = 0
  for (let round = 0; round < maximumRounds; round++) {
    abortCheck(options.signal)
    const reply = await streamModelReply(config, messages, tools, { ...options, onText: text => { options.onText?.(text); options.onEvent?.({ type: 'text', text, round }) } })
    const assistant: ModelMessage = { role: 'assistant', content: reply.content, ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}) }
    messages.push(assistant); options.onEvent?.({ type: 'assistant', message: assistant, round })
    if (!reply.toolCalls.length) return { messages, rounds: round + 1, calls: totalCalls }
    for (const wireCall of reply.toolCalls) {
      abortCheck(options.signal)
      if (++totalCalls > maximumCalls) throw new ModelClientError('LIMIT', `Agent exceeded ${maximumCalls} tool calls.`)
      const original = mapping.get(wireCall.name), call = { ...wireCall, name: original?.name ?? wireCall.name }
      let result: unknown, error = false
      options.onEvent?.({ type: 'tool-start', call, round })
      try {
        if (!original) throw new Error('The model requested an unavailable editor tool.')
        let args: unknown
        try { args = JSON.parse(call.arguments) } catch { throw new Error('The model returned invalid JSON tool arguments. No edit was applied.') }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Editor tool arguments must be an object. No edit was applied.')
        // The host owns MCP validation, revision checking and transactions; this module never edits a document directly.
        result = await withAbort(options.host.callTool(original.name, args as Record<string, unknown>, options.signal), options.signal)
      } catch (caught) { abortCheck(options.signal); error = true; result = { isError: true, content: [{ type: 'text', text: safeError(caught, config) }] } }
      abortCheck(options.signal)
      const toolMessage = toolResultMessage(wireCall, result, error); toolMessage.name = call.name; messages.push(toolMessage)
      options.onEvent?.({ type: 'tool-result', call, result, error: toolMessage.error ?? false, round })
    }
  }
  throw new ModelClientError('LIMIT', `Agent exceeded ${maximumRounds} model rounds.`)
}
