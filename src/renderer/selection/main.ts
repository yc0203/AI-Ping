import type { AiApi } from '../../shared/ai';
declare global { interface Window { aiApi: AiApi } }
const api = window.aiApi;
const box = document.getElementById('box')!;
const hint = document.getElementById('hint')!;
const image = document.getElementById('screen') as HTMLImageElement;
let start: { x: number; y: number; id: number } | null = null;
let pending = false, ready = false;
let title = '按住左键拖动框选 · 松开完成 · Esc / 右键取消';

// The frozen screenshot must never start Chromium's native image drag. That
// cancels pointer events and used to leave a zero-sized or stale selection.
image.draggable = false;
document.addEventListener('dragstart', e => e.preventDefault());
api.onCapture(data => {
  ready = false; title = data.title;
  image.onload = () => { ready = true; hint.textContent = title; };
  image.src = data.image;
});
const point = (e: PointerEvent) => ({ x: Math.max(0, Math.min(innerWidth, e.clientX)), y: Math.max(0, Math.min(innerHeight, e.clientY)) });
const rect = (e: PointerEvent) => {
  const p = point(e);
  return { x: Math.min(start!.x, p.x), y: Math.min(start!.y, p.y), width: Math.abs(start!.x - p.x), height: Math.abs(start!.y - p.y) };
};
function reset(): void {
  const previous = start; start = null;
  if (previous && document.body.hasPointerCapture(previous.id)) document.body.releasePointerCapture(previous.id);
  box.style.display = 'none'; hint.textContent = title;
}
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.isPrimary || pending || !ready || start) return;
  e.preventDefault(); start = { ...point(e), id: e.pointerId };
  document.body.setPointerCapture(e.pointerId);
  box.style.display = 'block'; box.style.left = `${start.x}px`; box.style.top = `${start.y}px`;
  box.style.width = box.style.height = '0';
});
document.addEventListener('pointermove', e => {
  if (!start || e.pointerId !== start.id || pending) return;
  const r = rect(e);
  box.style.left = `${r.x}px`; box.style.top = `${r.y}px`;
  box.style.width = `${r.width}px`; box.style.height = `${r.height}px`;
  hint.textContent = `${Math.round(r.width)} × ${Math.round(r.height)} · 松开左键完成 · Esc / 右键取消`;
});
document.addEventListener('pointerup', e => {
  if (!start || e.pointerId !== start.id || e.button !== 0 || pending) return;
  e.preventDefault(); const r = rect(e); reset();
  // A click (including a leftover wheel click) is not a failed screenshot.
  if (r.width < 4 || r.height < 4) return;
  pending = true; hint.textContent = '正在截取所选区域…';
  void api.selected(r).catch(err => { pending = false; hint.textContent = String(err); });
});
document.addEventListener('pointercancel', () => { if (!pending) reset(); });
document.body.addEventListener('lostpointercapture', e => {
  // A release from the preceding click can arrive after a new drag starts.
  // Only reset when this drag has actually lost its capture.
  if (start?.id === e.pointerId && !pending && !document.body.hasPointerCapture(e.pointerId)) reset();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') void api.cancel(); });
document.addEventListener('contextmenu', e => { e.preventDefault(); void api.cancel(); });
