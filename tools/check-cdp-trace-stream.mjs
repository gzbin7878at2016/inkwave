import assert from 'node:assert/strict';
import {readCdpTraceStream as read} from './read-cdp-trace-stream.mjs';
// 文本/base64混合分块、UTF8、空EOF及容量失败都必须关闭句柄。
let closed=0;const chunks=[{data:'{"traceEvents":['},{data:Buffer.from('{"name":"中文","ph":"X"}').toString('base64'),base64Encoded:true},{data:']}'},{data:'',eof:true}];
const r=await read(async(m,p)=>{assert.equal(p.handle,'owned');if(m==='IO.close'){closed++;return{};}return chunks.shift();},'owned');
assert.equal(JSON.parse(r.data.toString('utf8')).traceEvents[0].name,'中文');assert.equal(closed,1);
await assert.rejects(read(async m=>{if(m==='IO.close'){closed++;return{};}return {data:'too big',eof:true};},'owned',2),/容量/);assert.equal(closed,2);
console.log('通过：Trace混合分块/UTF8/EOF/限额失败关闭');
