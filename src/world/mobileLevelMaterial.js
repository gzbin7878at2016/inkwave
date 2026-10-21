import * as THREE from 'three';
import { G } from '../core/ctx.js';
import { createLevelMaterial } from './levelMaterial.js';
import { chooseMobileSurfaceTier } from '../platform/mobileGpu.js';

// 手机独立材质：复用PC槽位数据定义，绝不修改PC的GLSL、纹理或全局ShaderChunk。
// 大参数表装入最近邻RGBA32F数据纹理，片元uniform不再随50个材质槽位增长。
function tableTexture(rows) {
  const width = rows[0].length;
  const data = new Float32Array(width * rows.length * 4);
  rows.forEach((row, y) => row.forEach((value, x) => value.toArray(data, (y * width + x) * 4)));
  const texture = new THREE.DataTexture(data, width, rows.length, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

export function createMobileLevelMaterial(paintTexture, atlasSize, muralTexture = null, opts = {}) {
  const tier = chooseMobileSurfaceTier(G.renderer, opts.texlib, opts.mobileTier);
  // 原工厂这里只生成CPU映射/默认uniform；不编译其桌面shader、不分配桌面GPU程序。
  const template = createLevelMaterial(paintTexture, atlasSize, muralTexture, opts);
  const all = template.userData.uniforms;
  const names = ['uPaint', 'uTeamA', 'uTeamB', 'uTime', 'uInkGlow', 'uAO', 'uLight', 'uMural', 'uSeeA', 'uSeeB', 'uSeeOn', 'uSeeFeet', 'uSeeA2C', 'uAtlasSize'];
  const uniforms = Object.fromEntries(names.map(name => [name, all[name]]));
  const owned = [];
  const mat = tier === 'textured'
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.5 })
    : new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  if (tier === 'textured') {
    const slots = tableTexture([all.uTL.value, all.uTLt.value]);
    const murals = tableTexture([all.uMurA.value, all.uMurB.value]);
    owned.push(slots, murals);
    Object.assign(uniforms, { uSurfaceTable: { value: slots }, uMuralTable: { value: murals }, tAlbedo: all.tAlbedo, tOrm: all.tOrm });
  }
  template.dispose();
  mat.name = `inkwave-mobile-${tier}${opts.grate ? '-grate' : ''}`;
  mat.defines = { ...mat.defines, INKWAVE_MOBILE_SURFACE: 1, ...(tier === 'basic' ? { INKWAVE_MOBILE_BASIC: 1 } : {}) };
  if (opts.grate) mat.side = THREE.DoubleSide;
  mat.userData.uniforms = uniforms;
  mat.userData.mobileTier = tier;
  mat.userData.mobileRebuild = next => {
    const result = createMobileLevelMaterial(paintTexture, atlasSize, muralTexture, { ...opts, mobileTier: next });
    // 降级时保留当前队伍色与地图时钟，不能退回工厂默认橙蓝。
    for (const key of names) if (uniforms[key]) result.userData.uniforms[key] = uniforms[key];
    return result;
  };
  mat.addEventListener('dispose', () => owned.forEach(texture => texture.dispose()));
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec2 paintUv; attribute vec2 faceUv; attribute vec4 faceData; attribute vec3 faceFlags; attribute vec2 lightUv;
varying vec2 mPaintUv; varying vec2 mFaceUv; varying vec4 mFaceData; varying vec3 mFaceFlags; varying vec3 mNormal; varying vec2 mLightUv;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
mPaintUv = paintUv; mFaceUv = faceUv; mFaceData = faceData; mFaceFlags = faceFlags;
mNormal = normalize(mat3(modelMatrix) * normal); mLightUv = lightUv;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uPaint;
uniform vec3 uTeamA; uniform vec3 uTeamB; uniform float uInkGlow;
varying vec2 mPaintUv; varying vec2 mFaceUv; varying vec4 mFaceData; varying vec3 mFaceFlags; varying vec3 mNormal; varying vec2 mLightUv;
float mInk = 0.0; float mWet = 0.0; vec3 mInkColor = vec3(0.0); vec3 mOrm = vec3(1.0,0.82,0.0);
${tier === 'textured' ? `uniform highp sampler2D uSurfaceTable; uniform highp sampler2D uMuralTable;
uniform highp sampler2DArray tAlbedo; uniform highp sampler2DArray tOrm; uniform sampler2D uMural;
uniform sampler2D uLight; uniform float uAO;` : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${opts.grate ? `{
  float w = fwidth(mFaceUv.x) + 0.0001;
  float a = 1.0 - smoothstep(0.02-w, 0.02+w, abs(fract(mFaceUv.x/0.07+0.5)-0.5)*0.07);
  float b = 1.0 - smoothstep(0.01-w, 0.01+w, abs(fract(mFaceUv.y/0.2+0.5)-0.5)*0.2);
  float edge = 1.0 - smoothstep(0.05,0.06,min(min(mFaceUv.x,mFaceData.z-mFaceUv.x),min(mFaceUv.y,mFaceData.w-mFaceUv.y)));
  if(abs(mNormal.y)>0.5 && max(max(a,b),edge)<0.5) discard;
}` : ''}
${tier === 'textured' ? `{
  int slot = clamp(int(mFaceData.x+0.5),0,${all.uTL.value.length - 1});
  vec4 mode = texelFetch(uSurfaceTable,ivec2(slot,1),0);
  if(abs(mNormal.y)<0.5) slot=int(mode.z+0.5); else if(mNormal.y>0.5) slot=int(mode.w+0.5);
  slot=clamp(slot,0,${all.uTL.value.length - 1});
  vec4 surface=texelFetch(uSurfaceTable,ivec2(slot,0),0);
  mode=texelFetch(uSurfaceTable,ivec2(slot,1),0);
  vec4 texel=texture(tAlbedo,vec3(mFaceUv*surface.y,surface.x));
  mOrm=texture(tOrm,vec3(mFaceUv*surface.y,surface.x)).rgb;
  if(mode.x<0.5) diffuseColor.rgb=texel.rgb;
  else if(mode.x<1.5) diffuseColor.rgb*=texel.rgb;
  else diffuseColor.rgb=texel.rgb+diffuseColor.rgb*texel.a*1.25;
  if(mFaceFlags.z>-0.5) {
    int mural=clamp(int(mFaceFlags.z+0.5),0,11);
    vec4 r=texelFetch(uMuralTable,ivec2(mural,0),0),p=texelFetch(uMuralTable,ivec2(mural,1),0);
    float y=p.w>0.0?(mFaceUv.y-p.z)/p.w:mFaceUv.y/max(mFaceData.w,0.001);
    float x=p.y<0.0?mFaceUv.x/max(-p.y*mFaceData.w,0.001):clamp((mFaceUv.x-p.x)/max(p.y,0.001),0.0005,0.9995);
    vec4 decal=texture2D(uMural,vec2(r.x+r.y*x,r.z+r.w*clamp(y,0.004,0.996)));
    diffuseColor.rgb=mix(diffuseColor.rgb,decal.rgb,decal.a*0.95);
  }
}` : ''}
if(mFaceData.y>0.5) {
  vec4 paint=texture2D(uPaint,mPaintUv);
  // 随屏幕覆盖率调整过渡宽度，远处墨迹边缘避免硬切；不增加图集或uniform数组。
  float inkWidth=max(fwidth(paint.a)*0.65,0.015);
  mInk=smoothstep(0.08-inkWidth,0.85+inkWidth,paint.a);
  float alpha=max(paint.a,0.0001);
  mWet=clamp(paint.g/alpha,0.0,1.0);
  mInkColor=mix(uTeamA,uTeamB,clamp(paint.r/alpha,0.0,1.0))*mix(0.85,1.08,clamp(paint.b/alpha,0.0,1.0));
  diffuseColor.rgb=mix(diffuseColor.rgb,mInkColor,mInk);
}`);
    if (tier === 'textured') {
      // 读取现有ORM区分石材/金属与湿墨；烘焙AO补足接触层次，不开昂贵实时AO。
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(clamp(mOrm.g,0.42,0.94),mix(0.38,0.24,mWet),mInk);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=min(mOrm.b,0.35)*(1.0-mInk);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize(normal-vec3(dFdx(mInk),dFdy(mInk),0.0)*0.10);')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
float mobileAO=mix(1.0,mOrm.r,0.45*(1.0-mInk));
if(uAO>0.0 && mLightUv.x>=0.0) mobileAO*=mix(1.0,texture2D(uLight,mLightUv).r,0.65*uAO);
reflectedLight.indirectDiffuse*=mobileAO;
reflectedLight.indirectSpecular*=mix(1.0,mobileAO,0.8);
reflectedLight.directDiffuse*=mix(1.0,mobileAO,0.2);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=mInkColor*mInk*uInkGlow;');
    }
  };
  mat.customProgramCacheKey = () => `inkwave-mobile-surface-v2-${tier}-${opts.grate ? 'grate' : 'solid'}`;
  return mat;
}
