// ========================================================================================
// INKWAVE 渲染器模块 —— WebGL 渲染器 + HDR 后处理链的总装车间
//
// 【一句话架构】(首行英文注释即全部):
//   MSAA HDR 目标 → (可选)GTAO 环境光遮蔽 → Bloom 泛光 → Grade 调色 → Output 输出
//
// 【新手要建立的三个概念】
//   ① 前向渲染:three.js 默认管线,画每个物体时顺带算光照(所以全游戏只有一盏真灯——太阳)
//   ② HDR 半浮点:中间帧缓冲用 HalfFloatType,像素亮度可以超过 1.0,
//      泛光(bloom)才有"高亮溢出"可提取;最后 OutputPass 统一做色调映射 + sRGB
//   ③ 后处理链 = 一串"全屏滤镜",每个 pass 吃上一 pass 的图、吐出新图(EffectComposer 负责串联)
//
// 【著名的平台坑】Apple 芯片(M 系列)的 ANGLE/Metal 后端上,多重采样半浮点目标慢到
//   30ms/帧(1920×1200 M1 Pro)。因此苹果机上:samples=0(单采样)+ 用 SMAA 后处理抗锯齿
//   代替 MSAA + GTAO 半分辨率跑。运行时经 isAppleGPU() 检测分支。
// ========================================================================================
// Renderer + post stack (MSAA HDR target → optional GTAO → bloom → grade/vignette → output).
// Apple GPUs (ANGLE's Metal backend): multisampled half-float targets cost ~30 ms/frame at 1920×1200 on an M1 Pro,
// so there the HDR target is single-sampled and edges are smoothed by SMAA after output, and GTAO runs at half res.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { installMobileGpuSafety } from '../platform/mobileGpu.js';
import { QUALITY } from '../config.js';
import { G } from './ctx.js';

const BLOOM = [0.28, 0.45, 2.4];   // default bloom: strength, radius, HDR threshold

