// 手机HUD复用视口尺寸，避免DOM写入后反复读取innerWidth/innerHeight触发布局同步。
// 仅手机调用时注册监听；PC继续读取原生尺寸，不安装额外行为。
let viewport;
export function mobileViewport() {
  if (!viewport) {
    const refresh = () => { viewport = { width: innerWidth, height: innerHeight }; };
    refresh();
    addEventListener('resize', refresh);
    addEventListener('orientationchange', refresh);
  }
  return viewport;
}
