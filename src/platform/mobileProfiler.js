// 手机专用低频性能取样：只测JS墙钟耗时，不把WebGL提交时间冒充GPU时间。
// 每4帧记录CPU，每120帧记录一次真实绘制增量；固定环形缓冲避免逐帧日志和无限增长。
const STAGES = ['input', 'simulation', 'effects', 'environment', 'camera', 'paint', 'prepare', 'draw', 'ui'];
export class MobileProfiler {
  constructor(game) {
    this.game = game; this.frame = 0; this.count = 0; this.index = 0;
    this.values = new Float32Array(120 * 10); this.context = ''; this.topDraws = [];
    const r = game.R.renderer, original = r.renderBufferDirect, owner = this;
    r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      if (!owner.drawActive) return original.call(this, camera, scene, geometry, material, object, group);
      const beforeCalls = r.info.render.calls, beforeTriangles = r.info.render.triangles;
      const result = original.call(this, camera, scene, geometry, material, object, group);
      const calls = r.info.render.calls - beforeCalls, triangles = r.info.render.triangles - beforeTriangles;
      if (calls) {
        const name = (object?.name || object?.parent?.name || material?.name || `${object?.type || 'unnamed'}/g${geometry?.id}/m${material?.id}`).slice(0, 80);
        // 同名合并，防止大量临时粒子造成诊断数据膨胀。
        if (owner.draws.size < 200 || owner.draws.has(name)) {
          const row = owner.draws.get(name) || { name, calls: 0, triangles: 0 };
          row.calls += calls; row.triangles += triangles; owner.draws.set(name, row);
        }
      }
      return result;
    };
  }
  begin(time) {
    const g = this.game, key = `${g.worldKey}/${g.match?.state}/${g.match?.practice ? 'practice' : g.mode}/${!!g.match?.paused}`;
    if (key !== this.context) { this.context = key; this.count = this.index = 0; this.topDraws = []; this.topCalls = []; this.drawAt = null; this.drawContext = null; }
    this.active = (++this.frame % 4 === 0); this.drawActive = this.frame % 120 === 0;
    if (this.drawActive) this.draws = new Map();
    this.start = this.last = time; this.stage = 0;
  }
  mark() {
    if (!this.active) return;
    const now = performance.now();
    this.values[this.index * 10 + this.stage++] = now - this.last; this.last = now;
  }
  end() {
    this.mark();
    if (this.active) {
      this.values[this.index * 10 + 9] = this.last - this.start;
      this.index = (this.index + 1) % 120; this.count = Math.min(120, this.count + 1);
    }
    if (this.drawActive) {
      this.topDraws = [...this.draws.values()].sort((a, b) => b.triangles - a.triangles).slice(0, 20);
      this.topCalls = [...this.draws.values()].sort((a, b) => b.calls - a.calls).slice(0, 10);
      this.drawContext = this.context; this.drawAt = Date.now();
    }
    this.active = this.drawActive = false;
  }
  snapshot() {
    const cpu = {};
    for (let k = 0; k < 10; k++) {
      const sorted = Array.from({ length: this.count }, (_, i) => this.values[i * 10 + k]).sort((a,b) => a-b);
      cpu[STAGES[k] || 'total'] = { p50: sorted[Math.floor((sorted.length - 1) * 0.5)] || 0, p95: sorted[Math.floor((sorted.length - 1) * 0.95)] || 0 };
    }
    return { context: this.context, samples: this.count, cpu, topDraws: this.topDraws, topCalls: this.topCalls || [], drawAt: this.drawAt, drawContext: this.drawContext, note: 'CPU毫秒含JS提交；不含异步GPU完成及浏览器合成。绘制榜为最近每120帧抽样，同名合并，非逐帧平均。' };
  }
}
