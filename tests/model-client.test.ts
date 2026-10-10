import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelClientError, modelEndpoint, modelRequestBody, runModelAgent, streamModelReply } from '../src/main/model-client'
import type { ModelConfig, ModelMessage, ModelTool } from '../src/main/model-client'
const config: ModelConfig = { protocol: 'openai-compatible', endpoint: 'https://provider.test/v1', model: 'user-model', apiKey: 'unit-test-secret', timeoutMs: 1000 }
const anthropic = { ...config, protocol: 'anthropic' as const }, messages: ModelMessage[] = [{ role: 'user', content: 'Edit the image' }]
const tool: ModelTool = { name: 'document.apply', description: 'Apply editor transaction', inputSchema: { type: 'object', properties: { value: { type: 'number' } } } }
function event(payload: unknown, name?: string): string { return `${name ? `event: ${name}\n` : ''}data: ${JSON.stringify(payload)}\n\n` }
function response(text: string, chunks = [text]): Response { const encoder = new TextEncoder(); return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close() } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) }
function fixedFetch(text: string): typeof fetch { return async () => response(text) }
function chatText(text: string): string { return event({ choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n' }
function chatCall(name: string, args: string, id = 'call_1'): string { return event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n' }
test('model configuration remains explicit and appends protocol routes only to a base URL', () => {
  assert.equal(modelEndpoint(config), 'https://provider.test/v1/chat/completions')
  assert.equal(modelEndpoint({ ...anthropic, endpoint: 'http://127.0.0.1:9000' }), 'http://127.0.0.1:9000/v1/messages')
  assert.equal(modelEndpoint({ ...config, endpoint: 'https://provider.test/custom/chat?version=2' }), 'https://provider.test/custom/chat?version=2')
  assert.throws(() => modelEndpoint({ ...config, model: '' }), /model name/)
  assert.throws(() => modelEndpoint({ ...config, endpoint: 'https://name:password@provider.test/v1' }), /credentials/)
})
test('OpenAI-compatible streaming joins text and parallel fragmented tool calls', async () => {
  const events = event({ choices: [{ index: 0, delta: { content: '你好', tool_calls: [{ index: 1, id: 'second', function: { name: 'inspect', arguments: '{"x":' } }, { index: 0, id: 'first', function: { name: 'edit', arguments: '{' } }] }, finish_reason: null }] }) + event({ choices: [{ index: 0, delta: { content: '！', tool_calls: [{ index: 0, function: { arguments: '"value":5}' } }, { index: 1, function: { arguments: '2}' } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n'
  const text: string[] = [], result = await streamModelReply(config, messages, [], { fetch: fixedFetch(events), onText: fragment => text.push(fragment) })
  assert.equal(result.content, '你好！'); assert.deepEqual(text, ['你好', '！'])
  assert.deepEqual(result.toolCalls, [{ id: 'first', name: 'edit', arguments: '{"value":5}' }, { id: 'second', name: 'inspect', arguments: '{"x":2}' }])
})
test('SSE supports split CRLF boundaries, keepalive comments, multiline data and UTF-8 splits', async () => {
  const text = ': ping\r\n\r\ndata: {"choices":\r\ndata: [{"index":0,"delta":{"content":"好"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'
  const encoder = new TextEncoder(), bytes = encoder.encode(text)
  const streamed = new Response(new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index++) controller.enqueue(bytes.slice(index, index + 1)); controller.close() } }))
  const result = await streamModelReply(config, messages, [], { fetch: async () => streamed })
  assert.equal(result.content, '好')
})
test('compatible request uses user-selected URL/model and credentials only in headers', async () => {
  let request: RequestInit | undefined
  await streamModelReply(config, messages, [], { fetch: async (url, input) => { assert.equal(url, 'https://provider.test/v1/chat/completions'); request = input; return response(chatText('Done')) } })
  assert.equal((request?.headers as Record<string, string>).Authorization, 'Bearer unit-test-secret')
  assert.equal(request?.redirect, 'error'); const body = JSON.parse(String(request?.body)); assert.equal(body.model, 'user-model'); assert.equal(body.stream, true); assert.ok(!String(request?.body).includes(config.apiKey!))
})
test('Anthropic streaming aggregates tool input deltas and ignores ping/thinking events', async () => {
  const stream = event({ type: 'message_start', message: { usage: { input_tokens: 5 } } }, 'message_start') + event({ type: 'ping' }, 'ping') + event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) + event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Editing' } }) + event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'edit', input: {} } }) + event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"value":' } }) + event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '5}' } }) + event({ type: 'content_block_stop', index: 1 }) + event({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } }) + event({ type: 'message_stop' })
  let headers: Record<string, string> | undefined
  const result = await streamModelReply(anthropic, messages, [tool], { fetch: async (_url, input) => { headers = input!.headers as Record<string, string>; return response(stream) } })
  assert.deepEqual(result.toolCalls, [{ id: 'toolu_1', name: 'edit', arguments: '{"value":5}' }]); assert.equal(result.content, 'Editing'); assert.deepEqual(result.usage, { input_tokens: 5, output_tokens: 12 }); assert.equal(headers?.['x-api-key'], config.apiKey); assert.equal(headers?.['anthropic-version'], '2023-06-01')
})
test('Anthropic non-fragmented initial tool input remains available', async () => {
  const stream = event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_2', name: 'edit', input: { value: 7 } } }) + event({ type: 'content_block_stop', index: 0 }) + event({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }) + event({ type: 'message_stop' })
  assert.equal((await streamModelReply(anthropic, messages, [], { fetch: fixedFetch(stream) })).toolCalls[0]!.arguments, '{"value":7}')
})
test('incomplete and truncated streams reject without tool execution', async () => {
  await assert.rejects(streamModelReply(config, messages, [], { fetch: fixedFetch(event({ choices: [{ delta: { content: 'partial' } }] })) }), /complete response/)
  await assert.rejects(streamModelReply(config, messages, [], { fetch: fixedFetch(event({ choices: [{ delta: {}, finish_reason: 'length' }] }) + 'data: [DONE]\n\n') }), /truncated/)
  await assert.rejects(streamModelReply(anthropic, messages, [], { fetch: fixedFetch(event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })) }), /complete response/)
})
test('HTTP and in-stream errors redact the API key', async () => {
  await assert.rejects(streamModelReply(config, messages, [], { fetch: async () => new Response(`bad key ${config.apiKey}`, { status: 401 }) }), error => error instanceof ModelClientError && error.status === 401 && !error.message.includes(config.apiKey!))
  await assert.rejects(streamModelReply(anthropic, messages, [], { fetch: fixedFetch(event({ type: 'error', error: { message: `bad ${config.apiKey}` } }, 'error')) }), error => error instanceof ModelClientError && !error.message.includes(config.apiKey!))
})
test('abort stops a stalled response stream and timeout covers body streaming', async () => {
  const stalled: typeof fetch = async () => new Response(new ReadableStream({ start() {} }))
  const controller = new AbortController(), pending = streamModelReply(config, messages, [], { fetch: stalled, signal: controller.signal }); setTimeout(() => controller.abort(), 10)
  await assert.rejects(pending, error => error instanceof ModelClientError && error.code === 'ABORTED')
  await assert.rejects(streamModelReply({ ...config, timeoutMs: 10 }, messages, [], { fetch: stalled }), error => error instanceof ModelClientError && error.code === 'TIMEOUT')
})
test('tool arguments and duplicate IDs are bounded before execution', async () => {
  await assert.rejects(streamModelReply(config, messages, [], { fetch: fixedFetch(chatCall('edit', 'x'.repeat(65537))) }), /allowed size/)
  const duplicate = event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'same', function: { name: 'edit', arguments: '{}' } }, { index: 1, id: 'same', function: { name: 'inspect', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n'
  await assert.rejects(streamModelReply(config, messages, [], { fetch: fixedFetch(duplicate) }), /duplicate/)
})
test('agent loop maps model-safe names back to MCP host and returns tool errors to model', async () => {
  let round = 0; const calls: { name: string; args: unknown }[] = [], requests: any[] = [], events: string[] = []
  const result = await runModelAgent(config, { messages, host: { listTools: async () => [tool], callTool: async (name, args) => { calls.push({ name, args }); return { isError: true, content: [{ type: 'text', text: 'STALE_REVISION' }] } } }, onEvent: item => events.push(item.type), fetch: async (_url, input) => { requests.push(JSON.parse(String(input!.body))); return response(round++ === 0 ? chatCall('mcp_0_document_apply', '{"value":5}') : chatText('The editor reported stale state.')) } })
  assert.deepEqual(calls, [{ name: 'document.apply', args: { value: 5 } }]); assert.equal(result.calls, 1); assert.equal(result.rounds, 2)
  assert.equal(requests[0].tools[0].function.name, 'mcp_0_document_apply'); assert.match(requests[1].messages.at(-1).content, /STALE_REVISION/); assert.deepEqual(events, ['assistant', 'tool-start', 'tool-result', 'text', 'assistant'])
})
test('invalid JSON and hallucinated tools do not reach MCP host', async () => {
  let round = 0, calls = 0
  const result = await runModelAgent(config, { messages, host: { listTools: async () => [tool], callTool: async () => { calls++; return {} } }, fetch: async () => response(round++ === 0 ? chatCall('mcp_0_document_apply', '{bad') : round === 2 ? chatCall('not_available', '{}', 'call_2') : chatText('Corrected.')) })
  assert.equal(calls, 0); assert.equal(result.calls, 2); assert.equal(result.messages.filter(message => message.role === 'tool' && message.error).length, 2)
})
test('agent cancellation prevents later calls even when host operation is in flight', async () => {
  const controller = new AbortController(); let calls = 0
  const pending = runModelAgent(config, { messages, signal: controller.signal, host: { listTools: async () => [tool], callTool: async () => { calls++; controller.abort(); return new Promise(() => {}) } }, fetch: fixedFetch(chatCall('mcp_0_document_apply', '{}')) })
  await assert.rejects(pending, error => error instanceof ModelClientError && error.code === 'ABORTED'); assert.equal(calls, 1)
})
test('agent runaway rounds are limited', async () => {
  let calls = 0
  await assert.rejects(runModelAgent(config, { messages, maxRounds: 2, host: { listTools: async () => [tool], callTool: async () => { calls++; return {} } }, fetch: fixedFetch(chatCall('mcp_0_document_apply', '{}')) }), /2 model rounds/)
  assert.equal(calls, 2)
})
test('tool preview images retain valid protocol ordering for multiple parallel tool results', () => {
  const conversation: ModelMessage[] = [{ role: 'system', content: 'Edit safely' }, { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'preview', arguments: '{}' }, { id: 'b', name: 'inspect', arguments: '{}' }] }, { role: 'tool', toolCallId: 'a', name: 'document.preview', content: 'preview', images: [{ mimeType: 'image/png', data: 'cG5n' }] }, { role: 'tool', toolCallId: 'b', content: 'state' }]
  const compatible = modelRequestBody(config, conversation, []) as any
  assert.deepEqual(compatible.messages.map((message: any) => message.role), ['system', 'assistant', 'tool', 'tool', 'user']); assert.equal(compatible.messages.at(-1).content[1].image_url.url, 'data:image/png;base64,cG5n')
  const claude = modelRequestBody(anthropic, conversation, []) as any
  assert.equal(claude.system, 'Edit safely'); assert.equal(claude.messages.length, 2); assert.equal(claude.messages[1].content.length, 2); assert.equal(claude.messages[1].content[0].content[1].source.media_type, 'image/png')
})
test('MCP preview images are separated from text and passed back as model images', async () => {
  let round = 0; const requests: any[] = []
  await runModelAgent(config, { messages, host: { listTools: async () => [tool], callTool: async () => ({ content: [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }, { type: 'text', text: 'preview' }] }) }, fetch: async (_url, input) => { requests.push(JSON.parse(String(input!.body))); return response(round++ === 0 ? chatCall('mcp_0_document_apply', '{}') : chatText('Preview verified.')) } })
  const toolMessage = requests[1].messages.find((message: any) => message.role === 'tool'); assert.ok(!toolMessage.content.includes('cG5n')); assert.equal(requests[1].messages.at(-1).content[1].image_url.url, 'data:image/png;base64,cG5n')
})
test('real local HTTP service streams tool call, receives MCP result and completes next model turn', async () => {
  const { createServer } = await import('node:http')
  let requests = 0, actualTool = '', actualArgs: unknown
  const server = createServer(async (request, reply) => {
    assert.equal(request.url, '/v1/chat/completions'); assert.equal(request.headers.authorization, 'Bearer unit-test-secret')
    let json = ''; for await (const part of request) json += part
    const body = JSON.parse(json)
    assert.equal(body.model, 'user-model')
    const text = requests++ === 0 ? chatCall(body.tools[0].function.name, '{"value":42}') : chatText('Completed through MCP.')
    if (requests === 2) assert.ok(body.messages.some((message: any) => message.role === 'tool' && message.content.includes('revision')))
    reply.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (let index = 0; index < text.length; index += 7) { reply.write(text.slice(index, index + 7)); await new Promise<void>(resolve => setImmediate(resolve)) }
    reply.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  try {
    const result = await runModelAgent({ ...config, endpoint: `http://127.0.0.1:${address.port}/v1` }, { messages, host: { listTools: async () => [tool], callTool: async (name, args) => { actualTool = name; actualArgs = args; return { structuredContent: { revision: 2 }, content: [{ type: 'text', text: 'applied' }] } } } })
    assert.equal(actualTool, 'document.apply'); assert.deepEqual(actualArgs, { value: 42 }); assert.equal(result.rounds, 2); assert.equal(result.messages.at(-1)!.content, 'Completed through MCP.'); assert.equal(requests, 2)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})
