import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, streamApi } from '../../src/main/aiApi';
import { DEFAULT_AI } from '../../src/shared/ai';
const config = { ...DEFAULT_AI, provider: 'api' as const, model: 'vision-test' };
afterEach(() => vi.unstubAllGlobals());
describe('AI API adapter', () => {
  it('sends only the cropped image and keeps conversation context for both protocols', () => {
    const content = { action: 'explain' as const, image: 'data:image/png;base64,AA==' };
    const messages = [{ role: 'user' as const, text: '怎么操作？' }];
    const responses = apiRequest(config, content, messages);
    expect(responses.url).toBe('https://api.openai.com/v1/responses');
    expect((responses.body as any).input[0].content[1].image_url).toBe(content.image);
    expect((responses.body as any).store).toBe(false);
    const chat = apiRequest({ ...config, apiMode: 'chat' }, content, messages);
    expect(chat.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((chat.body as any).messages.at(-1).content).toBe('怎么操作？');
  });
  it('rejects insecure remote endpoints and missing models before sending data', () => {
    expect(() => apiRequest({ ...config, baseUrl: 'http://example.com/v1' }, { action: 'plan' }, [])).toThrow('HTTPS');
    expect(() => apiRequest({ ...config, model: '' }, { action: 'plan' }, [])).toThrow('模型');
    expect(apiRequest({ ...config, baseUrl: 'http://127.0.0.1:3000/v1' }, { action: 'plan' }, []).url).toContain('127.0.0.1');
  });
  it('decodes UTF-8 deltas across arbitrary chunk and CRLF boundaries', async () => {
    const bytes = new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"你好"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n');
    const body = new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i+=3) controller.enqueue(bytes.slice(i,i+3)); controller.close(); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } })));
    let answer = '';
    await streamApi(config, '', { action: 'explain' }, [], new AbortController().signal, text => answer += text);
    expect(answer).toBe('你好');
  });
  it('reports incomplete streams rather than presenting partial output as complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"type":"response.output_text.delta","delta":"半句"}\n\n', { headers: { 'content-type': 'text/event-stream' } })));
    await expect(streamApi(config, '', { action: 'explain' }, [], new AbortController().signal, () => {})).rejects.toThrow('连接中断');
  });
  it('uses helpful status messages without echoing service errors or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret diagnostic', { status: 401 })));
    await expect(streamApi(config, 'private-key', { action: 'explain' }, [], new AbortController().signal, () => {})).rejects.toThrow('密钥无效');
  });
});
