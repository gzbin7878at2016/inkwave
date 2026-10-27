// 有界小地图Worker传输层：不导入游戏；计算核显式传入，真实地图buffer不会被转移。
export function createMinimapBandWorker(initial, kernel, { timeoutMs = 2000, maxBytes = 12 * 1024 * 1024, maxPending = 1 } = {}) {
  const n = initial.w * initial.h;
  if (!Number.isSafeInteger(n) || n <= 0 || n > 500000 || typeof kernel !== 'function') throw Error('实验参数无效');
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 3) throw Error('在途上限须为1～3');
  const names = ['grid', 'pixCell', 'pixFx', 'pixFy', 'pixSx', 'pixSy', 'ink', 'flash', 'owner', '_alpha', '_tm', '_tt'];
  const state = { w: initial.w, h: initial.h };
  const height = initial.h, gridLength = initial.grid.length, gridPool = [];
  let gridAllocations = 0, rowAllocations = 0, recycled = 0;
  let bytes = 0;
  for (const name of names) {
    const value = initial[name];
    if (!ArrayBuffer.isView(value)) throw Error('缺少像素状态：' + name);
    bytes += value.byteLength;
  }
  // 一份Worker状态，另留一整幅返回行的最坏缓冲余量；初始化副本在postMessage后释放。
  if (bytes + n * 9 > maxBytes) throw Error('实验内存预算超限');
  for (const name of names) state[name] = initial[name].slice(); // 预算检查后复制，不转移真实地图buffer。
  const source = `const compute=${kernel.toString()};let state=null,allocations=0;const pool=[];onmessage=e=>{const m=e.data;try{
    if(m.kind==='init'){state=m.state;postMessage({id:m.id,ready:true});return;}
    if(m.kind==='recycle'){if(pool.length<3)pool.push(m.rows);return;}
    if(m.resetOwner)state.owner.fill(0);
    if(m.sync){state.owner.set(m.sync.owner);state.ink.set(m.sync.ink);state.flash.set(m.sync.flash);}
    state.grid=m.grid;const start=performance.now();
    const flashes=compute(state,m.y0,m.y1,m.colors),workerMs=performance.now()-start;
    const a=m.y0*state.w,b=m.y1*state.w;
    const count=b-a,slot=pool.findIndex(row=>row.owner.length===count);
    let rows=slot<0?null:pool.splice(slot,1)[0];
    while(pool.length&&pool.reduce((n,row)=>n+row.owner.length*9,0)+count*9>m.rowBudget)pool.pop();
    if(!rows){rows={ink:new Uint8ClampedArray(count*4),flash:new Uint8ClampedArray(count*4),owner:new Uint8Array(count)};allocations++;}
    rows.ink.set(state.ink.subarray(a*4,b*4));rows.flash.set(state.flash.subarray(a*4,b*4));rows.owner.set(state.owner.subarray(a,b));
    const result={id:m.id,y0:m.y0,y1:m.y1,flashes,workerMs,...rows,rowAllocations:allocations,grid:m.grid};
    if(m.inspect){result.alpha=state._alpha.slice();result.tm=state._tm.slice();result.tt=state._tt.slice();}
    const transfer=[result.ink.buffer,result.flash.buffer,result.owner.buffer,result.grid.buffer];
    if(m.inspect)transfer.push(result.alpha.buffer,result.tm.buffer,result.tt.buffer);
    postMessage(result,transfer);
  }catch(error){postMessage({id:m.id,error:String(error.stack||error)});}};`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let worker;
  try { worker = new Worker(url); } catch (error) { URL.revokeObjectURL(url); throw error; }
  const pending = new Map(); let serial = 0, disposed = false;
  const dispose = (reason = '实验已取消') => {
    if (disposed) return;
    disposed = true; worker.terminate(); URL.revokeObjectURL(url);
    gridPool.length = 0;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(reason)); } pending.clear();
  };
  worker.onerror = event => { event.preventDefault(); dispose('Worker异常：' + event.message); };
  worker.onmessage = event => {
    const callbackStart = performance.now();
    const result = event.data;
    if (!pending.has(result.id) || disposed) return;
    const p = pending.get(result.id); pending.delete(result.id); clearTimeout(p.timer);
    if (result.error) { p.reject(Error(result.error)); dispose('内核异常'); }
    else {
      if (result.grid?.length === gridLength && gridPool.length < 3) gridPool.push(result.grid);
      delete result.grid; rowAllocations = Math.max(rowAllocations, result.rowAllocations || 0);
      const resolved = { ...result, enqueueMs: p.enqueueMs, roundtripMs: performance.now() - p.start, callbackMs: 0 };
      resolved.callbackMs = performance.now() - callbackStart; p.resolve(resolved);
    }
  };
  const request = (message, transfer = [], retainedBytes = 0) => {
    if (disposed) return Promise.reject(Error('实验已关闭'));
    if (pending.size >= maxPending) return Promise.reject(Error('在途请求达到上限'));
    const liveBytes = [...pending.values()].reduce((sum, p) => sum + p.retainedBytes, retainedBytes);
    if (bytes + liveBytes > maxBytes) return Promise.reject(Error('在途缓冲预算超限'));
    return new Promise((resolve, reject) => {
      const start = performance.now(), id = ++serial;
      const p = { id, start, resolve, reject, retainedBytes, timer: setTimeout(() => dispose('Worker实验超时'), timeoutMs), enqueueMs: 0 };
      pending.set(id, p);
      const rowBudget = maxBytes - bytes - (liveBytes - retainedBytes) - (message.grid?.byteLength || 0) - (message.inspect ? n * 6 : 0);
      try { worker.postMessage({ ...message, id, rowBudget }, transfer); p.enqueueMs = performance.now() - start; }
      catch (error) { dispose(String(error)); }
    });
  };
  const ready = request({ kind: 'init', state }, names.map(name => state[name].buffer));
  return {
    ready, bytes, dispose, poolInfo: () => ({ gridAllocations, rowAllocations, recycled }),
    // 主循环复制并上传完成后归还行缓冲；后台Worker收到回收消息，不产生新的Canvas操作。
    recycle(result) {
      if (disposed || result.recycled) return;
      result.recycled = true;
      const rows = { ink: result.ink, flash: result.flash, owner: result.owner };
      try { worker.postMessage({ kind: 'recycle', rows }, [rows.ink.buffer, rows.flash.buffer, rows.owner.buffer]); recycled++; }
      catch (error) { dispose(String(error)); throw error; }
    },
    // sync为主线程owner/墨迹/闪光的同步副本（结构化克隆，不转移真实地图buffer），停用恢复时使用。
    draw(grid, y0, y1, colors, { inspect = false, resetOwner = false, sync = null } = {}) {
      if (!Number.isInteger(y0) || !Number.isInteger(y1) || y0 < 0 || y1 > height || y0 >= y1) return Promise.reject(Error('行范围无效'));
      if (grid.length !== gridLength) return Promise.reject(Error('网格尺寸变更'));
      if (sync && (sync.owner.length !== n || sync.ink.length !== n * 4 || sync.flash.length !== n * 4)) return Promise.reject(Error('同步尺寸变更'));
      const start = performance.now(); let copy = gridPool.pop();
      if (!copy) { copy = new grid.constructor(grid.length); gridAllocations++; }
      copy.set(grid); const copyMs = performance.now() - start;
      const retained = (y1 - y0) * initial.w * 9 + copy.byteLength + (inspect ? n * 6 : 0) + (sync ? n * 9 : 0);
      return request({ kind: 'draw', grid: copy, y0, y1, colors, inspect, resetOwner, sync }, [copy.buffer], retained)
        .then(result => { result.enqueueMs += copyMs; return result; });
    },
  };
}

// 仅由主循环消费；消息回调不能直接修改Canvas，以免触发额外绘制。
export function applyMinimapBand(map, result, quiet = false) {
  const { y0, y1 } = result, start = y0 * map.w;
  map.inkImg.data.set(result.ink, start * 4);
  map.flashImg.data.set(result.flash, start * 4);
  map.owner.set(result.owner, start);
  map.ictx.putImageData(map.inkImg, 0, 0, 0, y0, map.w, y1 - y0);
  map.fctx.putImageData(map.flashImg, 0, 0, 0, y0, map.w, y1 - y0);
  if (result.flashes && !quiet) map.flashT = 0;
}
