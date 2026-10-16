import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { instructions, type AiConfig, type AiContent, type ChatMessage } from '../shared/ai';

export async function findCodex(configured: string): Promise<string> {
  if (configured) {
    if (!isAbsolute(configured) || !existsSync(configured) || (process.platform === 'win32' && !configured.toLowerCase().endsWith('.exe')))
      throw new Error('请选择本机 codex.exe 的完整路径');
    return configured;
  }
  for (const folder of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    const file = join(folder, process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (existsSync(file)) return file;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const dir of folders.reverse()) {
      const file = join(root, dir.name, 'codex.exe');
      if (dir.isDirectory() && existsSync(file)) return file;
    }
  }
  throw new Error('没有找到 Codex，请在设置中选择可执行文件，并先登录 Codex');
}

/** A private stdio connection. Never opens the desktop app's existing conversations. */
export class CodexConnection {
  private child: ChildProcessWithoutNullStreams;
  private next = 0;
  private pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
  onNotification: (method: string, params: any) => void = () => {};
  onFailure: (e: Error) => void = () => {};
  constructor(command: string, cwd: string) {
    this.child = spawn(command, ['app-server', '--stdio', '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false',
      '-c', 'features.multi_agent=false', '-c', 'features.apps=false', '-c', 'web_search="disabled"'],
    { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let msg: any;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined && msg.method) {
        // No approvals, tool execution or login manipulation in this integration.
        this.child.stdin.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: 'Unsupported by AI-Ping' } }) + '\n');
      } else if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        msg.error ? pending.reject(new Error(msg.error.message ?? 'Codex 请求失败')) : pending.resolve(msg.result);
      } else if (msg.method) this.onNotification(msg.method, msg.params);
    });
    // Drain stderr, but don't log account, configuration or request contents.
    this.child.stderr.on('data', () => {});
    const fail = () => {
      const e = new Error('Codex 连接结束，请检查本机安装和登录状态');
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear(); this.onFailure(e);
    };
    this.child.on('error', fail); this.child.on('exit', fail);
    this.child.stdin.on('error', fail);
  }
  request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 接口超时')); }, 60_000);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'ai_ping', title: 'AI-Ping', version: '0.1.0' } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  }
  close(): void {
    this.onFailure = () => {};
    this.child.kill();
  }
}

export async function checkCodex(config: AiConfig, cwd: string): Promise<string> {
  const command = await findCodex(config.codexPath);
  const connection = new CodexConnection(command, cwd);
  try {
    await connection.initialize();
    const result = await connection.request('account/read', { refreshToken: false });
    const account = result.account;
    if (!account && result.requiresOpenaiAuth !== false) throw new Error('Codex 尚未登录，请先在 Codex 中登录');
    return `连接成功 · ${account?.type ?? '自定义服务'}${account?.planType ? ` · ${account.planType}` : ''}`;
  } finally { connection.close(); }
}

export async function streamCodex(config: AiConfig, content: AiContent, messages: ChatMessage[], imagePath: string | null,
  cwd: string, signal: AbortSignal, delta: (text: string) => void): Promise<void> {
  const connection = new CodexConnection(await findCodex(config.codexPath), cwd);
  const abort = () => connection.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('已取消');
    await connection.initialize();
    const loaded = await connection.request('config/read', { includeLayers: false });
    const disabled: Record<string, unknown> = {};
    for (const id of Object.keys(loaded.config?.mcp_servers ?? {})) disabled[`mcp_servers.${id}.enabled`] = false;
    const started = await connection.request('thread/start', {
      cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      ...(config.codexModel ? { model: config.codexModel } : {}),
      baseInstructions: instructions(content.action, config.language), developerInstructions: '只回答所提供的截图、选中文字和问题。不要使用任何工具、读取项目文件或修改电脑。',
      config: disabled,
    });
    const threadId = started.thread.id;
    let settle: (() => void) | undefined, fail: ((e: Error) => void) | undefined;
    const complete = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; });
    void complete.catch(() => {}); // The connection can fail before turn/start's response arrives.
    let currentText = '';
    connection.onFailure = e => fail?.(e);
    connection.onNotification = (method, p) => {
      if (p?.threadId !== threadId) return;
      if (method === 'item/agentMessage/delta') {
        currentText += p.delta ?? '';
        try { delta(p.delta ?? ''); } catch (e) { fail?.(e instanceof Error ? e : new Error('无法显示答案')); connection.close(); }
      }
      if (method === 'item/completed' && p.item?.type === 'agentMessage' && !currentText) {
        currentText = p.item.text ?? '';
        try { delta(currentText); } catch (e) { fail?.(e instanceof Error ? e : new Error('无法显示答案')); connection.close(); }
      }
      if (method === 'turn/completed') {
        p.turn.status === 'completed' ? settle?.() : fail?.(new Error(p.turn.error?.message ?? 'Codex 未完成回答'));
      }
    };
    const prompt = [content.text ? `所选文字：\n${content.text}` : '请分析所选截图。',
      ...messages.map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.text}`)].join('\n\n');
    const input: object[] = [{ type: 'text', text: prompt }];
    if (imagePath) input.push({ type: 'localImage', path: imagePath });
    const timer = setTimeout(() => { fail?.(new Error('Codex 回答超时，请重试')); connection.close(); }, 180_000);
    const onAbort = () => fail?.(new Error('已取消'));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal.aborted) throw new Error('已取消');
      await connection.request('turn/start', { threadId, input });
      await complete;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
  } finally { signal.removeEventListener('abort', abort); connection.close(); }
}
