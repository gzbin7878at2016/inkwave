// 定位当前成品自己的Three命名空间，避免在同一renderer中混用node_modules的对象/资源ID。
import {readdir,readFile} from 'node:fs/promises';
export async function resolveBundledThree(){
 const found=[];
 for(const name of await readdir('dist-mobile/src/chunks')){
  if(!/^chunk-[A-Z0-9]+\.js$/.test(name))continue;
  const text=await readFile('dist-mobile/src/chunks/'+name,'utf8');
  if(text.includes('var REVISION = ')&&/export\s*\{[\s\S]*three_module_exports[\s\S]*\};/.test(text))found.push('src/chunks/'+name);
 }
 if(found.length!==1)throw Error('无法唯一定位当前构建Three命名空间，不猜测包路径');
 return found[0];
}
