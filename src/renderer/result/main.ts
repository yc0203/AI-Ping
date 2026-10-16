import { ACTION_LABELS, type AiApi, type AiContent, type AiState, type PublicConfig } from '../../shared/ai';

declare global { interface Window { aiApi: AiApi } }
const api = window.aiApi;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const question = el<HTMLTextAreaElement>('question');
let state: AiState;
let previous: AiContent | null = null;
let answer = '';
let ready = false;
const execute = (fn: () => Promise<unknown>) => void fn().catch(e => { el('notice').textContent = e instanceof Error ? e.message : String(e); });
function renderProvider(config: PublicConfig): void {
  el('provider').textContent = config.provider === 'codex' ? '本机 Codex · 可拖动此标题栏' : `API · ${config.model || '请配置模型'}`;
}

function render(next: AiState): void {
  const scroller = el('scroll');
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
  state = next;
  const content = state.content;
  const changed = content?.image !== previous?.image || content?.text !== previous?.text || content?.action !== previous?.action;
  previous = content;
  const capture = content?.action === 'capture';
  el('title').textContent = content ? ACTION_LABELS[content.action] : '快速解答';
  const icons = { explain: 'enemy_missing', plan: 'assist_me', 'translate-screen': 'need_vision', 'translate-selection': 'omw', capture: 'generic_ping', none: 'generic_ping' };
  const icon = el<HTMLImageElement>('icon');
  const iconPath = `../textures/${icons[content?.action ?? 'none']}.png`;
  if (icon.getAttribute('src') !== iconPath) icon.src = iconPath;
  el('context').hidden = !content;
  const preview = el<HTMLImageElement>('preview');
  preview.hidden = !content?.image;
  if (content?.image && preview.getAttribute('src') !== content.image) preview.src = content.image;
  el('selected-text').hidden = !content?.text;
  el('selected-text').textContent = content?.text ?? '';
  el('copy-image').hidden = el('save-image').hidden = !content?.image;
  el('recapture').textContent = content?.action === 'translate-selection' ? '重新划词' : '重新框选';
  el('ask-form').hidden = capture;
  el('capture-note').hidden = !capture;
  el('notice').textContent = state.error;
  const last = state.messages.findLast(m => m.role === 'assistant');
  const asked = state.messages.findLast(m => m.role === 'user');
  answer = last?.text ?? '';
  el('reply').hidden = !last;
  el('asked').textContent = asked?.text ?? '';
  el('answer').textContent = answer || (state.busy ? '正在分析所选内容…' : '尚未返回答案');
  el('reply-status').textContent = state.busy ? '正在回答…' : state.error ? '回答已停止' : 'AI 回答';
  el<HTMLButtonElement>('copy-answer').disabled = !answer;
  el<HTMLButtonElement>('send').disabled = !content || state.busy;
  el('send').textContent = last ? '追问' : '发送并解答';
  el('stop').hidden = !state.busy;
  el('question-label').textContent = last ? '继续追问' : content?.action === 'plan' ? '想完成什么操作？' : '问题（可以直接使用下面的默认问题）';
  el('send-note').textContent = last ? '沿用所选内容 · Ctrl+Enter 发送' : '确认后发送所选内容';
  if (changed) { question.value = state.draft; el<HTMLDetailsElement>('context').open = true; }
  if (state.busy) el<HTMLDetailsElement>('context').open = false;
  if (atBottom && last) scroller.scrollTop = scroller.scrollHeight;
}

el('expand').onclick = () => execute(() => api.openPanel());
el('close').onclick = () => execute(() => api.dismiss());
el('stop').onclick = () => execute(() => api.cancel());
el('copy-answer').onclick = () => execute(async () => { await api.copy(answer); el('notice').textContent = '答案已复制'; });
el('copy-image').onclick = () => execute(async () => { await api.copyImage(); el('notice').textContent = '截图已复制'; });
el('save-image').onclick = () => execute(() => api.saveImage());
el('recapture').onclick = () => execute(() => api.begin(state.content?.action ?? 'explain'));
el('ask-form').onsubmit = e => {
  e.preventDefault();
  if (!ready || state.busy) return;
  const text = question.value.trim();
  if (!text) { el('notice').textContent = '请填写问题或想完成的目标'; question.focus(); return; }
  question.value = ''; execute(() => api.send(text));
};
question.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); el<HTMLFormElement>('ask-form').requestSubmit(); } };
document.onkeydown = e => { if (e.key === 'Escape') execute(() => api.dismiss()); };
api.onState(render);
api.onConfig(renderProvider);
api.onDelta(text => {
  const last = state?.messages.at(-1);
  if (last?.role === 'assistant') { last.text += text; render(state); }
});
execute(async () => {
  const initial = await api.get();
  renderProvider(initial.config);
  render(initial.state); ready = true;
});
