import { app, BrowserWindow, ClipboardItem, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, nativeImage, screen, type Display, type NativeImage, type IpcMainInvokeEvent } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { ACTIONS, ACTION_LABELS, cropRect, resultBounds, type Action, type AiState, type AiConfig, type Rect } from '../shared/ai';
import type { PingId } from '../shared/pings';
import { loadPage, pageUrl, preloadPath, settingsDir, IS_MAC } from './paths';
import { AiStore } from './aiStore';
import { streamApi } from './aiApi';
import { checkCodex, streamCodex } from './aiCodex';
import type { OverlayManager } from './overlayManager';

export class AiController {
  readonly store = new AiStore(settingsDir());
  selecting = false;
  private window: BrowserWindow | null = null;
  private result: BrowserWindow | null = null;
  private resultReady = false;
  private resultWanted = false;
  private anchor: Rect | null = null;
  private selection: BrowserWindow | null = null;
  private textProcess: ChildProcess | null = null;
  private snapshot: { image: NativeImage; display: Display; action: Action } | null = null;
  private abort: AbortController | null = null;
  private generation = 0;
  private saves: Promise<unknown> = Promise.resolve();
  private state: AiState = { content: null, messages: [], draft: '', busy: false, error: '' };
  constructor(private overlays: OverlayManager, private suspend: (on: boolean) => void) {}

