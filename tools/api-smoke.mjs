import {createServer} from 'node:http';
import {panel,CDP} from './cdp.mjs';
const received=[];
const server=createServer(async(req,res)=>{
 let data='';for await(const chunk of req)data+=chunk;
 const body=JSON.parse(data);received.push({path:req.url,body});
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 if(req.url.endsWith('/responses')){
  res.write('data: '+JSON.stringify({type:'response.output_text.delta',delta:'本机测试成功'})+'\n\n');
  res.end('data: '+JSON.stringify({type:'response.completed'})+'\n\n');
 }else{
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'兼容接口测试成功'}}]})+'\n\n');
  res.end('data: [DONE]\n\n');
 }
});
await new Promise(resolve=>server.listen(9231,'127.0.0.1',resolve));
const cdp=await panel();
const original=await cdp.eval('(async()=>{const {config}=await window.aiApi.get();return config})()');
try{
 const test={...original,provider:'api',model:'local-test',baseUrl:'http://127.0.0.1:9231/v1',apiMode:'responses'};
 await cdp.eval(`window.aiApi.save(${JSON.stringify(test)})`);
 await cdp.eval('window.aiApi.begin("explain")');
 const targets=await(await fetch('http://127.0.0.1:9228/json/list')).json();
 const select=new CDP(targets.find(t=>t.url.includes('/selection/index.html')).webSocketDebuggerUrl);
 await select.eval('(void window.aiApi.selected({x:60,y:60,width:140,height:60}),true)').catch(e=>{if(!e.message.includes('Page closed'))throw e});select.close();
 await new Promise(r=>setTimeout(r,250));
 await cdp.eval('window.aiApi.send("测试问题")');
 let result=await cdp.eval('(async()=>{const {state}=await window.aiApi.get();return {error:state.error,busy:state.busy,answer:state.messages.at(-1).text}})()');
 if(result.error||result.answer!=='本机测试成功')throw new Error(JSON.stringify(result));
 console.log('Responses roundtrip: passed');
 await cdp.eval('window.aiApi.send("继续测试")');
 const follow=received.at(-1).body;
 if(follow.input.length!==4)throw new Error('Follow-up context was not preserved');
 console.log('Follow-up context: passed');
 await cdp.eval(`window.aiApi.save(${JSON.stringify({...test,apiMode:'chat'})})`);
 await cdp.eval('window.aiApi.send("兼容协议测试")');
 result=await cdp.eval('(async()=>{const {state}=await window.aiApi.get();return {error:state.error,answer:state.messages.at(-1).text}})()');
 if(result.error||result.answer!=='兼容接口测试成功')throw new Error(JSON.stringify(result));
 console.log('Chat Completions roundtrip: passed');
 console.log('Selected image only:',received.every(r=>JSON.stringify(r.body).includes('data:image/png;base64,')));
}finally{
 await cdp.eval(`window.aiApi.save(${JSON.stringify(original)})`);
 cdp.close();await new Promise(resolve=>server.close(resolve));
}