// 【自定义调色 shader】60 行 GLSL ≈ UE4 里 PostProcess Volume 一整个面板的手写等价物。
// 处理顺序(与代码对应):曝光 → 饱和度/vibrance(已饱和的队伍墨几乎不动,只提灰部)→
// 对数空间对比度(HDR 高光不失序)→ 冷阴影/暖高光分离色调 → 暗角 → 低血量去饱和+压边 → 闪白。
// 全程在线性 HDR 空间进行,色调映射在最后的 OutputPass 才发生。
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.08 },
    uVib: { value: 0.12 },                               // extra saturation for muted colours only (ink never clips)
    uContrast: { value: 1.07 },                          // log-space contrast around mid grey
    uShadowTint: { value: new THREE.Vector3(0.975, 0.99, 1.035) },
    uHighTint: { value: new THREE.Vector3(1.025, 1.0, 0.972) },
    uLift: { value: 0.0 },
    uExposure: { value: 1.0 },                           // per-theme exposure (the renderer's own exposure stays fixed: the lobby set shares it)
    uVignette: { value: 0.22 },
    uHurt: { value: 0 },
    uHurtColor: { value: new THREE.Color(1, 0.2, 0.3) },
    uFlash: { value: 0 },
    uAspect: { value: 1.7 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uSat; uniform float uVignette; uniform float uHurt; uniform vec3 uHurtColor; uniform float uFlash; uniform float uAspect;
    uniform float uVib; uniform float uContrast; uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform float uLift; uniform float uExposure;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb *= uExposure;
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      // vibrance: muted colours gain saturation, already-saturated ones (team ink) barely move
      float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
      float chroma = (mx - mn) / max(mx, 1e-4);
      c.rgb = max(mix(vec3(l), c.rgb, uSat + uVib * (1.0 - smoothstep(0.1, 0.7, chroma))), 0.0);
      // contrast in log space around mid grey (keeps HDR highlights ordered), then a cool-shadow / warm-light split tone
      c.rgb = 0.18 * pow(max(c.rgb, vec3(1e-6)) / 0.18, vec3(uContrast)) + uLift;
      // split tone is for the world's neutrals: strongly saturated colours (team ink) keep their exact hue
      float lt = smoothstep(0.015, 0.55, l);
      c.rgb *= mix(vec3(1.0), mix(uShadowTint, uHighTint, lt), 1.0 - 0.85 * smoothstep(0.35, 0.8, chroma));
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r = length(q);
      float v = smoothstep(0.55, 1.25, r);
      c.rgb *= 1.0 - uVignette * v;
      // low health: the HUD draws the coloured edge; here we only drain saturation + darken the rim slightly
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb, vec3(lum), uHurt * 0.45);
      c.rgb *= 1.0 - uHurt * 0.25 * smoothstep(0.4, 1.2, r);
      c.rgb += uFlash;
      gl_FragColor = c;
    }`,
};

// r186's PCF filter uses a 5-tap rotated Vogel disk with per-pixel noise, which reads as grainy stipple on every soft
// shadow edge. Swap it for a noise-free 3×3 grid of hardware-compared (bilinear) taps: smooth and temporally stable.
// 【阴影滤波补丁】three.js r186 的 PCF 软阴影用"旋转 Vogel 盘 5 采样 + 逐像素随机",
// 阴影边缘全是颗粒噪点;这里全局替换 ShaderChunk(模块加载时执行一次,改的是 three.js 的公共源码),
// 换成 3×3 硬件双线性比较——边缘平滑且时间上稳定(不闪)。
// ⚠️ 这是"改厂商变速箱"式操作:three.js 升级后正则失配会打印警告并保持原厂行为。
(function patchShadowFilter() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const re = /shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \) \* radius, shadowCoord\.z \) \)[\s\S]*?\) \* 0\.2;/;
  if (!re.test(chunk)) { console.warn('[inkwave] shadow chunk layout changed; keeping stock PCF'); return; }
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(re, `vec2 ts = texelSize * max( shadowRadius * 0.55, 0.6 );
				float s9 = 0.0;
				for ( int sx = -1; sx <= 1; sx ++ ) for ( int sy = -1; sy <= 1; sy ++ ) s9 += texture( shadowMap, vec3( shadowCoord.xy + vec2( float( sx ), float( sy ) ) * ts, shadowCoord.z ) );
				shadow = s9 * ( 1.0 / 9.0 );`);
})();

function isAppleGPU(gl) {
  // 【平台检测】读 WebGL 渲染器名字;含 "Apple" 且不含 Intel/AMD/NVIDIA 才认(排除"Apple Intel"这类双显卡机型)。
  // 结果决定本文件开头说的苹果专用路径:单采样 HDR 目标 + SMAA + 半分辨率 GTAO。
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /Apple/i.test(name) && !/Intel|AMD|Radeon|NVIDIA/i.test(name);
}

export class Renderer {
  // 【构造】创建 WebGL 上下文 + 基本配置;真正的后处理链在 setScene() 里才搭(_buildComposer)。
  // 三个关键开关:
  //   antialias: false —— 不依赖画布的默认 MSAA,抗锯齿由我们自己的 HDR 渲染目标接管(质量档可调)
  //   checkShaderErrors 默认关 —— 同步编译检查会让游戏中途首次编译时卡死一切;
  //     只有带 ?shadercheck 参数(冒烟测试/开发)才打开,让坏着色器响亮报错
  //   info.autoReset = false —— 渲染统计由 _frame() 每帧手动清零,方便统计单帧 DrawCall
  constructor(container, settings) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    // Shader status checks make every compile synchronous (the main thread waits on the GPU process for the link
    // result): a mid-game compile then stalls input, netcode and all. Players run without them; ?shadercheck (the
    // smoke test and dev tools) turns them back on so a broken shader still fails loudly.
    r.debug.checkShaderErrors = typeof location !== 'undefined' && new URLSearchParams(location.search).has('shadercheck');
    globalThis.inkwaveDiagnostics?.attachRenderer(r); // 诊断APK在首次编译时保存原始GLSL错误，桌面入口不启用。
    if (globalThis.inkwaveMobile) this.mobileSafety = r.mobileGpu = installMobileGpuSafety(r);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.info.autoReset = false;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x9fd8f0, 1);
    container.appendChild(r.domElement);
    this.appleGPU = isAppleGPU(r.getContext());
    r.domElement.id = 'game-canvas';
    this.container = container;
    this.scene = null; this.camera = null;
    this.settings = settings;
    this.q = QUALITY[settings.quality] || QUALITY.high;
    this._w = 0; this._h = 0;
  }

  setScene(scene, camera) {
    this.scene = scene; this.camera = camera;
    this._buildComposer();
  }

  // 【搭建后处理链】渲染目标与 pass 的顺序就是首行注释那张图,逐个说:
  //   HalfFloat 渲染目标 —— HDR 的画布;带 MSAA 采样数(苹果机上为 0)
  //   RenderPass        —— 真正画 3D 场景的那一 pass,之后全是全屏滤镜
  //   GTAOPass(可选)  —— 屏幕空间环境光遮蔽:从深度图推算缝隙/接触阴影
  //     · blendIntensity 0.8:最暗处也留 20% 光,隧道口不至于死黑
  //     · radius 1.1m = 接触尺度(米级),只让箱子/柱子"坐"在地面上,不给向阳墙抹黑晕
  //     · PD = 降噪 pass;苹果机上半分辨率跑(套了个 setSize 包装,输入尺寸砍半)
  //   UnrealBloomPass   —— 泛光:提取亮度超过阈值的像素,高斯扩散成辉光(日/黄昏参数由主题换装)
  //   GradeShader       —— 上面的自定义调色
  //   extraPass(可选)  —— 屏幕特效模块(fx/screenfx.js)注入位,跑在 HDR 线性空间
  //   OutputPass        —— 终点:色调映射(NeutralToneMapping)+ 转 sRGB
  //   SMAAPass(条件)  —— 只有"配置要 MSAA 但实际没开成"(=苹果机)才补这个后处理抗锯齿
  // 画质档/阴影开关变化时整个链由 applySettings() 重建。
  _buildComposer() {
    const r = this.renderer, q = this.q;
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.dynScale = this.dynScale || 1;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio) * this.dynScale;
    r.setPixelRatio(pr);
    const w = window.innerWidth, h = window.innerHeight;
    r.setSize(w, h);
    // effective MSAA sample count (also read by the showcase for its private target)
    this.samples = this.appleGPU ? 0 : q.msaa || 0;
    if (this.mobileSafety) this.samples = Math.min(this.samples, r.capabilities.maxSamples);
    const targetType = this.mobileSafety && !this.mobileSafety.state.caps.floatColor ? THREE.UnsignedByteType : THREE.HalfFloatType;
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: targetType, samples: this.samples });
    const comp = (this.composer = new EffectComposer(r, rt));
    comp.setPixelRatio(pr);
    comp.setSize(w, h);
    this.renderPass = new RenderPass(this.scene, this.camera);
    comp.addPass(this.renderPass);
    this.gtao = null;
    if (q.ao) {
      const ao = (this.gtao = new GTAOPass(this.scene, this.camera, w, h));
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.8;   // never crush to black: fully enclosed spots (tunnel mouths, under the overpass) keep 20 % of their light
      // contact AO: a metre-scale radius so crates, planters and pillar feet sit on the deck (it multiplies the lit
      // frame, so it stays short-range — no dirty halos on sunlit walls)
      ao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.6, thickness: 1.0, scale: 1.5, samples: 12, distanceFallOff: 1.0 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      if (this.appleGPU) { const set = ao.setSize.bind(ao); ao.setSize = (sw, sh) => set(Math.ceil(sw / 2), Math.ceil(sh / 2)); }
      comp.addPass(ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), ...BLOOM);
    this.bloom.enabled = !!(q.bloom && this.settings.bloom);
    comp.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this._gradeSrc = null;   // (re)apply the theme grade + bloom to the new passes
    comp.addPass(this.grade);
    // optional screen-FX pass (src/fx/screenfx.js) — runs in HDR linear space before tone mapping/output
    if (this.extraPass) comp.addPass(this.extraPass);
    comp.addPass(new OutputPass());
    // SMAA stands in for MSAA where MSAA was skipped; it runs on the tone-mapped sRGB image
    if (q.msaa && !this.samples) comp.addPass(new SMAAPass());
    r.shadowMap.enabled = this.settings.shadows !== false;
    this._w = w; this._h = h;
    this.grade.uniforms.uAspect.value = w / h;
  }

  // Install (or replace) the screen-FX post pass; kept across quality/setting rebuilds.
  setExtraPass(pass) {
    this.extraPass = pass;
    if (this.scene) this._buildComposer();
  }

  // 【画质档应用】质量档变了或阴影开关变了 → 重建整条后处理链,并给场景里每个材质打 needsUpdate
  // (逼 three.js 用新配置重编着色器——这正是 levelMaterial.js 里 customProgramCacheKey 要变的原因)。
  applySettings(settings) {
    const prevQ = this.q;
    this.settings = settings;
    this.q = QUALITY[settings.quality] || QUALITY.high;
    const shadowChanged = this.renderer.shadowMap.enabled !== (settings.shadows !== false);
    if (prevQ !== this.q || shadowChanged) {
      if (prevQ !== this.q) this.dynScale = 1;
      this._buildComposer();
      this.scene?.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((mm) => (mm.needsUpdate = true)); } });
    }
    if (this.bloom) this.bloom.enabled = !!(this.q.bloom && settings.bloom);
  }

  // Lowest dynamic scale: never below 0.75 of CSS-pixel density, so Retina screens (preset density > 1) can give more back.
  dynFloor() {
    const base = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    return Math.max(0.5, Math.min(0.75, 0.75 / base));
  }

  // Dynamic resolution (never on ultra): scale the render density between dynFloor() and 1 of the quality preset.
  // 【动态分辨率执行端】主循环 _dynRes() 决定"该降到几档",这里真正改 pixelRatio。
  // 改动极小(±0.125)且钳在 dynFloor 之上,Retina 屏的物理像素密度先折算再缩放。
  setDynamicScale(s) {
    s = Math.max(this.dynFloor(), Math.min(1, s));
    if (Math.abs(s - this.dynScale) < 0.01) return;
    this.dynScale = s;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio) * s;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this._w, this._h);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (w === this._w && h === this._h) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.gtao?.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / h;
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }

  render() {
    // 【每帧渲染入口】先补窗口尺寸变化;再检查环境主题(白天/黄昏)是否换了调色配方——
    // 换了就把 GradeShader 的饱和度/对比度/分离色调/曝光和 bloom 三参数整体换装,最后交给合成器出图。
    this.resize();
    // colour grade recommended by the environment theme (day / dusk)
    const gr = G.env && G.env.grade;
    if (gr && gr !== this._gradeSrc && this.grade) {
      this._gradeSrc = gr;
      const u = this.grade.uniforms;
      for (const k of ['uSat', 'uVib', 'uContrast', 'uLift', 'uVignette', 'uExposure']) u[k].value = gr[k] ?? GradeShader.uniforms[k].value;
      u.uShadowTint.value.set(...(gr.uShadowTint || [0.975, 0.99, 1.035]));
      u.uHighTint.value.set(...(gr.uHighTint || [1.025, 1.0, 0.972]));
      // bloom per theme: [strength, radius, threshold] — dusk lets lamps / lit windows bloom, daylight keeps it to the sun
      const bl = gr.bloom || BLOOM;
      this.bloom.strength = bl[0]; this.bloom.radius = bl[1]; this.bloom.threshold = bl[2];
    }
    this.composer.render();
  }
}
