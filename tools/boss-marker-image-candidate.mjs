// 可序列化到既有页面的调查候选：仅静态名牌武器SVG，不改变标签、文字、位置、动画或任何产品文件。
export async function createBossMarkerImages(root) {
  const entries = [], paint = ['color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'paint-order'];
  for (const svg of root.querySelectorAll('.iw-mk__w svg')) {
    const box = svg.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0) || svg.getAnimations({ subtree: true }).length) continue;
    const clone = svg.cloneNode(true), source = [svg, ...svg.querySelectorAll('*')], dest = [clone, ...clone.querySelectorAll('*')], style = getComputedStyle(svg);
    for (let i = 0; i < source.length; i++) { const computed = getComputedStyle(source[i]); for (const name of paint) dest[i].style.setProperty(name, computed.getPropertyValue(name)); }
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', style.width); clone.setAttribute('height', style.height); clone.style.filter = 'none';
    const img = new Image(); img.setAttribute('aria-hidden', 'true'); img.dataset.bossMarkerImage = 'probe';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    img.style.cssText = `width:100%;height:100%;display:${style.display};filter:${style.filter};vertical-align:${style.verticalAlign}`;
    await img.decode(); entries.push({ svg, img, host: svg.parentNode });
  }
  const setup = { icons: entries.length, svgDescendants: entries.reduce((n, r) => n + r.svg.querySelectorAll('*').length, 0) };
  return {
    setup,
    toggle(images) {
      for (const r of entries) {
        if (images && r.svg.parentNode === r.host) r.svg.replaceWith(r.img);
        if (!images && r.img.parentNode === r.host) r.img.replaceWith(r.svg);
      }
      return this.snapshot();
    },
    snapshot() { return { ...setup, imageNodes: entries.filter(r => r.img.isConnected).length, originalNodes: entries.filter(r => r.svg.isConnected).length, remaining: root.querySelectorAll('[data-boss-marker-image]').length }; },
  };
}
