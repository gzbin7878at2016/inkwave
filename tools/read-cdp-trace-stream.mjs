// ReportEvents一次性导出会给设备/调试通道造成尖峰；逐块读ReturnAsStream，保留字节与关闭状态。
export async function readCdpTraceStream(call,handle,limit=256*1024*1024){
 const chunks=[];let bytes=0;
 try{
  for(;;){const r=await call('IO.read',{handle,size:1024*1024}),b=Buffer.from(r.data||'',r.base64Encoded?'base64':'utf8');bytes+=b.length;
   if(bytes>limit)throw Error('Trace流超过容量上限');chunks.push(b);if(r.eof)break;}
  return {bytes,data:Buffer.concat(chunks)};
 }finally{await call('IO.close',{handle});}
}
