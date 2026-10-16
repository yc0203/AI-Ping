export class CDP {
  constructor(url) {
    this.socket=new WebSocket(url);this.next=0;this.pending=new Map();
    this.ready=new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject});
    this.socket.onmessage=e=>{const m=JSON.parse(e.data);const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}};
    this.socket.onclose=()=>{for(const p of this.pending.values())p.reject(new Error('Page closed'));this.pending.clear()};
  }
  async send(method,params={}){await this.ready;const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}))})}
  async eval(expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
  close(){this.socket.close()}
}
export async function panel(){const targets=await(await fetch('http://127.0.0.1:9228/json/list')).json();const page=targets.find(t=>t.url.includes('/ai/index.html'));if(!page)throw new Error('AI panel unavailable');return new CDP(page.webSocketDebuggerUrl)}
