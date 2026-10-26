// 手机帧率限速沿固定排期推进；短暂晚到后恢复原相位，不把每次晚到累积到下一帧。
// 这里只决定是否绘制，实际Timer/dt与帧耗记录仍使用原始rAF时间，不伪造帧或修改模拟时钟。
export function mobileFrameDue(state, ts, cap) {
  if (!Number.isFinite(ts) || !Number.isFinite(cap) || cap <= 0) {
    state.next = undefined; state.cap = cap; return true;
  }
  const interval = 1000 / cap;
  if (state.cap !== cap || state.next === undefined || ts < state.last) {
    state.cap = cap; state.last = ts; state.next = ts + interval; return true;
  }
  state.last = ts;
  // 沿用原2ms时间戳容差；错过整帧以上时重置，不追赶完整历史欠帧。
  if (ts + 2 < state.next) return false;
  state.next = ts - state.next >= interval ? ts + interval : state.next + interval;
  return true;
}
