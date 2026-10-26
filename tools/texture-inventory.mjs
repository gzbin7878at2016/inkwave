// 仅在测试采集时读取已有JS对象，不读回GPU像素、不修改资源或画质。
export function textureInventory() {
  const g = window.__inkwave, G = window.__G;
  if (!g || !G) throw Error('游戏尚未就绪');
  const entries = new Map(), targets = [], missing = [];
  const add = (texture, label) => {
    if (!texture?.isTexture) return;
    if (entries.has(texture.uuid)) {
      const item = entries.get(texture.uuid); item.referenceCount++;
      if (item.references.length < 16 && !item.references.includes(label)) item.references.push(label);
      return;
    }
    const image = texture.image, first = Array.isArray(image) ? image[0] : image;
    const width = first?.width ?? first?.image?.width ?? 0;
    const height = first?.height ?? first?.image?.height ?? 0;
    const layers = texture.isDataArrayTexture || texture.isData3DTexture ? (first?.depth || 1) : 1;
    const faces = texture.isCubeTexture ? 6 : 1;
    const channels = ({1022: 3, 1023: 4, 1028: 1, 1030: 2})[texture.format];
    const bytes = ({1009: 1, 1015: 4, 1016: 2})[texture.type];
    // 完整mip链按各级实际尺寸求和；未知/压缩格式不猜内存数字。
    let pixels = width * height;
    if (texture.generateMipmaps) {
      let w = width, h = height;
      while (w > 1 || h > 1) { w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2)); pixels += w * h; }
    }
    const estimatedColorBytes = channels && bytes && !texture.isCompressedTexture && width && height
      ? pixels * layers * faces * channels * bytes : null;
    entries.set(texture.uuid, {name: texture.name, references: [label], referenceCount: 1, width, height, layers, faces,
      type: texture.type, format: texture.format, mipmaps: texture.generateMipmaps,
      anisotropy: texture.anisotropy, estimatedColorBytes});
  };
  const target = (rt, label) => {
    if (!rt) { missing.push(label); return; }
    targets.push({label, width: rt.width, height: rt.height, depthBuffer: rt.depthBuffer, samples: rt.samples || 0});
    for (const [i, t] of (rt.textures || [rt.texture]).entries()) add(t, `${label}[${i}]`);
  };
  const env = G.env;
  for (const key of ['_cloudRT','_envRT','_farRT','_fieldRT','_reflRT']) target(env?.[key], `environment.${key}`);
  for (const key of ['uWaveTex','uFoamTex','uDeckField']) add(env?.U?.[key]?.value, `environment.${key}`);
  target(G.paint?.rt, 'paint');
  for (const key of ['albedo','normal','orm']) add(g.texlib?.[key], `texlib.${key}`);
  add(g.murals, 'murals');
  target(g.R?.composer?.readBuffer, 'composer.read');
  target(g.R?.composer?.writeBuffer, 'composer.write');
  const lobby = g.showcase?.lob?.set;
  target(lobby?._envRT, 'lobby.environment'); target(lobby?._rRT, 'lobby.reflection');
  // 遍历场景材质，UUID去重；引用存在不表示已经驻留GPU或本帧可见。
  const scan = (root, label) => root?.traverse(o => {
    for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!mat) continue;
      for (const [k, v] of Object.entries(mat)) if (v?.isTexture) add(v, `${label}.${mat.name || mat.type}.${k}`);
      for (const [k, u] of Object.entries(mat.uniforms || {})) if (u?.value?.isTexture) add(u.value, `${label}.uniform.${k}`);
    }
  });
  scan(G.scene, 'scene'); scan(lobby?.root, 'lobby');
  const textures = [...entries.values()].sort((a,b) => (b.estimatedColorBytes || 0) - (a.estimatedColorBytes || 0));
  return {at: Date.now(), mode: G.mode, map: g.mapDef?.id, layout: G.level?.layout?.id,
    settings: {...g.settings}, pixelRatio: G.renderer.getPixelRatio(), dynamicScale: g.R?.dynScale,
    environmentProfile: env?.textureProfile || null,
    marina: !!env?._marina, deckFieldEnabled: !!env?.seaMat?.defines && 'DECK_FIELD' in env.seaMat.defines,
    planarReflectionEnabled: !!env?.U?.uReflOn?.value, farReflectionEnabled: !!env?.U?.uFarOn?.value,
    targets, missing, textures, estimatedReferencedColorBytes: textures.reduce((n,t) => n+(t.estimatedColorBytes || 0),0),
    rendererMemory: {...G.renderer.info.memory},
    limitation: '已有JS引用的颜色存储估算；不代表GPU驻留/总显存，排除深度、驱动、临时资源；未测GPU耗时和更新频率'};
}
