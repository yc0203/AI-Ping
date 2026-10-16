import type { Readable } from 'node:stream';
import { mkdir } from 'node:fs/promises';
import { normalizeAi, type AiConfig } from '../shared/ai';
import { apiRequest } from './aiApi';
import { checkCodex, findCodex } from './aiCodex';
import { AiStore } from './aiStore';

/** Allow only connection settings; installation must preserve marker customization. */
export function parseSetup(raw: unknown, current: AiConfig): { config: AiConfig; key?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置输入必须是 JSON 对象');
  const request = raw as Record<string, unknown>;
  if (request.provider !== 'api' && request.provider !== 'codex') throw new Error('provider 必须是 api 或 codex');
  if (request.apiMode !== undefined && request.apiMode !== 'responses' && request.apiMode !== 'chat') throw new Error('apiMode 必须是 responses 或 chat');
  const next = { ...current, provider: request.provider };
  for (const field of ['baseUrl', 'model', 'apiMode', 'codexPath', 'codexModel', 'language'] as const) {
    if (request[field] === undefined) continue;
    if (typeof request[field] !== 'string') throw new Error(`${field} 必须是字符串`);
    Object.assign(next, { [field]: request[field] });
  }
  if (request.key !== undefined && (typeof request.key !== 'string' || request.key.length > 2000)) throw new Error('API 密钥格式不正确');
  const config = normalizeAi(next);
  if (config.provider === 'api') apiRequest(config, { action: 'capture' }, []); // Validate URL/model without a network request.
  return { config, key: request.key as string | undefined };
}

export async function configureAiFromStdin(input: Readable, dir: string): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 64 * 1024) throw new Error('配置输入超过大小限制');
    chunks.push(buffer);
  }
  let request: unknown;
  try { request = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error('配置输入不是有效 JSON'); } // Never echo input containing a secret.
  const store = new AiStore(dir);
  await store.load();
  const { config, key } = parseSetup(request, store.config);
  let message = 'API configuration saved. No inference request was sent.';
  if (config.provider === 'codex') {
    config.codexPath = await findCodex(config.codexPath);
    await mkdir(dir, { recursive: true });
    await checkCodex(config, dir);
    message = 'Local Codex connection verified and configuration saved.';
  }
  await store.save(config, key);
  return message;
}
