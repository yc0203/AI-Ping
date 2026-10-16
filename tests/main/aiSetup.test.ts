import { describe, expect, it, vi } from 'vitest';
import { normalizeAi } from '../../src/shared/ai';
vi.mock('electron', () => ({ safeStorage: {} }));
import { parseSetup } from '../../src/main/aiSetup';

describe('AI installation configuration', () => {
  it('preserves marker bindings, custom labels and the enable toggle', () => {
    const current = normalizeAi({ enabled: false, bindings: { missing: { action: 'plan', label: '我的方案' } } });
    const { config, key } = parseSetup({ provider: 'codex', codexPath: 'C:\\Tools\\codex.exe', bindings: {}, enabled: true, encryptedKey: 'ignore' }, current);
    expect(config.bindings).toEqual(current.bindings);
    expect(config.enabled).toBe(false);
    expect(key).toBeUndefined();
    expect(config.codexPath).toBe('C:\\Tools\\codex.exe');
  });
  it('accepts an explicitly supplied API key without including it in public config', () => {
    const result = parseSetup({ provider: 'api', baseUrl: 'https://example.com/v1', model: 'vision-model', apiMode: 'chat', key: 'test-secret' }, normalizeAi(null));
    expect(result.config.provider).toBe('api');
    expect(result.config.apiMode).toBe('chat');
    expect(result.key).toBe('test-secret');
    expect(JSON.stringify(result.config)).not.toContain('test-secret');
  });
  it('allows unauthenticated loopback services and an explicit key reset', () => {
    const result = parseSetup({ provider: 'api', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-vision', key: '' }, normalizeAi(null));
    expect(result.key).toBe('');
  });
  it('rejects invalid providers, protocols, types and overlong keys', () => {
    for (const raw of [null, [], { provider: 'other' }, { provider: 'api', apiMode: 'other' }, { provider: 'codex', codexPath: 2 }, { provider: 'codex', key: 'x'.repeat(2001) }]) {
      expect(() => parseSetup(raw, normalizeAi(null))).toThrow();
    }
  });
  it('requires an API model and rejects unsafe remote endpoints', () => {
    expect(() => parseSetup({ provider: 'api' }, normalizeAi(null))).toThrow('模型');
    for (const baseUrl of ['http://example.com/v1', 'https://secret@example.com/v1', 'https://example.com/v1?key=secret']) {
      expect(() => parseSetup({ provider: 'api', baseUrl, model: 'vision' }, normalizeAi(null))).toThrow();
    }
  });
});
