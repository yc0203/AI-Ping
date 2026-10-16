import { safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeAi, type AiConfig, type PublicConfig } from '../shared/ai';

export class AiStore {
  config: AiConfig = normalizeAi(null);
  private encryptedKey = '';
  constructor(readonly dir: string) {}
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'ai.json'), 'utf8'));
      this.config = normalizeAi(raw);
      if (typeof raw.encryptedKey === 'string') this.encryptedKey = raw.encryptedKey;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[ai] configuration unavailable'); }
  }
  public(): PublicConfig { return { ...this.config, hasKey: this.encryptedKey.length > 0 }; }
  key(): string {
    if (!this.encryptedKey) return '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用');
    try { return safeStorage.decryptString(Buffer.from(this.encryptedKey, 'base64')); }
    catch { throw new Error('无法解密 API 密钥，请在此电脑重新填写'); }
  }
  async save(config: AiConfig, key?: string): Promise<PublicConfig> {
    const normalized = normalizeAi(config);
    let encryptedKey = this.encryptedKey;
    if (key !== undefined) {
      if (typeof key !== 'string' || key.length > 2000) throw new Error('API 密钥格式不正确');
      if (key && !safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，未保存密钥');
      encryptedKey = key ? safeStorage.encryptString(key.trim()).toString('base64') : '';
    }
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, 'ai.json');
    await writeFile(`${file}.tmp`, JSON.stringify({ ...normalized, encryptedKey }), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    this.config = normalized;
    this.encryptedKey = encryptedKey;
    return this.public();
  }
}
