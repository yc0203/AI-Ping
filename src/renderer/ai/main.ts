import { ACTIONS, ACTION_LABELS, type Action, type AiApi, type AiState, type PublicConfig } from '../../shared/ai';
import { ALL_PINGS, textureUrl } from '../../shared/pings';
declare global { interface Window { aiApi: AiApi } }
const api = window.aiApi;
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
let config: PublicConfig;
let state: AiState;
const fail = (e: unknown) => { element('notice').textContent = e instanceof Error ? e.message : String(e); };
const execute = (fn: () => Promise<unknown>) => void fn().catch(fail);
function tab(settings: boolean) {
  element('chat-panel').hidden = settings; element('settings-panel').hidden = !settings;
  element('chat-tab').setAttribute('aria-selected', String(!settings));
  element('settings-tab').setAttribute('aria-selected', String(settings));
}
element('chat-tab').onclick = () => tab(false); element('settings-tab').onclick = () => tab(true);
function providerFields() {
  const isApi = element<HTMLSelectElement>('provider').value === 'api';
  element('api-fields').hidden = !isApi; element('codex-fields').hidden = isApi;
}
element('provider').onchange = providerFields;
function renderConfig() {
  input('enabled').checked = config.enabled;
  for (const [id, value] of Object.entries({ provider: config.provider, 'api-mode': config.apiMode, 'base-url': config.baseUrl,
    model: config.model, 'codex-path': config.codexPath, 'codex-model': config.codexModel, language: config.language })) {
    (element(id) as HTMLInputElement).value = value;
  }
  input('key').value = ''; input('clear-key').checked = false;
  element('key-status').textContent = config.hasKey ? '已保存密钥（系统加密）；留空保留。' : '尚未保存密钥。本机无密钥服务可以留空。';
  providerFields(); renderBindings();
  element('provider-note').textContent = config.provider === 'codex' ? '当前：本机 Codex' : `当前：API · ${config.model || '请先配置模型'}`;
}
function renderBindings() {
  const root = element('bindings'); root.replaceChildren();
  for (const p of ALL_PINGS) {
    const binding = config.bindings[p.id];
    const row = document.createElement('div'); row.className = 'binding';
    const image = new Image(); image.src = binding.icon ?? textureUrl(p.icon); image.alt = p.name; row.append(image);
    const actionLabel = document.createElement('label'); actionLabel.textContent = `${p.name} · 功能`;
    const select = document.createElement('select');
    for (const action of ACTIONS) { const option = new Option(ACTION_LABELS[action], action); select.append(option); }
    select.value = binding.action;
    select.onchange = () => { binding.action = select.value as Action; binding.label = binding.action === 'none' ? '' : ACTION_LABELS[binding.action]; renderBindings(); };
    actionLabel.append(select); row.append(actionLabel);
    const nameLabel = document.createElement('label'); nameLabel.textContent = '标记下方的文字';
    const name = document.createElement('input'); name.value = binding.label; name.maxLength = 16;
    name.oninput = () => binding.label = name.value; nameLabel.append(name); row.append(nameLabel);
    const tools = document.createElement('div'); tools.className = 'tools';
    const button = (text: string, fn: () => Promise<unknown> | void) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
      b.onclick = () => execute(async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } }); tools.append(b);
    };
    button('更换图标', async () => { const icon = await api.importAsset('icon'); if (icon) { binding.icon = icon; image.src = icon; } });
    button('恢复图标', () => { delete binding.icon; image.src = textureUrl(p.icon); });
    button(binding.sound ? '更换音效（已自定义）' : '更换音效', async () => { const sound = await api.importAsset('sound'); if (sound) { binding.sound = sound; renderBindings(); } });
    button('试听', async () => { const audio = new Audio(binding.sound ?? `../sounds/${p.sound}.wav`); audio.volume = .5; await audio.play(); });
    button('恢复音效', () => { delete binding.sound; renderBindings(); });
    row.append(tools); root.append(row);
  }
}
function renderState(next: AiState) {
  const contextChanged = state?.content?.image !== next.content?.image || state?.content?.text !== next.content?.text || state?.content?.action !== next.content?.action;
  state = next;
  const content = state.content;
  element('notice').textContent = state.error;
  element('context').hidden = !content;
  element('screenshot').hidden = !content?.image;
  if (content?.image) element<HTMLImageElement>('screenshot').src = content.image;
  element('selected-text').hidden = !content?.text;
  element('selected-text').textContent = content?.text ?? '';
  element('copy-image').hidden = element('save-image').hidden = !content?.image;
  element('context-title').textContent = content ? ACTION_LABELS[content.action] : '当前内容';
  element<HTMLButtonElement>('send').disabled = !content || state.busy || content.action === 'capture';
  element('stop').hidden = !state.busy;
  if (state.draft) element<HTMLTextAreaElement>('question').value = state.draft;
  const messages = element('messages'); messages.replaceChildren();
  for (const m of state.messages) {
    const block = document.createElement('section'); block.className = `message ${m.role}`;
    const head = document.createElement('div'); head.className = 'message-head'; head.textContent = m.role === 'user' ? '你' : 'AI';
    if (m.role === 'assistant' && m.text) {
      const copy = document.createElement('button'); copy.textContent = '复制'; copy.onclick = () => execute(() => api.copy(m.text)); head.append(copy);
    }
    const text = document.createElement('div'); text.className = 'answer'; text.textContent = m.text || (state.busy ? '正在分析…' : '未收到答案');
    block.append(head, text); messages.append(block);
  }
  if (content && contextChanged) tab(false);
}
element('settings-form').onsubmit = e => {
  e.preventDefault(); execute(async () => {
    element('settings-status').textContent = '正在保存…';
    config.enabled = input('enabled').checked;
    config.provider = element<HTMLSelectElement>('provider').value as 'api' | 'codex';
    config.apiMode = element<HTMLSelectElement>('api-mode').value as 'responses' | 'chat';
    config.baseUrl = input('base-url').value; config.model = input('model').value;
    config.codexPath = input('codex-path').value; config.codexModel = input('codex-model').value; config.language = input('language').value;
    const key = input('clear-key').checked ? '' : input('key').value || undefined;
    try { config = await api.save(config, key); renderConfig(); element('settings-status').textContent = '设置已保存，轮盘和标记已更新'; }
    catch (e) { element('settings-status').textContent = e instanceof Error ? e.message : String(e); }
  });
};
element('check-codex').onclick = () => execute(async () => {
  element('settings-status').textContent = '正在检测 Codex…';
  try { element('settings-status').textContent = await api.checkCodex(); }
  catch (e) { element('settings-status').textContent = e instanceof Error ? e.message : String(e); }
});
element('pick-codex').onclick = () => execute(async () => { const path = await api.pickCodex(); if (path) input('codex-path').value = path; });
element('ask-form').onsubmit = e => { e.preventDefault(); execute(async () => {
  const question = element<HTMLTextAreaElement>('question'); const text = question.value;
  if (!text.trim()) { fail(new Error('请输入问题或目标')); return; }
  question.value = ''; await api.send(text);
}); };
element('stop').onclick = () => execute(() => api.cancel());
element('copy-image').onclick = () => execute(() => api.copyImage());
element('save-image').onclick = () => execute(() => api.saveImage());
for (const [action, icon] of [['explain','enemy_missing'],['plan','assist_me'],['translate-screen','need_vision'],['translate-selection','omw'],['capture','generic_ping']] as const) {
  const b = document.createElement('button'); const img = new Image(); img.src = textureUrl(icon); img.alt = '';
  b.append(img, document.createTextNode(ACTION_LABELS[action])); b.onclick = () => execute(() => api.begin(action)); element('actions').append(b);
}
api.onState(renderState);
api.onDelta(text => {
  const last = state?.messages.at(-1);
  if (last?.role === 'assistant') { last.text += text; renderState(state); }
});
execute(async () => { const initial = await api.get(); config = initial.config; renderConfig(); renderState(initial.state); });
