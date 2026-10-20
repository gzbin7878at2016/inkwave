// 触屏事实采集：pointerId 在按下时分配职责，移动时不换区，不伪造键鼠事件。
const KEYS = { jump: 'Space', squid: 'ShiftLeft', sub: 'KeyE', special: 'KeyF', cheer: 'KeyC' };

export class TouchInput {
  constructor(input, onPause) {
    this.input = input;
    this.pointers = new Map();
    this.held = new Set(); this.pressed = new Set();
    this.move = { x: 0, y: 0 }; this.look = { x: 0, y: 0 };
    this.mapOpen = false; this.enabled = false;
    this.root = document.createElement('div');
    this.root.id = 'mobile-controls'; this.root.hidden = true;
    this.root.innerHTML = `<div class="mobile-look" data-touch="look"></div>
      <div class="mobile-stick" data-touch="move"><span></span><small>移动</small></div>
      <div class="mobile-actions">
        <button data-touch="special">大招</button><button data-touch="sub">副武器</button>
        <button data-touch="jump">跳跃</button><button data-touch="fire">开火</button>
        <button data-touch="squid">潜墨</button><button data-touch="cheer">欢呼</button>
      </div><div class="mobile-top"><button data-touch="map">地图</button><button data-touch="pause">暂停</button></div>
      <div class="mobile-jumps" hidden>${Array.from({ length: 10 }, (_, i) => `<button data-touch="Digit${(i + 1) % 10}">${i < 3 ? '队友' + (i + 1) : i === 3 ? '基地' : '信标' + (i - 3)}</button>`).join('')}</div>`;
    document.body.append(this.root);
    this.knob = this.root.querySelector('.mobile-stick span');
    this.jumpPanel = this.root.querySelector('.mobile-jumps');
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      const el = e.target.closest('[data-touch]');
      if (!el) return;
      const role = el.dataset.touch;
      // 同一区域只收一个手指；多个不同按钮可以同时按住。
      if ([...this.pointers.values()].some(p => p.role === role)) return;
      e.preventDefault(); e.stopPropagation();
      this.input.lastDevice = 'touch';
      el.setPointerCapture(e.pointerId);
      const p = { role, el, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY };
      this.pointers.set(e.pointerId, p);
      if (role === 'pause') { this.clear(); onPause(); return; }
      if (role === 'map') { this.mapOpen = !this.mapOpen; if (this.mapOpen) this.onCancel?.(); }
      else if (role !== 'look' && role !== 'move') { this.held.add(role); this.pressed.add(role); }
      el.classList.add('is-held');
    });
    this.root.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      if (p.role === 'move') {
        const dx = e.clientX - p.ox, dy = e.clientY - p.oy, m = Math.hypot(dx, dy);
        const radius = 48, dead = 7, k = Math.min(1, Math.max(0, (m - dead) / (radius - dead)));
        this.move.x = m ? dx / m * k : 0; this.move.y = m ? dy / m * k : 0;
        this.knob.style.transform = `translate(${this.move.x * 35}px,${this.move.y * 35}px)`;
      } else if (p.role === 'look' || p.role === 'fire') {
        // 两拇指也能边射边瞄：开火按钮按住后拖动同样转视；独立瞄准手指仍可并存。
        // CSS 像素与帧率、DPR 无关；异常跳点限幅，避免恢复触控时镜头瞬间翻转。
        this.look.x += Math.max(-80, Math.min(80, e.clientX - p.x));
        this.look.y += Math.max(-80, Math.min(80, e.clientY - p.y));
      }
      p.x = e.clientX; p.y = e.clientY;
    });
    const release = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId); this.held.delete(p.role); p.el.classList.remove('is-held');
      if (p.role === 'move') { this.move.x = this.move.y = 0; this.knob.style.transform = ''; }
      // cancel 必须连未消费的边沿一起撤销，不能在切后台后补发一次射击。
      if (e.type !== 'pointerup') { this.pressed.delete(p.role); this.onCancel?.(); }
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.addEventListener(type, release);
    window.addEventListener('blur', () => this.clear());
    window.addEventListener('resize', () => this.clear());
  }

  down(code) {
    if (!this.enabled) return false;
    if (code === 'Tab') return this.mapOpen;
    for (const [action, key] of Object.entries(KEYS)) if (code === key) return this.action(action);
    return this.pressed.has(code);
  }
  wasPressed(code) {
    if (!this.enabled) return false;
    return this.pressed.has(code) || Object.entries(KEYS).some(([action, key]) => key === code && this.pressed.has(action));
  }
  action(name) { return this.enabled && (this.held.has(name) || this.pressed.has(name)); }
  setEnabled(on) {
    if (on !== this.enabled) { this.clear(); this.enabled = on; this.root.hidden = !on; }
    this.jumpPanel.hidden = !this.mapOpen;
    this.root.classList.toggle('map-open', this.mapOpen);
  }
  // 菜单/失焦/后台的统一释放口；pointer capture 一并释放，避免后续 lost 回调污染新手势。
  clear() {
    const old = [...this.pointers.entries()]; this.pointers.clear();
    for (const [id, p] of old) {
      p.el.classList.remove('is-held');
      if (p.el.hasPointerCapture(id)) p.el.releasePointerCapture(id);
    }
    this.held.clear(); this.pressed.clear(); this.mapOpen = false;
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
    this.knob.style.transform = '';
    this.onCancel?.();
  }
  endFrame() { this.pressed.clear(); this.look.x = this.look.y = 0; }
}
