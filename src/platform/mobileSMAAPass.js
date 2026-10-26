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
  }
  setSize(width, height) { super.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height))); }

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
    if (this.bossOutput.enabled) this._syncOutput(renderer);
    super.render(renderer, ...args);
  }
  dispose() {
    this.disableBossOutput(); this._bossMatch = null;
    this._fused?.dispose(); this._fused = null; super.dispose();
  }
}
