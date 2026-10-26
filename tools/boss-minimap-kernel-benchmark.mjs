// 仅调查轮在采样结束后调用：复制当前地图和网格，不改真实比赛状态或缓存归属。
// 函数须可通过toString交给手机执行，因此不引用模块外变量。
export function benchmarkBossMinimapKernel(map) {
  const c = map._bossInkCache;
  if (!c || !map.bossInkInfo()?.active || map.paint.grid.some(value=>value>2)) throw Error('需要实际启用且网格合法的Boss缓存');
  const draw = Object.getPrototypeOf(map)._drawInk, W = map.w, H = map.h;
  const clone = cached => {
    const m = Object.assign(Object.create(Object.getPrototypeOf(map)), map);
    m.paint = { ...map.paint, grid: map.paint.grid.slice() };
    for (const name of ['owner', '_alpha', '_tm', '_tt']) m[name] = map[name].slice();
    for (const [image, context] of [['inkImg', 'ictx'], ['flashImg', 'fctx']]) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      m[context] = canvas.getContext('2d'); m[image] = m[context].createImageData(W, H);
      m[image].data.set(map[image].data); m[context].putImageData(m[image], 0, 0);
    }
    m._bossInkCache = null;
    if (cached) {
      const cache = m._bossInkCache = { ...c, stats: { ...c.stats }, palette: c.palette.slice() };
      for (const name of ['patterns', 'signatures', 'initialRows', 'samples']) cache[name] = c[name].slice();
      cache.refs = [m.pixCell,m.pixFx,m.pixFy,m.pixSx,m.pixSy,m.inkImg,m.flashImg,m.owner,m._alpha,m._tm,m._tt,m.paint.grid];
    }
    return m;
  };
  const results = [];
  for (const scenario of ['empty', 'snapshot', 'sparse', 'dense']) {
    const times = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const maps = [clone(false), clone(true)], elapsed = [0, 0];
      if (scenario === 'empty') for (const m of maps) m.paint.grid.fill(0);
      let seed = 719;
      const random = () => { seed = (Math.imul(seed,1664525)+1013904223)|0; return (seed>>>0)/4294967296; };
      for (let step = 0; step < 36; step++) {
        if (scenario === 'sparse') for (let k=0;k<4;k++) {
          const i=Math.floor(random()*maps[0].paint.grid.length),v=Math.floor(random()*3);
          maps[0].paint.grid[i]=maps[1].paint.grid[i]=v;
        }
        if (scenario === 'dense') for (let k=0;k<maps[0].paint.grid.length;k++) maps[0].paint.grid[k]=maps[1].paint.grid[k]=Math.floor(random()*3);
        const y0=Math.floor(H*(step%3)/3),y1=Math.floor(H*(step%3+1)/3);
        for (const index of repeat%2 ? [1,0] : [0,1]) {
          const start=performance.now(); draw.call(maps[index],y0,y1); if(step>=6)elapsed[index]+=performance.now()-start;
        }
      }
      for (const name of ['owner','_alpha','_tm','_tt']) if(!maps[0][name].every((v,i)=>v===maps[1][name][i]))throw Error(`${scenario}:${name}不一致`);
      for (const name of ['inkImg','flashImg']) if(!maps[0][name].data.every((v,i)=>v===maps[1][name].data[i]))throw Error(`${scenario}:${name}不一致`);
      times.push({ originalMs: elapsed[0], cachedMs: elapsed[1] });
    }
    const median = values => values.sort((a,b)=>a-b)[1];
    const originalMs=median(times.map(t=>t.originalMs)),cachedMs=median(times.map(t=>t.cachedMs));
    results.push({scenario,originalMs,cachedMs,ratio:cachedMs/originalMs,times});
  }
  if(map._bossInkCache!==c)throw Error('真实地图缓存身份发生变化');
  return { performanceTest:false,width:W,height:H,gridCells:map.paint.grid.length,results };
}
