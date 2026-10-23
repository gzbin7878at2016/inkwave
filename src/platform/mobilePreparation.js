// 手机开局覆盖层只展示真实准备进度；取消/重试由主控完成，界面不抢先恢复世界。
export function createMobilePreparationUI({ onCancel, onRetry } = {}) {
  const element = document.createElement('section');
  element.id = 'mobile-preparation'; element.hidden = true; element.tabIndex = -1;
  element.setAttribute('role', 'dialog'); element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-labelledby', 'mobile-preparation-title');
  element.setAttribute('aria-describedby', 'mobile-preparation-detail');
  const card = document.createElement('div'); card.className = 'mobile-preparation-card';
  const eyebrow = document.createElement('p'); eyebrow.className = 'mobile-preparation-eyebrow'; eyebrow.textContent = 'INKWAVE';
  const title = document.createElement('h2'); title.id = 'mobile-preparation-title';
  const row = document.createElement('div'); row.className = 'mobile-preparation-row';
  const label = document.createElement('p'); label.id = 'mobile-preparation-label'; label.setAttribute('role', 'status'); label.setAttribute('aria-live', 'polite');
  const percent = document.createElement('span'); percent.id = 'mobile-preparation-percent'; percent.setAttribute('aria-hidden', 'true');
  row.append(label, percent);
  const track = document.createElement('div'); track.id = 'mobile-preparation-progress';
  track.setAttribute('role', 'progressbar'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-labelledby', 'mobile-preparation-label');
  const fill = document.createElement('div'); fill.className = 'mobile-preparation-fill'; track.append(fill);
  const detail = document.createElement('p'); detail.id = 'mobile-preparation-detail';
  const actions = document.createElement('div'); actions.className = 'mobile-preparation-actions';
  const retry = document.createElement('button'); retry.type = 'button'; retry.id = 'mobile-preparation-retry'; retry.textContent = '重试'; retry.hidden = true;
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'mobile-preparation-cancel'; cancel.textContent = '取消并返回菜单';
  actions.append(retry, cancel); card.append(eyebrow, title, row, track, detail, actions); element.append(card); document.body.append(element);

  let progress = 0, displayed = 0, state = 'idle', generation = 0, disposed = false, retryAction = onRetry, previousFocus;
  const displayProgress = () => {
    // update永远不显示100%，只有主控确认首帧与全部准备完成后调用complete。
    const value = displayed = Math.max(displayed, state === 'complete' ? 100 : Math.min(99, Math.floor(progress * 100)));
    percent.textContent = `${value}%`; fill.style.width = `${value}%`;
    track.setAttribute('aria-valuenow', String(value)); track.setAttribute('aria-valuetext', `${value}% · ${label.textContent}`);
  };
  const fail = (message, { onRetry: action = onRetry } = {}) => {
    if (disposed || element.hidden) return;
    const entering = displayed === 100;
    state = 'failed'; generation++; retryAction = action;
    element.dataset.state = state; element.setAttribute('aria-busy', 'false');
    label.textContent = entering ? '进入未完成' : '准备未完成'; detail.textContent = String(message || '准备失败，请重试或返回菜单。').slice(0, 300);
    cancel.disabled = false; cancel.textContent = '返回菜单'; retry.disabled = false; retry.hidden = typeof retryAction !== 'function';
    displayProgress(); (retry.hidden ? cancel : retry).focus({ preventScroll: true });
  };
  const act = async kind => {
    if (disposed || element.hidden || state === 'cancelling' || state === 'retrying' || state === 'complete') return;
    const action = kind === 'retry' ? retryAction : onCancel;
    if (typeof action !== 'function') return;
    const ownGeneration = ++generation;
    state = kind === 'retry' ? 'retrying' : 'cancelling'; element.dataset.state = state;
    element.setAttribute('aria-busy', 'true'); cancel.disabled = true; retry.disabled = true;
    label.textContent = kind === 'retry' ? '正在重新准备…' : '正在返回菜单…';
    detail.textContent = '等待当前准备安全结束。'; displayProgress();
    try { await action(); }
    catch { if (!disposed && !element.hidden && generation === ownGeneration) fail('操作未完成，请重试或返回菜单。', { onRetry: retryAction }); }
    // 成功回调不自行隐藏；主控须在旧任务退出、菜单恢复后明确hide。
  };
  cancel.onclick = () => act('cancel'); retry.onclick = () => act('retry');
  const stopPointer = event => event.stopPropagation();
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'touchend', 'click']) element.addEventListener(type, stopPointer);
  const keys = event => {
    if (disposed || element.hidden) return;
    // 前后台恢复提示优先；保留上层按钮的原生激活，仍阻止键盘传入底层游戏。
    const interruption = document.getElementById('mobile-dialog');
    if (interruption && !interruption.hidden) {
      event.stopImmediatePropagation();
      if (event.key === 'Tab') {
        event.preventDefault();
        const buttons = [...interruption.querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
        if (buttons.length) {
          const index = buttons.indexOf(document.activeElement), step = event.shiftKey ? -1 : 1;
          buttons[(index + step + buttons.length) % buttons.length].focus({ preventScroll: true });
        }
      }
      return;
    }
    // 在window捕获阶段挡住游戏的键盘处理；Enter/Space保留按钮的原生激活行为。
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); void act('cancel'); }
    if (event.key === 'Tab') {
      event.preventDefault();
      const buttons = [retry, cancel].filter(button => !button.hidden && !button.disabled);
      if (!buttons.length) { element.focus({ preventScroll: true }); return; }
      const index = buttons.indexOf(document.activeElement), step = event.shiftKey ? -1 : 1;
      buttons[(index + step + buttons.length) % buttons.length].focus({ preventScroll: true });
    }
  };
  // keyup/mouseup只释放旧输入，允许传给Input，避免进入覆盖层前按住的键卡住。
  window.addEventListener('keydown', keys, true);
  const hide = () => {
    if (disposed) return;
    generation++; element.hidden = true; element.setAttribute('aria-busy', 'false'); state = 'idle';
    if (element.contains(document.activeElement) && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  return {
    element,
    show({ title: text = '准备对局' } = {}) {
      if (disposed) return;
      previousFocus = element.contains(document.activeElement) ? previousFocus : document.activeElement;
      generation++; progress = displayed = 0; state = 'loading'; retryAction = onRetry;
      title.textContent = String(text); label.textContent = '正在准备…'; detail.textContent = '准备完成后进入对局。';
      element.hidden = false; element.dataset.state = state; element.setAttribute('aria-busy', 'true');
      cancel.disabled = false; cancel.textContent = '取消并返回菜单'; retry.hidden = true; retry.disabled = false;
      displayProgress(); cancel.focus({ preventScroll: true });
    },
    update({ progress: value, label: text, detail: description } = {}) {
      if (disposed || element.hidden || state !== 'loading') return;
      if (typeof value === 'number' && Number.isFinite(value)) progress = Math.max(progress, Math.min(1, Math.max(0, value)));
      if (text != null && label.textContent !== String(text)) label.textContent = String(text);
      if (description != null && detail.textContent !== String(description)) detail.textContent = String(description);
      displayProgress();
    },
    complete() {
      if (disposed || element.hidden || state !== 'loading') return;
      state = 'complete'; element.dataset.state = state; element.setAttribute('aria-busy', 'false');
      progress = 1; label.textContent = '准备完成'; detail.textContent = '即将进入对局。'; cancel.disabled = true; retry.hidden = true; displayProgress();
    },
    fail, hide,
    dispose() {
      if (disposed) return;
      hide(); disposed = true; generation++; element.remove();
      window.removeEventListener('keydown', keys, true);
    },
  };
}
