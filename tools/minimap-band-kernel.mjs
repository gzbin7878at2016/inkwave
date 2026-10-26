// 独立实验核：逐式保留Minimap原始插值/浮雕/owner/闪光算法，不含DOM、Canvas、G或比赛规则。
export function computeMinimapInkBand(s,y0,y1,colors){
 const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
    const W = s.w, H = s.h, N = W * H;
    const grid = s.grid, cell = s.pixCell, fxA = s.pixFx, fyA = s.pixFy, sxA = s.pixSx, syA = s.pixSy;
    const d = s.ink, fd = s.flash, own = s.owner;
    const [A, Bc] = colors;
    const al = s._alpha || (s._alpha = new Float32Array(N));
    const tm = s._tm || (s._tm = new Uint8Array(N));
    const tt = s._tt || (s._tt = new Uint8Array(N));
    // 每段额外计算上下各一行，供墨迹边缘的明暗采样使用，减少分段接缝。
    const a0 = Math.max(0, y0 - 1) * W, a1 = Math.min(H, y1 + 1) * W;
    for (let i = a0; i < a1; i++) {
      const k = cell[i];
      if (k < 0) { al[i] = 0; continue; }
      const sx = sxA[i], sy = syA[i];
      const g00 = grid[k], g10 = grid[k + sx], g01 = grid[k + sy], g11 = grid[k + sx + sy];
      // 四个采样格归属相同时直接返回整块透明度，跳过边缘插值计算。
      if (g00 === g10 && g00 === g01 && g00 === g11) {           // uniform cell block: no edge here (fast path)
        al[i] = g00 ? 1 : 0; tm[i] = g00; tt[i] = g00 || 1;
        continue;
      }
      const tx = fxA[i] * (1 / 255), ty = fyA[i] * (1 / 255);
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      // 网格值 0 表示空白、1/2 表示两队；分别累加权重，选占优队伍并平滑透明度。
      const fa = (g00 === 1 ? w00 : 0) + (g10 === 1 ? w10 : 0) + (g01 === 1 ? w01 : 0) + (g11 === 1 ? w11 : 0);
      const fb = (g00 === 2 ? w00 : 0) + (g10 === 2 ? w10 : 0) + (g01 === 2 ? w01 : 0) + (g11 === 2 ? w11 : 0);
      const t = fa >= fb ? 1 : 2, f = t === 1 ? fa : fb;
      const a = smooth(0.34, 0.62, f);
      al[i] = a; tm[i] = a > 0.5 ? t : 0; tt[i] = t;
    }
    let flashes = 0;
    for (let py = y0; py < y1; py++) {
      for (let px = 0; px < W; px++) {
        const i = py * W + px, o = i * 4, a = al[i];
        if (a <= 0.003) { d[o + 3] = 0; fd[o + 3] = 0; own[i] = 0; continue; }
        const c = tt[i] === 2 ? Bc : A;
        // emboss: highlight on the lit (top-left) rim, soft shade on the far rim → reads as thick glossy ink
        const up = px > 0 && py > 0 ? al[i - W - 1] : a, dn = px < W - 1 && py < H - 1 ? al[i + W + 1] : a;
        const lit = a - up > 0 ? a - up : 0, dark = a - dn > 0 ? a - dn : 0;
        const k = 0.94 - dark * 0.32, add = lit * 150;
        d[o] = c[0] * k + add; d[o + 1] = c[1] * k + add; d[o + 2] = c[2] * k + add;   // Uint8Clamped clamps
        d[o + 3] = a * 255;
        // 仅在像素新归属某队时写入白色闪光；owner 保留上次归属用于下次比较。
        const now = tm[i];
        if (now && own[i] !== now) { fd[o] = 255; fd[o + 1] = 255; fd[o + 2] = 255; fd[o + 3] = 170; flashes++; }
        else fd[o + 3] = 0;
        own[i] = now;
      }
    }
 return flashes;
}
