import { instructions, type AiConfig, type AiContent, type ChatMessage } from '../shared/ai';

export function apiRequest(config: AiConfig, content: AiContent, messages: ChatMessage[]) {
  const url = new URL(config.baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw new Error('API 地址需要 HTTPS；本机服务可使用 HTTP');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含密码、查询参数或片段');
  if (!config.model) throw new Error('请先在 AI 设置中填写模型名称；截图功能需要支持图片的模型');
  const base = url.href.replace(/\/+$/, '');
  const system = instructions(content.action, config.language);
  const initial = content.text ? `用户选择的文字：\n${content.text}` : '请分析所选截图。';
  if (config.apiMode === 'responses') {
    const parts: object[] = [{ type: 'input_text', text: initial }];
    if (content.image) parts.push({ type: 'input_image', image_url: content.image, detail: 'auto' });
    return { url: `${base}/responses`, body: { model: config.model, instructions: system, store: false, stream: true,
      input: [{ role: 'user', content: parts }, ...messages.map(m => ({ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.text }] }))] } };
  }
  const parts: object[] = [{ type: 'text', text: initial }];
  if (content.image) parts.push({ type: 'image_url', image_url: { url: content.image } });
  return { url: `${base}/chat/completions`, body: { model: config.model, stream: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: parts }, ...messages.map(m => ({ role: m.role, content: m.text }))] } };
}

export async function streamApi(config: AiConfig, key: string, content: AiContent, messages: ChatMessage[], signal: AbortSignal, delta: (text: string) => void): Promise<void> {
  const req = apiRequest(config, content, messages);
  const timeout = AbortSignal.timeout(180_000);
  const res = await fetch(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(req.body), signal: AbortSignal.any([signal, timeout]), redirect: 'error' });
  if (!res.ok) {
    const names: Record<number, string> = { 401: '密钥无效或未配置', 403: '服务拒绝访问', 404: 'API 地址或模型不存在', 429: '额度不足或请求过于频繁' };
    throw new Error(`AI 服务返回 ${res.status}：${names[res.status] ?? '请检查服务状态和模型配置'}`);
  }
  if (!res.body) throw new Error('AI 服务没有返回内容');
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const raw = await res.json() as any;
    const answer = raw.output_text ?? raw.output?.flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('') ?? raw.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer) throw new Error('AI 服务返回的格式不受支持');
    delta(answer); return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', ended = false;
  const event = (block: string) => {
    const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { ended = true; return; }
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { throw new Error('AI 返回了无法解析的数据'); }
    if (parsed.error || ['error', 'response.failed', 'response.incomplete'].includes(parsed.type)) throw new Error('AI 请求失败或回答不完整，请重试');
    if (parsed.type === 'response.completed') ended = true;
    const text = parsed.type === 'response.output_text.delta' ? parsed.delta : parsed.choices?.[0]?.delta?.content;
    if (typeof text === 'string') delta(text);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) { event(buffer.slice(0, split)); buffer = buffer.slice(split + 2); }
      if (done) break;
    }
    if (buffer.trim()) event(buffer);
    if (!ended) throw new Error('连接中断，回答可能不完整');
  } finally { reader.releaseLock(); }
}