  async start(): Promise<void> {
    await this.store.load();
    this.overlays.updateAi(this.store.config.enabled ? this.store.config.bindings : null);
    const trusted = (e: IpcMainInvokeEvent) => {
      if (!this.window || e.sender !== this.window.webContents) throw new Error('此操作仅供 AI 面板使用');
    };
    const conversation = (e: IpcMainInvokeEvent) => {
      if (e.sender !== this.window?.webContents && e.sender !== this.result?.webContents) throw new Error('无效的 AI 窗口来源');
    };
    ipcMain.handle('ai:open', (e) => {
      const own = pageUrl('settings');
      const u = e.sender.getURL();
      if (u.split('#')[0] === own.split('#')[0]) this.open();
    });
    ipcMain.handle('ai:get', e => { conversation(e); return { config: this.store.public(), state: this.state }; });
    ipcMain.handle('ai:expand', e => { conversation(e); this.result?.hide(); this.open(); this.push(); });
    ipcMain.handle('ai:dismiss', e => { conversation(e); this.resultWanted = false; this.cancel(); this.result?.hide(); });
    ipcMain.handle('ai:save', (e, raw: AiConfig, key?: string) => {
      trusted(e);
      const next = this.saves.then(async () => {
        const result = await this.store.save(raw, key);
        this.overlays.updateAi(result.enabled ? result.bindings : null);
        this.result?.webContents.send('ai:config', result);
        return result;
      });
      this.saves = next.catch(() => {}); return next;
    });
    ipcMain.handle('ai:begin', (e, action: Action) => { conversation(e); return this.begin(action); });
    ipcMain.handle('ai:cancel', e => {
      if (e.sender === this.selection?.webContents || e.sender === this.window?.webContents || e.sender === this.result?.webContents) this.cancel();
    });
    ipcMain.handle('ai:selected', (e, rect: Rect) => {
      if (e.sender !== this.selection?.webContents) throw new Error('无效的选区来源');
      return this.selected(rect);
    });
    ipcMain.handle('ai:send', (e, text: string) => { conversation(e); return this.send(text); });
    ipcMain.handle('ai:copy', (e, text: string) => { conversation(e); if (typeof text === 'string') return clipboard.writeText(text.slice(0, 200_000)); });
    ipcMain.handle('ai:copy-image', e => {
      conversation(e);
      if (this.state.content?.image) return clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(nativeImage.createFromDataURL(this.state.content.image).toPNG())], { type: 'image/png' }) })]);
    });
    ipcMain.handle('ai:save-image', async e => {
      conversation(e);
      const image = this.state.content?.image;
      if (!image) return;
      const result = await dialog.showSaveDialog(this.result?.isVisible() ? this.result : this.open(), { defaultPath: '截图.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (!result.canceled && result.filePath) await writeFile(result.filePath, nativeImage.createFromDataURL(image).toPNG());
    });
    ipcMain.handle('ai:import', (e, kind: 'icon' | 'sound') => { trusted(e); return this.importAsset(kind); });
    ipcMain.handle('ai:codex-check', async e => {
      trusted(e); await mkdir(this.store.dir, { recursive: true });
      return checkCodex(this.store.config, this.store.dir);
    });
    ipcMain.handle('ai:codex-pick', async e => {
      trusted(e);
      const result = await dialog.showOpenDialog(this.open(), { properties: ['openFile'], filters: [{ name: 'Codex', extensions: IS_MAC ? ['*'] : ['exe'] }] });
      return result.canceled ? null : result.filePaths[0];
    });
    if (!globalShortcut.register('CommandOrControl+Alt+A', () => this.open())) console.warn('[ai] panel shortcut unavailable');
  }

  open(): BrowserWindow {
    this.resultWanted = false; this.result?.hide();
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show(); this.window.focus(); return this.window;
    }
    const w = new BrowserWindow({ width: 1050, height: 790, minWidth: 800, minHeight: 620,
      title: 'AI-Ping · 标记助手', backgroundColor: '#11191f', show: false,
      webPreferences: { preload: preloadPath('ai'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
    this.window = w; w.removeMenu();
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', e => e.preventDefault());
    w.once('ready-to-show', () => w.show());
    w.on('closed', () => { this.window = null; this.cancel(); });
    w.webContents.on('render-process-gone', () => this.cancel());
    void loadPage(w, 'ai'); return w;
  }
  private openResult(): BrowserWindow {
    this.resultWanted = true;
    const cursor = screen.getCursorScreenPoint();
    const anchor = this.anchor ?? { ...cursor, width: 1, height: 1 };
    const display = screen.getDisplayMatching(anchor);
    const bounds = resultBounds(anchor, display.workArea);
    if (this.result && !this.result.isDestroyed()) {
      this.result.setBounds(bounds);
      if (this.resultReady) { this.result.show(); this.result.focus(); this.result.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver'); }
      return this.result;
    }
    const w = new BrowserWindow({ ...bounds, minWidth: Math.min(340, bounds.width), minHeight: Math.min(320, bounds.height),
      title: 'AI-Ping · 快速解答', frame: false, show: false, alwaysOnTop: true, skipTaskbar: true,
      minimizable: false, maximizable: false, fullscreenable: false, backgroundColor: '#11191f',
      webPreferences: { preload: preloadPath('ai'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
    this.result = w; this.resultReady = false;
    w.removeMenu();
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', e => e.preventDefault());
    w.once('ready-to-show', () => {
      if (w.isDestroyed() || this.result !== w) return;
      this.resultReady = true;
      if (this.resultWanted && !this.selecting) { w.show(); w.focus(); w.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver'); this.push(); }
    });
    w.on('closed', () => { if (this.result === w) { this.result = null; this.resultReady = false; this.resultWanted = false; this.cancel(); } });
    w.webContents.on('render-process-gone', () => this.cancel());
    void loadPage(w, 'result'); return w;
  }
  private push(): void {
    this.window?.webContents.send('ai:state', this.state);
    this.result?.webContents.send('ai:state', this.state);
  }
  private error(error: unknown): void {
    this.state.error = error instanceof Error ? error.message : '操作失败'; this.state.busy = false;
    this.openResult(); this.push();
  }
  trigger(id: PingId, displayId: number): void {
    if (!this.store.config.enabled) return;
    const action = this.store.config.bindings[id]?.action;
    if (action && action !== 'none') void this.begin(action, displayId).catch(e => this.error(e));
  }
  cancel(): void {
    const wasBusy = this.state.busy;
    this.generation++;
    this.abort?.abort(); this.abort = null;
    const textProcess = this.textProcess; this.textProcess = null;
    if (textProcess) setTimeout(() => textProcess.kill(), 1200); // Let an in-flight clipboard restoration finish.
    const selection = this.selection; this.selection = null; selection?.destroy(); this.snapshot = null;
    globalShortcut.unregister('Escape');
    this.selecting = false; this.suspend(false);
    this.overlays.setVisible(true);
    this.overlays.setAiHint('');
    if (wasBusy) this.state.error = '已停止回答';
    this.state.busy = false; this.push();
  }
  private finishSelection(): void {
    const selection = this.selection; this.selection = null; selection?.destroy(); this.snapshot = null;
    globalShortcut.unregister('Escape'); this.selecting = false; this.suspend(false);
    this.overlays.setVisible(true);
    this.overlays.setAiHint('');
  }
  async begin(action: Action, displayId?: number): Promise<void> {
    if (!ACTIONS.includes(action) || action === 'none') return;
    this.cancel(); const generation = this.generation;
    this.state = { content: null, messages: [], draft: '', busy: false, error: '' };
    this.anchor = null;
    this.resultWanted = false;
    this.push(); this.window?.hide(); this.result?.hide();
    this.selecting = true; this.suspend(true); this.overlays.cancelWheel();
    globalShortcut.register('Escape', () => { this.cancel(); this.overlays.toast('已取消', '可以重新选择标记功能'); });
    try {
      if (action === 'translate-selection') { await this.selectText(generation); return; }
      const display = screen.getAllDisplays().find(d => d.id === displayId) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      this.overlays.setVisible(false);
      await new Promise(resolve => setTimeout(resolve, 180));
      if (generation !== this.generation) return;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
        width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) } });
      if (generation !== this.generation) return;
      const source = sources.find(s => s.display_id === String(display.id));
      if (!source || source.thumbnail.isEmpty()) throw new Error('无法捕获此屏幕；请检查屏幕录制权限或使用普通桌面窗口');
      this.snapshot = { image: source.thumbnail, display, action };
      const w = new BrowserWindow({ ...display.bounds, frame: false, resizable: false, movable: false,
        alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#11191f',
        webPreferences: { preload: preloadPath('ai'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      this.selection = w; w.setAlwaysOnTop(true, 'screen-saver'); w.removeMenu();
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', e => e.preventDefault());
      w.once('ready-to-show', () => {
        if (w.isDestroyed()) return;
        w.webContents.send('ai:capture', { image: source.thumbnail.toDataURL(), title: `${ACTION_LABELS[action]} · 按住左键拖动框选，松开完成 · Esc / 右键取消` });
        w.show(); w.focus();
      });
      w.on('closed', () => { if (this.selection === w) this.cancel(); });
      w.webContents.on('render-process-gone', () => this.cancel());
      await loadPage(w, 'selection');
    } catch (e) { if (generation === this.generation) { this.finishSelection(); this.error(e); } }
  }
  private selected(rect: Rect): void {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error('框选已结束');
    const cropped = snapshot.image.crop(cropRect(rect, snapshot.display.bounds, snapshot.image.getSize()));
    this.state.content = { action: snapshot.action, image: cropped.toDataURL() };
    this.state.draft = snapshot.action === 'plan' ? '' : ACTION_LABELS[snapshot.action];
    this.anchor = { ...rect, x: snapshot.display.bounds.x + rect.x, y: snapshot.display.bounds.y + rect.y };
    this.finishSelection(); this.openResult(); this.push();
  }
  private async selectText(generation: number): Promise<void> {
    if (IS_MAC) throw new Error('此体验版划词功能暂支持 Windows；Mac 请使用截图翻译');
    this.overlays.setAiHint('划词翻译已开启 · 请在原软件拖动选择文字 · Esc 取消 · 等待最多 60 秒');
    const script = app.isPackaged ? join(process.resourcesPath, 'text-selection.ps1') : join(app.getAppPath(), 'native', 'text-selection.ps1');
    await new Promise<void>((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
      this.textProcess = child;
      let out = '';
      const decoder = new StringDecoder('utf8');
      let settled = false;
      child.stdout?.on('data', data => { if (out.length < 100_000) out += decoder.write(data); });
      child.stderr?.on('data', () => {});
      const timeout = setTimeout(() => child.kill(), 70_000);
      const finish = (failure?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (generation !== this.generation) { resolve(); return; }
        this.textProcess = null;
        this.finishSelection();
        try {
          if (failure) throw failure;
          const result = JSON.parse(out.replace(/^\uFEFF/, '').trim());
          if (result.error || typeof result.text !== 'string' || !result.text) throw new Error(result.error ?? '无法获取所选文字，请改用截图翻译');
          this.state.content = { action: 'translate-selection', text: result.text };
          const cursor = screen.getCursorScreenPoint();
          this.anchor = { ...cursor, width: 1, height: 1 };
          this.state.draft = '翻译所选文字'; this.openResult(); this.push();
        } catch (e) { this.error(e); }
        resolve();
      };
      child.once('error', finish); child.once('close', () => { out += decoder.end(); finish(); });
    });
  }
  async send(text: string): Promise<void> {
    if (this.state.busy) return;
    const content = this.state.content;
    if (!content) throw new Error('请先选择一个标记功能并提供截图或文字');
    if (typeof text !== 'string' || !text.trim() || text.length > 20_000) throw new Error('请输入 1 至 20000 字的问题');
    if (this.state.messages.length >= 40) throw new Error('此对话已达上限，请重新选择区域');
    const generation = this.generation;
    this.state.messages = this.state.messages.filter(m => m.text.length > 0);
    this.state.messages.push({ role: 'user', text: text.trim() });
    const messages = this.state.messages.map(m => ({ ...m }));
    this.state.messages.push({ role: 'assistant', text: '' });
    this.state.busy = true; this.state.error = ''; this.state.draft = ''; this.push();
    const abort = this.abort = new AbortController();
    let imagePath: string | null = null;
    try {
      const delta = (part: string) => {
        if (abort.signal.aborted || generation !== this.generation) return;
        const last = this.state.messages.at(-1)!;
        if (last.text.length + part.length > 200_000) throw new Error('回答过长，已停止');
        last.text += part;
        this.window?.webContents.send('ai:delta', part); // Don't resend the screenshot for every token.
        this.result?.webContents.send('ai:delta', part);
      };
      const config = this.store.config;
      if (config.provider === 'api') await streamApi(config, this.store.key(), content, messages, abort.signal, delta);
      else {
        const tmp = join(this.store.dir, 'tmp'); await mkdir(tmp, { recursive: true });
        if (content.image) { imagePath = join(tmp, `${randomUUID()}.png`); await writeFile(imagePath, nativeImage.createFromDataURL(content.image).toPNG()); }
        await streamCodex(config, content, messages, imagePath, tmp, abort.signal, delta);
      }
      if (generation === this.generation && !this.state.messages.at(-1)?.text) throw new Error('AI 没有返回文字答案');
    } catch (e) {
      if (generation === this.generation) this.state.error = abort.signal.aborted ? '已停止回答' : e instanceof Error ? e.message : 'AI 请求失败';
    } finally {
      if (imagePath) await rm(imagePath, { force: true }).catch(() => {});
      if (generation === this.generation) { this.state.busy = false; this.abort = null; this.push(); }
    }
  }
  private async importAsset(kind: 'icon' | 'sound'): Promise<string | null> {
    if (kind !== 'icon' && kind !== 'sound') throw new Error('未知素材类型');
    const result = await dialog.showOpenDialog(this.open(), { properties: ['openFile'], filters: [{ name: kind === 'icon' ? '标记图标' : '音效',
      extensions: kind === 'icon' ? ['png', 'jpg', 'jpeg', 'webp'] : ['wav', 'ogg', 'mp3'] }] });
    if (result.canceled) return null;
    const data = await readFile(result.filePaths[0]);
    if (data.length > (kind === 'icon' ? 2 : 5) * 1024 * 1024) throw new Error(kind === 'icon' ? '图标需要小于 2 MB' : '音效需要小于 5 MB');
    if (kind === 'icon') {
      const image = nativeImage.createFromBuffer(data);
      if (image.isEmpty()) throw new Error('无法解码此图标');
      const size = image.getSize();
      if (Math.max(size.width, size.height) > 4096) throw new Error('图标尺寸不能超过 4096 像素');
      const scale = Math.min(1, 256 / Math.max(size.width, size.height));
      return image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }).toDataURL();
    }
    const type = data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WAVE' ? 'wav'
      : data.subarray(0, 4).toString('ascii') === 'OggS' ? 'ogg' : data.subarray(0, 3).toString('ascii') === 'ID3' || (data[0] === 255 && (data[1] & 224) === 224) ? 'mpeg' : null;
    if (!type) throw new Error('音效需要是 WAV、OGG 或 MP3');
    return `data:audio/${type};base64,${data.toString('base64')}`;
  }
  destroy(): void { this.cancel(); this.result?.destroy(); this.window?.destroy(); globalShortcut.unregister('CommandOrControl+Alt+A'); }
}
