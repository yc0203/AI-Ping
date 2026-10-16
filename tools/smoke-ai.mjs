import { writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../dist/win-unpacked/', import.meta.url);
await mkdir(new URL('verification/', root), { recursive: true });
const targets = await (await fetch('http://127.0.0.1:9228/json/list')).json();
const target = targets.find(t => t.url.includes('/ai/index.html'));
if (!target) throw new Error('AI panel did not open');
class CDP {
  constructor(url) {
    this.socket = new WebSocket(url); this.next = 0; this.pending = new Map();
    this.ready = new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = e => { const m=JSON.parse(e.data);const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)} };
    this.socket.onclose = () => { for (const p of this.pending.values()) p.reject(new Error('Page closed')); this.pending.clear(); };
  }
  async send(method, params={}) { await this.ready;const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}))}); }
  async eval(expression) {const result=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
  close(){this.socket.close()}
}
const cdp = new CDP(target.webSocketDebuggerUrl);
console.log('Panel:', await cdp.eval('({title:document.title,apiReady:!!window.aiApi,actions:document.querySelectorAll("#actions button").length,bindings:document.querySelectorAll(".binding").length})'));
const shot = await cdp.send('Page.captureScreenshot', { format:'png' });
await writeFile(new URL('verification/panel.png',root),Buffer.from(shot.data,'base64'));
await cdp.eval('document.getElementById("settings-tab").click()');
const settings = await cdp.send('Page.captureScreenshot',{format:'png'});
await writeFile(new URL('verification/settings.png',root),Buffer.from(settings.data,'base64'));
try { console.log('Codex:',await cdp.eval('window.aiApi.checkCodex()')); }
catch(e){console.log('Codex check:',e.message)}
await cdp.eval('document.getElementById("chat-tab").click()');
await cdp.eval('window.aiApi.begin("capture")');
const selectingTargets=await(await fetch('http://127.0.0.1:9228/json/list')).json();
const selection=selectingTargets.find(t=>t.url.includes('/selection/index.html'));
if(!selection)throw new Error('Selection did not open');
const selectCdp=new CDP(selection.webSocketDebuggerUrl);
await selectCdp.eval('new Promise(resolve=>{const check=()=>document.getElementById("screen").complete&&document.getElementById("screen").naturalWidth?resolve(true):setTimeout(check,50);check()})');
await selectCdp.eval('(void window.aiApi.selected({x:40,y:40,width:160,height:80}),true)').catch(e=>{if(!e.message.includes('Page closed'))throw e});
selectCdp.close();
await new Promise(r=>setTimeout(r,300));
console.log('Capture:',await cdp.eval('(async()=>{const {state}=await window.aiApi.get();const img=new Image();img.src=state.content.image;await img.decode();return {action:state.content.action,imageWidth:img.naturalWidth,imageHeight:img.naturalHeight,messages:state.messages.length}})()'));
await cdp.eval('window.aiApi.copyImage()');
console.log('Image clipboard: written');
cdp.close();
