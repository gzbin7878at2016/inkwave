import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputShader } from 'three/addons/shaders/OutputShader.js';

const toneDefines = new Map([
  [THREE.LinearToneMapping, 'LINEAR_TONE_MAPPING'], [THREE.ReinhardToneMapping, 'REINHARD_TONE_MAPPING'],
  [THREE.CineonToneMapping, 'CINEON_TONE_MAPPING'], [THREE.ACESFilmicToneMapping, 'ACES_FILMIC_TONE_MAPPING'],
  [THREE.AgXToneMapping, 'AGX_TONE_MAPPING'], [THREE.NeutralToneMapping, 'NEUTRAL_TONE_MAPPING'],
  [THREE.CustomToneMapping, 'CUSTOM_TONE_MAPPING'],
]);

// 原SMAA三阶段与尺寸处理不变；只有已预备的手机Boss可把Output变换接在最后一次混合后。
export class MobileSMAAPass extends SMAAPass {
  constructor() {
    super();
    for (const stage of ['Edges', 'Weights', 'Blend']) this[`_material${stage}`].name = `SMAA${stage}Shader`;
    this._originalBlend = this._materialBlend;
    this.bossOutput = { ready: false, enabled: false };
    this.bossSmaaClear = { active: false };
    this.bossEdges = { ready: false, active: false, frames: 0 };
    this._bossClearColor = new THREE.Color();
  }
  setSize(width, height) { super.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height))); }

  // 只压缩手机Boss边缘缓冲的通道数；保留HalfFloat采样精度、权重/HDR与完整三阶段SMAA。
  async prepareBossEdges(renderer, match, { isCurrent = () => true, yieldTurn = async () => {} } = {}) {
    if (!globalThis.inkwaveMobile || !match?.boss || match.attract || !isCurrent()) return { skipped: true };
    this.clearBossEdges();
    const token = {}; this._edgeToken = token; this._edgeMatch = match;
    const current = () => this._edgeToken === token && isCurrent();
    try { await yieldTurn(); } catch (error) { if (this._edgeToken === token) this.clearBossEdges(match); throw error; }
    if (!current()) { if (this._edgeToken === token) this.clearBossEdges(match); return { cancelled: true }; }
    const rt = this._edgesRT, texture = rt.texture, gl = renderer.getContext();
    if (gl.RG16F === undefined || texture.format !== THREE.RGBAFormat || texture.type !== THREE.HalfFloatType) {
      this.clearBossEdges(match); return { skipped: true, reason: 'original-format-or-webgl2-unavailable' };
    }
    const saved = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), test: renderer.getScissorTest() };
    let prepared = false;
    try {
      this._edgeFormatOriginal = { format: texture.format, type: texture.type, internalFormat: texture.internalFormat };
      // 保留RenderTarget/Texture及uniform身份，在加载遮罩内重新分配并验证真实附件。
      rt.dispose(); texture.format = THREE.RGFormat; texture.internalFormat = 'RG16F';
      renderer.setRenderTarget(rt);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw Error(`Boss SMAA RG16F framebuffer incomplete: ${status}`);
      const bits = ['RED', 'GREEN', 'BLUE', 'ALPHA'].map(channel => gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl[`FRAMEBUFFER_ATTACHMENT_${channel}_SIZE`]));
      if (bits.join(',') !== '16,16,0,0') throw Error(`Boss SMAA RG16F attachment mismatch: ${bits}`);
      if (!current()) return { cancelled: true };
      this.bossEdges = { ready: true, active: true, frames: 0, format: 'RG16F', componentBits: bits, framebufferComplete: true };
      prepared = true; return { prepared: true, ...this.bossEdgesInfo() };
    } finally {
      if (!prepared && this._edgeToken === token) this.clearBossEdges(match);
      renderer.setRenderTarget(saved.target, saved.face, saved.mip); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor); renderer.setScissorTest(saved.test);
    }
  }
  syncBossEdges(match, mode) {
    // 加载预检可能在menu/init；普通菜单、演示、旧局与PC立即恢复原格式。
    if (this.bossEdges.ready && globalThis.inkwaveMobile && match === this._edgeMatch && match?.boss && !match.attract && (mode === 'match' || match.state === 'init')) return true;
    this.clearBossEdges(); return false;
  }
  clearBossEdges(match) {
    if (match && match !== this._edgeMatch) return;
    this._edgeToken = null; this._edgeMatch = null;
    if (this._edgeFormatOriginal) { this._edgesRT.dispose(); Object.assign(this._edgesRT.texture, this._edgeFormatOriginal); this._edgeFormatOriginal = null; }
    this.bossEdges = { ready: false, active: false, frames: 0 };
  }
  bossEdgesInfo() {
    const { width, height } = this._edgesRT;
    return { ...this.bossEdges, width, height, formatCode: this._edgesRT.texture.format, typeCode: this._edgesRT.texture.type,
      logicalColorBytes: width * height * (this.bossEdges.active ? 4 : 8), logicalSavedBytes: this.bossEdges.active ? width * height * 4 : 0,
      weightsType: this._weightsRT.texture.type, weightsFormat: this._weightsRT.texture.format };
  }

  _makeOutputMaterial() {
    const assignment = 'gl_FragColor = texture2D( tDiffuse, vUv );';
    const body = OutputShader.fragmentShader.split(assignment);
    const last = this._originalBlend.fragmentShader.lastIndexOf('}');
    if (body.length !== 2 || last < 0) throw Error('内置Output/SMAA结构变化，保留原输出路径');
    // RawShaderMaterial避免ShaderMaterial自动再注入颜色/色调函数；复用原库输出语句，不改调色顺序。
    const output = body[1].slice(0, body[1].lastIndexOf('}'));
    const includes = OutputShader.fragmentShader.match(/#include <[^>]+>/g).join('\n');
    this._fused = new THREE.RawShaderMaterial({
      name: 'SMAABossOutputShader', toneMapped: false,
      uniforms: { ...this._uniformsBlend, toneMappingExposure: { value: 1 } },
      vertexShader: 'precision highp float; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; attribute vec2 uv;\n' + this._originalBlend.vertexShader,
      fragmentShader: 'precision highp float;\n' + includes + '\n' + this._originalBlend.fragmentShader.slice(0, last) + output + '\n}',
    });
  }
  _syncOutput(renderer) {
    this._fused.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    if (this._colorSpace === renderer.outputColorSpace && this._toneMapping === renderer.toneMapping) return;
    this._colorSpace = renderer.outputColorSpace; this._toneMapping = renderer.toneMapping;
    const defines = {}, tone = toneDefines.get(renderer.toneMapping);
    if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
    if (tone) defines[tone] = '';
    this._fused.defines = defines; this._fused.needsUpdate = true;
  }

  async prepareBossOutput(renderer, match, outputPass, { isCurrent = () => true, yieldTurn = async () => {} } = {}) {
    if (!globalThis.inkwaveMobile || !match?.boss || match.attract || !outputPass || !isCurrent()) return { skipped: true };
    this.disableBossOutput(); this._bossMatch = null; this.bossOutput = { ready: false, enabled: false };
    if (!this._fused) this._makeOutputMaterial();
    await yieldTurn(); if (!isCurrent()) return { cancelled: true };
    this._syncOutput(renderer);
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
    target.texture.colorSpace = renderer.outputColorSpace;
    const saved = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(new THREE.Vector4()), scissor: renderer.getScissor(new THREE.Vector4()), test: renderer.getScissorTest(),
      auto: renderer.autoClear, material: this._fsQuad.material, color: this._uniformsBlend.tColor.value, weights: this._uniformsBlend.tDiffuse.value };
    try {
      this._fused.uniforms.tColor.value = black; this._fused.uniforms.tDiffuse.value = black;
      renderer.setRenderTarget(target); renderer.setViewport(0, 0, 4, 4); renderer.setScissorTest(false); renderer.autoClear = true;
      this._fsQuad.material = this._fused; this._fsQuad.render(renderer);
      const program = renderer.properties.get(this._fused).currentProgram;
      program.getUniforms(); program.getAttributes();
      if (program.diagnostics?.runnable === false) throw Error('Boss合并输出程序未通过链接');
      if (!isCurrent()) return { cancelled: true };
      this._bossMatch = match; this._outputPass = outputPass;
      this.bossOutput = { ready: true, enabled: false, programId: program.id };
      return { prepared: true, programId: program.id };
    } finally {
      this._fsQuad.material = saved.material; this._uniformsBlend.tColor.value = saved.color; this._uniformsBlend.tDiffuse.value = saved.weights;
      renderer.setRenderTarget(saved.target, saved.face, saved.mip); renderer.setViewport(saved.viewport); renderer.setScissor(saved.scissor);
      renderer.setScissorTest(saved.test); renderer.autoClear = saved.auto; target.dispose(); black.dispose();
    }
  }
  syncBossOutput(match, mode) {
    const valid = !!globalThis.inkwaveMobile && this.bossOutput.ready && match === this._bossMatch && !!match?.boss && !match.attract && mode === 'match';
    if (!valid) { this.disableBossOutput(); if (match !== this._bossMatch || !match?.boss) this._bossMatch = null; return false; }
    if (!this.bossOutput.enabled && this._outputPass.enabled) {
      this._outputPass.enabled = false; this._materialBlend = this._fused; this.bossOutput.enabled = true;
    }
    return this.bossOutput.enabled;
  }
  disableBossOutput() {
    if (this.bossOutput.enabled) { this._outputPass.enabled = true; this._materialBlend = this._originalBlend; }
    this.bossOutput.enabled = false;
  }
  clearBossOutput(match) {
    if (match && match !== this._bossMatch) return;
    this.disableBossOutput(); this._bossMatch = null; this.bossOutput.ready = false;
  }
  render(renderer, ...args) {
    if (this.bossEdges.active) this.bossEdges.frames++;
    if (this.bossOutput.enabled) this._syncOutput(renderer);
    if (!this.bossSmaaClear.active) { super.render(renderer, ...args); return; }
    // 边缘shader会discard无边缘像素，必须清零；天空色不能留在边缘纹理中冒充边缘。
    // 仅包住手机Boss的SMAA三阶段，主场景天空色及其他Pass状态在finally恢复。
    renderer.getClearColor(this._bossClearColor);
    const alpha = renderer.getClearAlpha(), auto = renderer.autoClear, color = renderer.autoClearColor, clear = this.clear;
    try {
      renderer.setClearColor(0x000000, 0); renderer.autoClear = true; renderer.autoClearColor = true; this.clear = false;
      super.render(renderer, ...args);
    } finally {
      renderer.setClearColor(this._bossClearColor, alpha); renderer.autoClear = auto; renderer.autoClearColor = color; this.clear = clear;
    }
  }
  syncBossSmaaClear(match, mode) {
    // 手机加载预检仍可能是menu/init；退出、普通局、演示和PC保留原路径。
    this.bossSmaaClear.active = !!globalThis.inkwaveMobile && !!match?.boss && !match.attract && (mode === 'match' || match.state === 'init');
    return this.bossSmaaClear.active;
  }
  dispose() {
    this.clearBossEdges();
    this.bossSmaaClear.active = false;
    this.disableBossOutput(); this._bossMatch = null;
    this._fused?.dispose(); this._fused = null; super.dispose();
  }
}
