// Requires a running local AI-Ping with --remote-debugging-port=9228.
// Uses a loopback mock only; no screenshot is sent to an external AI service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CDP, panel } from './cdp.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await delay(50); }
  throw new Error('UI did not reach the expected state');
}
const requests = [];
const server = createServer(async (req, res) => {
  let data = ''; for await (const chunk of req) data += chunk;
  requests.push(JSON.parse(data));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '浮窗流式回答' }) + '\n\n');
  const timer = setTimeout(() => {
    res.write('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '：已验证。' }) + '\n\n');
    res.end('data: ' + JSON.stringify({ type: 'response.completed' }) + '\n\n');
  }, 800);
  res.once('close', () => clearTimeout(timer));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const main = await panel();
let original, floating;
try {
  original = await main.eval('(async()=>{const {config}=await window.aiApi.get();return config})()');
  const config = { ...original, provider: 'api', apiMode: 'responses', model: 'local-test', baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
  await main.eval(`window.aiApi.save(${JSON.stringify(config)})`);
  await main.eval('window.aiApi.begin("explain")');
  const pages = await (await fetch('http://127.0.0.1:9228/json/list')).json();
  const selection = new CDP(pages.find(t => t.url.includes('/selection/')).webSocketDebuggerUrl);
  try {
    await waitFor(() => selection.eval('document.getElementById("screen").complete && document.getElementById("screen").naturalWidth > 0'));
    await selection.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    assert.equal(await selection.eval('document.getElementById("screen").draggable'), false);
    const mouse = (type, x, y, buttons) => selection.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
    await mouse('mousePressed', 80, 80, 1);
    await mouse('mouseReleased', 80, 80, 0);
    assert.doesNotMatch(await selection.eval('document.getElementById("hint").textContent'), /太小/);
    // Drag up and left to exercise reversed coordinates and real pointer capture.
    await mouse('mousePressed', 440, 340, 1);
    for (let step = 1; step <= 5; step++) await mouse('mouseMoved', 440 - step * 52, 340 - step * 44, 1);
    await waitFor(() => selection.eval('document.getElementById("box").style.width === "260px" && document.getElementById("box").style.height === "220px"'));
    assert.equal(await selection.eval('document.getElementById("box").style.width'), '260px');
    assert.equal(await selection.eval('document.getElementById("box").style.height'), '220px');
    await mouse('mouseReleased', 180, 120, 0).catch(e => { if (!e.message.includes('Page closed')) throw e; });
  } finally { selection.close(); }
  console.log('Hold / reverse drag / release and harmless click: passed');
  await waitFor(async () => {
    const pages = await (await fetch('http://127.0.0.1:9228/json/list')).json();
    const result = pages.find(t => t.url.includes('/result/'));
    if (!result) return false;
    floating ??= new CDP(result.webSocketDebuggerUrl);
    return floating.eval('!!document.getElementById("question") && document.getElementById("preview").naturalWidth > 0');
  });
  assert.equal(requests.length, 0, 'Preview must not automatically upload');
  assert.match(await floating.eval('document.getElementById("provider").textContent'), /API/);
  assert.equal(await floating.eval('document.getElementById("question").value'), '解释这里');
  await assert.rejects(floating.eval(`window.aiApi.save(${JSON.stringify(config)})`), /仅供 AI 面板/);
  await floating.eval('document.getElementById("ask-form").requestSubmit()');
  await waitFor(() => floating.eval('(async()=>{const {state}=await window.aiApi.get();return state.busy && document.getElementById("answer").textContent === "浮窗流式回答"})()'));
  console.log('Floating preview / scoped permissions / live streaming: passed');
  await waitFor(() => floating.eval('(async()=>{const {state}=await window.aiApi.get();return !state.busy && document.getElementById("answer").textContent === "浮窗流式回答：已验证。"})()'));
  await floating.eval('document.getElementById("question").value="继续说明"; document.getElementById("ask-form").requestSubmit()');
  await waitFor(() => floating.eval('(async()=>{const {state}=await window.aiApi.get();return !state.busy && state.messages.length === 4})()'));
  assert.equal(requests[1].input.length, 4);
  assert.equal(await floating.eval('document.getElementById("answer").textContent'), '浮窗流式回答：已验证。');
  console.log('Follow-up in floating window: passed');
  if (!process.argv.includes('--preview')) {
    await floating.eval('window.aiApi.openPanel()');
    assert.equal(await main.eval('(async()=>{const {state}=await window.aiApi.get();return state.messages.length})()'), 4);
    console.log('Expand with full conversation preserved: passed');
  }
} finally {
  await main.eval('window.aiApi.cancel()');
  if (original) await main.eval(`window.aiApi.save(${JSON.stringify(original)})`);
  floating?.close(); main.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
