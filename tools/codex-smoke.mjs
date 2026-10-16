import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const root=resolve('..');
const out=resolve('tools/.codex-smoke.cjs');
await build({entryPoints:['src/main/aiCodex.ts'],bundle:true,platform:'node',format:'cjs',outfile:out});
const require=createRequire(import.meta.url);
const {streamCodex}=require(out);
const cwd=resolve('dist/win-unpacked/verification/codex');await mkdir(cwd,{recursive:true});
const controller=new AbortController();
const timeout=setTimeout(()=>controller.abort(),170000);
let answer='';
try{
 await streamCodex({provider:'codex',codexPath:'',codexModel:'',language:'简体中文'},
 {action:'explain'},[{role:'user',text:'这是一个图片读取测试。只输出图片里的中文文字，不解释。'}],
 resolve('design/marker-text/explain.png'),cwd,controller.signal,text=>answer+=text);
 console.log('Codex vision answer:',answer.slice(0,500));
 await writeFile(resolve('dist/win-unpacked/verification/codex-result.txt'),answer,'utf8');
}finally{clearTimeout(timeout)}
