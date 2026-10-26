// Showcase stage: a studio-lit overlay scene drawn on top of the live arena for the loadout screen (one squidkid on an
// ink-dipped pedestal) and the results screen (your team on a tiered ink podium with confetti + ink bursts, or a cool
// drizzle on defeat).
//
// Rendering: the stage is drawn into an MSAA HDR target and composited over the finished frame with three's own tone
// mapping + sRGB output (identical maths to drawing straight to the canvas, but antialiased). The target is the post
// composer's ping-pong buffer when it is compatible (those buffers are dead once composer.render() has output the frame,
// so borrowing costs no memory), else a private one. Framing is a full-screen projection with a lens shift
// (camera.setViewOffset) that puts the subject inside the UI's free area — measured from the live DOM, with stylesheet
// formula fallbacks — so nothing is ever cut by a viewport edge. Every effect is pooled/instanced; nothing allocates
// per frame. render() leaves the renderer exactly as it found it (target, clear colour/alpha, autoClear; viewport and
// scissor are untouched).
//
// API (driven by main.js): new Showcase(renderer, CharacterClass); showLoadout(weapon, color[, style]); showResults(team,
// won, color, styles); hide(); update(dt); render(); .mode ('loadout' | 'locker' | 'results' | null). Additive: dispose().
// Locker (driven by menus.js): showLocker(style, color[, weapon]) — same pedestal, closer framing, drag to spin;
// setStyle(style, cause) — swaps the look with a reaction ('hair'|'eyes'|'skin'|'outfit' → squash-pop / twirl,
// 'preset'|'random' → dives into the ink and bursts back out in the new look); portrait({ style, color, kind:
// 'head'|'bust'|'body', size, weapon }, cb(canvas)) — queued studio portraits for menu tiles (one per frame).
// Online (driven by menus.js): showHub(style, color, weapon) — your kid in the lobby set beside the create / join cards;
// showLobby(players, colors) / updateLobby / lobbyEmote(id, name) / lobbyGetSet() / lobbyAnchor(id, out) /
// lobbySlotAnchor(row, i, out) / lobbyLaunch() / leaveLobby() — the room's line-up (see the lobby set section).
// Lobby set: both online screens are staged in the LobbySet (src/game/lobbySet.js, a back alley), a scene of its own
// drawn full-frame. .fullFrame (getter) is true while it covers the whole screen: main.js then neither draws nor
// simulates the world (render() clears and draws the frame itself); it is false during the set's ~0.45 s
// cross-dissolves, which need the live world underneath. Audits: .debugCam = { pos, target, fov } overrides its camera.
// ================================================================================================
// 【中文导读】showcase.js —— 菜单展示台(Showcase Stage)
// 【职责】一个「摄影棚式」的叠加场景,画在实时竞技场画面之上:
//   · 装备界面(loadout)与更衣室(locker):一只乌贼小孩站在浸墨的旋转展台上;
//   · 结算界面(results):己方队伍站上分层墨台,胜放彩带墨花、败则冷雨凄凄;
//   · 联机界面(hub 大厅 + lobby 房间):后台预载并交给 LobbySet 后巷场景全屏呈现。
// 【与 boot 的关系】boot 阶段创建 this.showcase(见 docs BOOT.zh-CN.md 第 7 节);它复用 Character 类
//   生成预览角色,换装时在离屏先 warm 若干帧驱动骨骼与弹簧,防止新角色以 T-pose 亮相。
// 【渲染管线】场景画进 MSAA HDR 目标,再用合成 pass 以与直绘画布完全相同的色调映射 + sRGB 输出
//   叠加到成品帧(等价数学,但抗锯齿);目标尽量借用后处理合成器的 ping-pong 缓冲,省一份显存。
// 【相机】全屏投影 + 镜头偏移(setViewOffset),把主体放进 UI 空白区;空白区从真实 DOM 量取,
//   并带样式公式兜底,任何视口边缘都不会切到主体。
// 【配套阅读】docs BOOT.zh-CN.md 第 7 节(启动与加载流程)、docs ASSETS-CHARACTER.zh-CN.md 第 4 节(角色资源)。
// 【约定】所有特效均为池化/实例化,逐帧零分配;render() 结束后渲染器状态(目标、清屏色、autoClear)
//   与进入时完全一致。
// ================================================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, damp, lerp, rng } from '../core/ctx.js';
import { WEAPONS } from '../config.js';

// ================================================================================================
// 【数学工具】缓动、平滑、摆动等纯函数集合(全部无副作用,供全文件复用)
// 【要点】c01 夹取到 [0,1];sstep 平滑台阶;eOut3 三次出缓;eInOut 五次入出缓;backOut 回弹出缓;
//   smin 平滑最小值(圆角并集);wobble 冲击后的阻尼余振;punch 快攻慢放的脉冲(峰值约 0.75);
//   wrapA 角度包裹到 ±π;dampAngle 角度阻尼插值(走最短弧)。
// ================================================================================================ helpers
const TAU = Math.PI * 2;
const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const eOut3 = (t) => { t = 1 - c01(t); return 1 - t * t * t; };
const eInOut = (t) => { t = c01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const backOut = (t, k = 1.70158) => { t = c01(t) - 1; return 1 + t * t * ((k + 1) * t + k); };
const smin = (a, b, k) => { const h = c01(0.5 + 0.5 * (b - a) / k); return lerp(b, a, h) - k * h * (1 - h); };
// damped oscillation after an impulse at t = 0 (0 → swings → settles to 0)
const wobble = (t, f = 17, z = 7) => (t < 0 ? 0 : Math.exp(-t * z) * Math.sin(t * f));
// fast attack / slower release pulse, peak ≈ 0.75
const punch = (t, a = 22, r = 4.2) => (t < 0 ? 0 : (1 - Math.exp(-t * a)) * Math.exp(-t * r));
const UPV = new THREE.Vector3(0, 1, 0);
const wrapA = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const dampAngle = (a, b, l, dt) => a + wrapA(b - a) * (1 - Math.exp(-l * dt));

// 【展台尺寸】装备展台(pedestal)与结算鼓座(drum)的轮廓参数,单位米;
// y = 0 是涂墨层之前的台面;ink 是墨衣厚度。groove 是嵌灯管的环形灯槽,flange 是外翻的裙边。
// Loadout pedestal and results podium dimensions (metres; y = 0 is the pedestal/drum top before the ink coat).
const PED = { R: 0.64, bevel: 0.09, groove: { y: -0.235, h: 0.021, d: 0.022 }, flange: { y: -0.5, out: 0.075, b: 0.04 }, bottom: -3.0, ink: 0.014 };
const DRUM = { bevel: 0.09, groove: { y: -0.2, h: 0.019, d: 0.02 }, flange: { y: -0.44, out: 0.065, b: 0.035 }, bottom: -3.2, ink: 0.013 };
// 【结果台位】四名队员的站位表(0 号是本地玩家,站中央最高层);x/z 是平面位置,R 是鼓半径,
// top 是台面高度,yaw 是身体朝向(微外八,显得自然)。
// results slots, styles order (0 = local player on the centre top tier)
const SLOTS = [
  { x: 0, z: 0, R: 0.7, top: 0.72, yaw: 0 },
  { x: -1.34, z: -0.14, R: 0.63, top: 0.46, yaw: 0.2 },
  { x: 1.34, z: -0.14, R: 0.63, top: 0.46, yaw: -0.2 },
  { x: 2.55, z: -0.36, R: 0.56, top: 0.22, yaw: -0.34 },
];
// 【常量注】CHAR_H 角色含发高的身高(取景比例用);LOAD_FOCUS_Y 装备模式焦点高度;
// PEDESTAL 单角色展台模式集合;OVERLAY 叠加在实时世界上的摄影棚模式集合。
const CHAR_H = 1.62; // squidkid height incl. hair
const LOAD_FOCUS_Y = 0.76; // camera aims here on the loadout character (feet at 0)
const PEDESTAL = new Set(['loadout', 'locker']); // modes that stand one squidkid on the ink pedestal
const OVERLAY = new Set(['loadout', 'locker', 'results']); // studio modes drawn over the live world
// Online hub + room: staged in the LobbySet (src/game/lobbySet.js), drawn full-frame (see the lobby set section).
// 【联机模式】hub(大厅)与 lobby(房间)由 LobbySet 场景全屏呈现(见下文「lobby set」区段)。
const SET_MODES = new Set(['hub', 'lobby']);
// 【常量注】SET_FADE 场景淡入淡出时长;GLIDE 大厅⇄房间运镜时长;
// HUB_ID 未进房时你自己的占位成员 id;PLATE_H 名牌锚点(脚上方 1.64 m,略高于头顶)。
const SET_FADE = 0.45;        // set ⇄ world / pedestal / podium cross-dissolve (s)
const GLIDE = 1.7;            // hub ⇄ room camera glide (s)
const HUB_ID = '__hub';       // your kid while you are not in a room
const PLATE_H = 1.64;         // nameplate anchor above the feet (m): just over a kid's head
// 【乌贼游动参数】巡航速度、加减速、贴地抬升(游动姿态会沉入墨中,故需一点抬升)、
// 尾迹墨滴间距,以及跃上站位的抛物线(跨度、时长、高度)。
// 跃起在地面保持 3 m/s 以上,角色会按海豚弧飞跃(沿路径 mantle)。
// squid travel: cruise speed, acceleration, braking, root lift over the asphalt (the swim pose sinks into the ink),
// trail blob spacing, and the leap onto the mark (span, time, height)
// (the leap keeps > 3 m/s across the ground so the character flies it as a dolphin arc, mantle along the path)
const SWIM = { v: 10, acc: 26, brake: 13, lift: 0.1, gap: 0.07, leap: 2.3, T: 0.5, H: 0.62 };
// 【大厅表情】联机表情 → 角色舞蹈;v 强制舞蹈变体,t0 从舞蹈中段起播,hop 是附加小跳,trig 附带触发器。
// lobby emotes → character dances (danceVar forces the variant; t0 starts mid-dance)
const LOB_EMOTES = {
  booyah: { dance: 'victory', v: 0, dur: 2.9, hop: 0.32 },
  wave: { dance: 'victory', v: 2, dur: 2.35, hop: 0 },
  dance: { dance: 'victory', v: 1, dur: 3.4, hop: 0 },
  flex: { dance: 'victory', v: 0, t0: 2.86, dur: 1.55, hop: 0.12, trig: 'hairflip' },
};
const sameStyle = (a, b) => {
  if (!a || !b) return false;
  for (const k in a) if (a[k] !== b[k]) return false;
  for (const k in b) if (a[k] !== b[k]) return false;
  return true;
};

// ================================================================================================
// 【几何区】展台鼓身与墨衣的全部程序化几何:旋转体轮廓、墨衣 SDF 网格、溅斑、纸屑。
// 全部在首次展示前构建一次,之后只做显隐,不逐帧重建。
// ================================================================================================ geometry
// 【墨滴轮廓条带】把多条 [半径, 高度] 折线转成车削体顶点行 {r, y, 法线};
// 同一条带内法线平滑过渡,带与带之间硬边(法线不共享)→ 一条轮廓线既能出圆角又能出棱线。
// Lathe outline strips of [r, y] → rows {r, y, nr, ny}: normals smooth inside a strip, hard between strips.
function stripRows(strips) {
  const rows = [];
  for (const st of strips) {
    for (let i = 0; i < st.length; i++) {
      const a = st[Math.max(0, i - 1)], b = st[Math.min(st.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      rows.push({ r: st[i][0], y: st[i][1], nr: -ty, ny: tx });
    }
  }
  return rows;
}
function arcPts(out, cx, cy, rad, a0, a1, n, skipFirst) {
  for (let i = skipFirst ? 1 : 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); }
}

// 【鼓座轮廓】矮胖的展示鼓:平顶 → 大圆角 → 带圆灯槽的侧壁 → 外翻裙边台阶 → 长长的裙摆
// (裙摆一直延伸到屏幕外/扎进 UI 遮罩,舞台上永远看不到悬空的底边)。
// Chunky drum outline: flat top → big rounded bevel → side with a rounded light groove → hard step out onto a bevelled
// flange → long skirt (runs off-screen / into the UI scrim, so the stage never shows a floating bottom edge).
function drumOutline(R, P) {
  const b = P.bevel, gv = P.groove, fl = P.flange;
  const top = [];
  for (let i = 0; i < 8; i++) top.push([(R - b) * (i / 8), 0]);
  arcPts(top, R - b, -b, b, Math.PI / 2, 0, 18);
  top.push([R, gv.y + gv.h + 0.022]);
  for (let i = 0; i <= 12; i++) { const f = (i / 12) * Math.PI; top.push([R - gv.d * Math.sin(f), gv.y + gv.h * Math.cos(f)]); }
  top.push([R, gv.y - gv.h - 0.022]);
  top.push([R, fl.y]);
  const ledge = [[R, fl.y], [R + fl.out - fl.b, fl.y]];
  arcPts(ledge, R + fl.out - fl.b, fl.y - fl.b, fl.b, Math.PI / 2, 0, 10, true);
  ledge.push([R + fl.out, fl.y - 0.25], [R + fl.out, P.bottom * 0.5], [R + fl.out, P.bottom]);
  return stripRows([top, ledge]);
}

// 【车削网格】把轮廓行旋转成网格,并写入两项逐顶点数据:
// 【顶点色】纵向明暗渐变(顶部全亮、裙摆沉入深影、倒角下缘略亮模拟墨面反光);
// 【aGlow 属性】灯槽周围的光晕权重,供 bodyMat 的 onBeforeCompile 变成自发光。
// Lathe mesh with a vertical shade gradient (vertex colour) and a glow-spill attribute around the groove light.
function latheGeometry(rows, segs, groove) {
  const nR = rows.length, nV = nR * segs;
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 3), glw = new Float32Array(nV);
  for (let i = 0; i < nR; i++) {
    const w = rows[i];
    // top stays full value, the skirt sinks into a deep shade; a touch lighter just under the bevel (bounce from the ink)
    const shade = lerp(0.2, 1, sstep(-1.7, -0.06, w.y)) * (1 + 0.1 * Math.exp(-(((w.y + 0.14) / 0.08) ** 2)));
    const gd = (w.y - groove.y) / 0.055;
    const glow = 0.26 * Math.exp(-gd * gd) + 0.05 * Math.exp(-(((w.y - groove.y) / 0.2) ** 2));
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * TAU, s = Math.sin(a), c = Math.cos(a), k = i * segs + j;
      pos[k * 3] = w.r * s; pos[k * 3 + 1] = w.y; pos[k * 3 + 2] = w.r * c;
      nor[k * 3] = w.nr * s; nor[k * 3 + 1] = w.ny; nor[k * 3 + 2] = w.nr * c;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = shade;
      glw[k] = glow;
    }
  }
  const idx = [];
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = (i + 1) * segs + j, d = (i + 1) * segs + ((j + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glw, 1));
  g.setIndex(idx);
  return g;
}

// 【鼓身合一】鼓体 + 嵌在灯槽里的灯管合并成一个几何(一次 draw call):
// 灯管是近黑漫反射 + 满值 aGlow,点亮时整条灯槽发光。
// Drum body + the light tube sitting in its groove, merged (one draw call: the tube is black diffuse + full glow).
function drumGeometry(R, P, segs) {
  const body = latheGeometry(drumOutline(R, P), segs, P.groove);
  const tube = P.groove.h * 0.8;
  const ring = new THREE.TorusGeometry(R - P.groove.d + tube, tube, 10, segs).rotateX(Math.PI / 2);
  ring.translate(0, P.groove.y, 0);
  ring.deleteAttribute('uv');
  const n = ring.attributes.position.count;
  ring.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.03), 3));
  ring.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const g = mergeGeometries([body, ring]);
  body.dispose(); ring.dispose();
  return g;
}

// 【墨衣轮廓】涂装墨衣用的纵剖面(无灯槽与裙边——墨滴会直接跨过灯槽),
// 并沿剖面累计弧长 s,后续按弧长参数化生成网格,保证墨滴在任何曲率处粗细一致。
// Ink coat profile (no groove/flange: drips bridge over the groove) with arclength s.
function inkProfile(R, b, depth) {
  const st = [];
  for (let i = 0; i < 12; i++) st.push([(R - b) * (i / 12), 0]);
  arcPts(st, R - b, -b, b, Math.PI / 2, 0, 22);
  const nRim = st.length - 1;
  for (let i = 1; i <= 36; i++) st.push([R, -b - depth * (i / 36)]);
  const rows = stripRows([st]);
  rows[0].s = 0;
  for (let i = 1; i < rows.length; i++) rows[i].s = rows[i - 1].s + Math.hypot(rows[i].r - rows[i - 1].r, rows[i].y - rows[i - 1].y);
  return { rows, sRim: rows[nRim].s, sTopEnd: R - b, sMax: rows[rows.length - 1].s, R };
}
function profAt(P, s, o) {
  const rows = P.rows;
  let lo = 0, hi = rows.length - 1;
  if (s <= 0) { lo = 0; hi = 1; s = 0; } else if (s >= rows[hi].s) { lo = hi - 1; s = rows[hi].s; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m].s <= s) lo = m; else hi = m; }
  const a = rows[lo], b = rows[hi], f = c01((s - a.s) / (b.s - a.s || 1));
  o.r = lerp(a.r, b.r, f); o.y = lerp(a.y, b.y, f);
  const nr = lerp(a.nr, b.nr, f), ny = lerp(a.ny, b.ny, f), l = Math.hypot(nr, ny) || 1;
  o.nr = nr / l; o.ny = ny / l;
  return o;
}

// 【光泽墨衣】覆盖台面、翻过圆角、顺侧壁流成带圆头墨滴的涂层。建在
// (u = 周向弧长, s = 剖面弧长)参数平面上:【涂层区域 = 波浪唇边 ∪ 每滴墨滴的胶囊体(有符号距离)的平滑并集】,
// 网格每一列都精确终止在该轮廓线上;厚度在轮廓附近以四分之一圆过渡到零(每条边都读得出液珠感)。
// 【列划分】整周粗分,每滴墨滴附近细分,再按最小间距去重;【每列深度】在 sdf 上二分求出。
// Glossy ink coat: covers the top, rolls over the bevel and runs down the side as drips with round, beaded tips.
// Built on the (u = arclength around, s = arclength down the profile) plane: the coat region is the smooth union of a
// wavy lip and one capsule per drip (signed distance), each column of the grid ends exactly on that outline, and the
// thickness rolls off to zero with a quarter-round profile near the outline (so every edge reads as a liquid bead).
function inkCoatGeometry(R, b, drips, o) {
  const P = inkProfile(R, b, o.depth || 0.45);
  const rnd = rng(o.seed || 1);
  const k1 = rnd() * TAU, k2 = rnd() * TAU, k3 = rnd() * TAU, k4 = rnd() * TAU;
  const circ = TAU * R;
  const T0 = o.T0, Dt = o.Dt || 0.016;
  for (const d of drips) d.u = d.th * R;
  const lip = (th) => Math.max(0.01, (o.lip || 0.03) + 0.011 * Math.sin(3 * th + k1) + 0.007 * Math.sin(7 * th + k2) + 0.004 * Math.sin(13 * th + k3));
  const sdf = (u, s) => {
    const th = u / R;
    let d = s - (P.sRim + lip(th));
    for (let i = 0; i < drips.length; i++) {
      const D = drips[i];
      let du = u - D.u; du -= Math.round(du / circ) * circ;
      if (Math.abs(du) > D.w + 0.06) continue;
      const hw = D.w * 0.5, s0 = P.sRim - 0.04, s1 = P.sRim + D.L - hw;
      const cs = s < s0 ? s0 : s > s1 ? s1 : s;
      d = smin(d, Math.hypot(du, s - cs) - hw, 0.018);
    }
    return d;
  };
  // columns: coarse all round, fine across every drip
  const th = [];
  const nC = Math.ceil(circ / o.du);
  for (let j = 0; j < nC; j++) th.push((j / nC) * TAU);
  for (const D of drips) {
    const half = (D.w * 0.5 + 0.04) / R, n = Math.ceil((2 * half * R) / o.duF);
    for (let k = 0; k <= n; k++) { let a = D.th - half + 2 * half * (k / n); a = ((a % TAU) + TAU) % TAU; th.push(a); }
  }
  th.sort((a, c) => a - c);
  const cols = [th[0]];
  const minGap = (o.duF * 0.45) / R;
  for (let i = 1; i < th.length; i++) if (th[i] - cols[cols.length - 1] > minGap) cols.push(th[i]);
  if (TAU - cols[cols.length - 1] + cols[0] < minGap) cols.pop();
  const NC = cols.length;
  // per-column outline depth (bisection on the sdf along s)
  const sEnd = new Float32Array(NC);
  for (let j = 0; j < NC; j++) {
    const u = cols[j] * R;
    let lo = P.sRim - 0.035, hi = Math.min(P.sMax, P.sRim + 0.5);
    for (let it = 0; it < 26; it++) { const m = (lo + hi) * 0.5; if (sdf(u, m) < 0) lo = m; else hi = m; }
    sEnd[j] = lo;
  }
  // rows: flat top, bevel (dense), then drip part scaled per column and packed toward the tip
  const rowsA = [];
  const nTop = 9, nBev = 14;
  for (let i = 0; i < nTop; i++) rowsA.push(P.sTopEnd * (i / nTop));
  for (let i = 0; i < nBev; i++) rowsA.push(P.sTopEnd + (P.sRim - P.sTopEnd) * (i / nBev));
  const NB = o.NB || 24, NA = rowsA.length, NRow = NA + NB + 1;
  const pos = new Float32Array(NC * NRow * 3);
  const pr = { r: 0, y: 0, nr: 0, ny: 0 };
  for (let j = 0; j < NC; j++) {
    const a = cols[j], sa = Math.sin(a), ca = Math.cos(a), u = a * R;
    for (let i = 0; i < NRow; i++) {
      let s;
      if (i < NA) s = rowsA[i];
      else { const f = (i - NA) / NB; s = P.sRim + (sEnd[j] - P.sRim) * (1 - Math.pow(1 - f, 1.55)); }
      const sd = sdf(u, s);
      const x = c01(-sd / Dt);
      let tk = T0 * (1 + 0.5 * c01((s - P.sRim - 0.03) / 0.2));
      for (let q = 0; q < drips.length; q++) {
        const D = drips[q];
        let du = u - D.u; du -= Math.round(du / circ) * circ;
        if (Math.abs(du) > D.w) continue;
        const hw = D.w * 0.5, sc = P.sRim + D.L - hw * 1.1;
        const e = ((s - sc) / (hw * 0.95)) ** 2 + (du / (hw * 0.8)) ** 2;
        tk += T0 * 0.6 * Math.exp(-e) * c01((D.L - 0.05) / 0.08);
      }
      tk *= 1 + 0.08 * Math.sin(a * 5 + s * 11 + k4) * Math.sin(a * 3 - s * 7 + k2);
      const t = tk * Math.sqrt(1 - (1 - x) * (1 - x)) + 0.0012;
      profAt(P, s, pr);
      const k = (j * NRow + i) * 3;
      const rr = pr.r + pr.nr * t;
      pos[k] = rr * sa; pos[k + 1] = pr.y + pr.ny * t; pos[k + 2] = rr * ca;
    }
  }
  const idx = [];
  for (let j = 0; j < NC; j++) {
    const jn = (j + 1) % NC;
    for (let i = 0; i < NRow - 1; i++) {
      const a = j * NRow + i, c = jn * NRow + i, b2 = j * NRow + i + 1, d = jn * NRow + i + 1;
      idx.push(a, b2, c, c, b2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 【墨滴布局】黄金角散布 + 抖动;front 参数把墨滴限制在朝向相机的半圈(结算台用,省面数)。
// Drip layout: golden-angle spread with jitter; `front` limits them to the camera-facing half.
function makeDrips(seed, n, o) {
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    let th;
    if (o.front) th = (i / (n - 1) - 0.5) * o.front * 2 + (rnd() - 0.5) * (o.front / n);
    else th = i * 2.39996 + (rnd() - 0.5) * 0.25;
    const long = rnd() < o.longChance;
    out.push({ th: ((th % TAU) + TAU) % TAU, w: lerp(o.w0, o.w1, rnd()), L: long ? lerp(o.L1 * 0.8, o.L1, rnd()) : lerp(o.L0, o.L1 * 0.6, rnd()) });
  }
  return out;
}

// 【墨溅贴片】扁平的墨渍贴花(拱顶中心 + 波浪边缘 + 五颗卫星小滴),半径约 1、拱高约 0.16;
// 实例化复用,用作墨滴落地斑、水花。
// Flat ink splat decal (domed centre, wavy rim, satellite droplets). Radius ≈ 1, dome height ≈ 0.16.
function splatGeometry() {
  const rnd = rng(77);
  const parts = [];
  const dome = (cx, cz, R, amp, N, rings, h) => {
    const k = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
    const rad = (a) => R * (1 + amp * (0.55 * Math.sin(5 * a + k[0]) + 0.3 * Math.sin(9 * a + k[1]) + 0.15 * Math.sin(14 * a + k[2])));
    const pos = [cx, h, cz];
    for (let r = 1; r <= rings; r++) {
      const f = r / rings;
      for (let i = 0; i < N; i++) { const a = (i / N) * TAU, rr = rad(a) * f; pos.push(cx + Math.sin(a) * rr, h * Math.pow(Math.max(0, 1 - f * f), 0.7) + 0.004, cz + Math.cos(a) * rr); }
    }
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
    for (let r = 1; r < rings; r++) {
      const o0 = 1 + (r - 1) * N, o1 = 1 + r * N;
      for (let i = 0; i < N; i++) { const i1 = (i + 1) % N; idx.push(o0 + i, o1 + i, o0 + i1, o0 + i1, o1 + i, o1 + i1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g);
  };
  dome(0, 0, 1, 0.2, 44, 4, 0.16);
  for (let i = 0; i < 5; i++) { const a = rnd() * TAU, d = 1.25 + rnd() * 0.45; dome(Math.sin(a) * d, Math.cos(a) * d, 0.1 + rnd() * 0.12, 0.08, 12, 2, 0.06); }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
}

// 【纸屑几何】带轻微卷曲的纸带(穿过灯光翻飞时读得出「纸」的质感),实例化复用。
// Paper strip with a slight curl (reads as paper when it tumbles through the light).
function confettiGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 1, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, 0.22 * y * y - 0.05); }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// ================================================================================================
// 【特效区(池化)】四个实例化特效池 + 共享临时对象。
// 【要点】共享矩阵/四元数/向量(_m4 等)避免逐帧分配;ZERO_M 是零缩放矩阵(隐藏一个实例的惯用法);
//   Q_FLAT 是「平躺」旋转(纸屑落地时把纸带压平)。
// ================================================================================================ effects (pooled)
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const Q_FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

// 【墨特效池】墨滴(飞溅小滴 / 抛物墨弹 / 细雨 / 上浮气泡)+ 落地溅斑 + 涟漪环,全部实例化。
// 【要点】mesh 是 150 个墨滴实例(K 记录种类:0 空闲 1 墨滴 2 墨弹 3 气泡 4 细雨);
//   splats 56 个溅斑、rings 10 个涟漪环,各用环形下标复用槽位;
//   每帧只把 count 覆盖到最后一个存活实例,死槽位保持零矩阵。
// Ink blobs (splash droplets, arcing ink bombs, drizzle, floating bubbles) + landing splats + ripple rings.
class InkFX {
  constructor(root, mat, rand) {
    this.rand = rand;
    const N = (this.N = 150);
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat, N);
    this.P = new Float32Array(N * 3); this.V = new Float32Array(N * 3);
    this.R = new Float32Array(N); this.A = new Float32Array(N); this.L = new Float32Array(N); this.S = new Float32Array(N);
    this.K = new Uint8Array(N); // 0 free · 1 droplet · 2 bomb · 3 bubble · 4 drizzle
    const SN = (this.SN = 56);
    this.splats = new THREE.InstancedMesh(splatGeometry(), mat, SN);
    this.SP = new Float32Array(SN * 3); this.SS = new Float32Array(SN); this.SY = new Float32Array(SN);
    this.SA = new Float32Array(SN).fill(1e9); this.SL = new Float32Array(SN); this.sNext = 0;
    const RN = (this.RN = 10);
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.034, 8, 96).rotateX(Math.PI / 2), mat, RN);
    this.RP = new Float32Array(RN * 3); this.R0 = new Float32Array(RN); this.R1 = new Float32Array(RN);
    this.RA = new Float32Array(RN).fill(1e9); this.RL = new Float32Array(RN); this.rNext = 0;
    for (const m of [this.mesh, this.splats, this.rings]) {
      m.frustumCulled = false; m.count = 0;
      for (let i = 0; i < m.instanceMatrix.count; i++) m.setMatrixAt(i, ZERO_M);
      root.add(m);
    }
    this.mesh.castShadow = true;
    this.splats.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }
  _slot() { for (let i = 0; i < this.N; i++) if (!this.K[i]) return i; return -1; }
  drop(x, y, z, vx, vy, vz, r, kind = 1, life = 6) {
    const i = this._slot(); if (i < 0) return -1;
    const i3 = i * 3;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z;
    this.V[i3] = vx; this.V[i3 + 1] = vy; this.V[i3 + 2] = vz;
    this.R[i] = r; this.A[i] = 0; this.L[i] = life; this.S[i] = this.rand() * TAU; this.K[i] = kind;
    return i;
  }
  bubble(x, y, z, r, rise, life) {
    const i = this.drop(x, y, z, x, rise, z, r, 3, life);
    return i;
  }
  splat(x, y, z, size, life) {
    const j = this.sNext; this.sNext = (j + 1) % this.SN;
    this.SP[j * 3] = x; this.SP[j * 3 + 1] = y + 0.0008 + (j % 7) * 0.00035; this.SP[j * 3 + 2] = z;
    this.SS[j] = size; this.SY[j] = this.rand() * TAU; this.SA[j] = 0; this.SL[j] = life;
  }
  ripple(x, y, z, r0, r1, life) {
    const j = this.rNext; this.rNext = (j + 1) % this.RN;
    this.RP[j * 3] = x; this.RP[j * 3 + 1] = y + 0.002; this.RP[j * 3 + 2] = z;
    this.R0[j] = r0; this.R1[j] = r1; this.RA[j] = 0; this.RL[j] = life;
  }
  // crown splash around a point on a deck (e.g. feet landing / a squidkid bursting out of the ink)
  crown(x, y, z, power, n, ring = 0.2) {
    const rnd = this.rand;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.45;
      const rr = ring * (0.8 + rnd() * 0.6), out = (0.5 + rnd() * 0.9) * power, up = (1.7 + rnd() * 1.7) * power;
      this.drop(x + Math.sin(a) * rr, y + 0.01, z + Math.cos(a) * rr, Math.sin(a) * out, up, Math.cos(a) * out, 0.011 + rnd() * rnd() * 0.026, 1, 4);
    }
    this.ripple(x, y, z, ring * 0.8, ring + 0.55 * power, 0.6);
  }
  clear() {
    this.K.fill(0); this.SA.fill(1e9); this.RA.fill(1e9);
    for (const m of [this.mesh, this.splats, this.rings]) { for (let i = 0; i < m.instanceMatrix.count; i++) m.setMatrixAt(i, ZERO_M); m.count = 0; m.instanceMatrix.needsUpdate = true; }
  }
  _land(i, k, x, y, z) {
    const r = this.R[i], rnd = this.rand;
    if (k === 1) this.splat(x, y, z, r * 2.5, 1.4 + rnd() * 0.9);
    else if (k === 4) { this.splat(x, y, z, r * 2.1, 1.1 + rnd() * 0.5); this.ripple(x, y, z, 0.02, 0.2 + r * 3, 0.5); }
    else if (k === 2) {
      this.splat(x, y, z, r * 3.3, 3.4 + rnd());
      this.ripple(x, y, z, r, 0.55 + r * 4, 0.75);
      const n = 9;
      for (let q = 0; q < n; q++) {
        const a = (q / n) * TAU + rnd() * 0.6, sp = 0.9 + rnd() * 1.3;
        this.drop(x + Math.sin(a) * r, y + 0.02, z + Math.cos(a) * r, Math.sin(a) * sp, 1.3 + rnd() * 1.8, Math.cos(a) * sp, 0.012 + rnd() * 0.02, 1, 3);
      }
    }
  }
  // 【主更新】墨滴按种类模拟:气泡上浮带摇摆、快爆时膨胀;其余受重力,按速度拉伸成梭形;
  // 穿越甲板面(decks,圆形判定,zs 支持椭圆台)即落地转成溅斑/涟漪;落出 y<-3.5 或超时即回收。
  update(dt, decks) {
    const P = this.P, V = this.V;
    let top = -1;
    for (let i = 0; i < this.N; i++) {
      const k = this.K[i];
      if (!k) continue;
      const i3 = i * 3;
      const age = (this.A[i] += dt);
      let x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
      const r = this.R[i];
      if (k === 3) {
        // bubble: rises with a lazy wobble, swells and pops
        const L = this.L[i];
        if (age >= L) { this.K[i] = 0; this.mesh.setMatrixAt(i, ZERO_M); continue; }
        const S = this.S[i];
        y += V[i3 + 1] * dt * (0.75 + 0.25 * Math.sin(age * 1.9 + S));
        x = V[i3] + 0.035 * Math.sin(age * 1.7 + S) * Math.min(1, age);
        z = V[i3 + 2] + 0.035 * Math.cos(age * 1.3 + S * 1.3) * Math.min(1, age);
        const grow = eOut3(age / 0.5), pop = age > L - 0.14 ? 1 + 0.35 * ((age - (L - 0.14)) / 0.14) : 1;
        const vis = age > L - 0.03 ? 0 : 1;
        const wob = 1 + 0.12 * Math.sin(age * 8 + S);
        const sc = r * grow * pop * vis;
        _q.identity();
        _s.set(sc / Math.sqrt(wob), sc * wob, sc / Math.sqrt(wob));
      } else {
        const g = k === 2 ? 9.5 : k === 4 ? 9.8 : 10.5;
        V[i3 + 1] -= g * dt;
        if (k === 4 && V[i3 + 1] < -5.2) V[i3 + 1] = -5.2;
        const py = y;
        x += V[i3] * dt; y += V[i3 + 1] * dt; z += V[i3 + 2] * dt;
        let landed = false;
        for (let d = 0; d < decks.length; d++) {
          const D = decks[d];
          if (py >= D.y && y < D.y) {
            const dx = x - D.x, dz = (z - D.z) / (D.zs || 1);   // zs: oval decks (lobby stage)
            if (dx * dx + dz * dz < D.r * D.r) { landed = true; this.K[i] = 0; this.mesh.setMatrixAt(i, ZERO_M); this._land(i, k, x, D.y, z); break; }
          }
        }
        if (landed) continue;
        if (y < -3.5 || age > this.L[i]) { this.K[i] = 0; this.mesh.setMatrixAt(i, ZERO_M); continue; }
        const vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2], sp = Math.hypot(vx, vy, vz);
        const st = 1 + Math.min(sp * 0.055, 0.9);
        if (sp > 0.05) _q.setFromUnitVectors(UPV, _d.set(vx / sp, vy / sp, vz / sp)); else _q.identity();
        const grow = k === 2 ? eOut3(age / 0.12) : 1;
        _s.set((r * grow) / Math.sqrt(st), r * grow * st, (r * grow) / Math.sqrt(st));
      }
      P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
      _m4.compose(_v.set(x, y, z), _q, _s);
      this.mesh.setMatrixAt(i, _m4);
      top = i;
    }
    this.mesh.count = top + 1;
    this.mesh.instanceMatrix.needsUpdate = true;
    // splats: pop in with overshoot, sink back into the surface
    let sTop = -1;
    for (let j = 0; j < this.SN; j++) {
      const L = this.SL[j];
      if (this.SA[j] >= L) continue;
      const a = (this.SA[j] += dt);
      if (a >= L) { this.splats.setMatrixAt(j, ZERO_M); continue; }
      const grow = backOut(a / 0.16, 2.2), shrink = 1 - eInOut((a - L * 0.5) / (L * 0.5));
      const s = this.SS[j] * grow * Math.max(0.001, shrink);
      _q.setFromAxisAngle(UPV, this.SY[j]);
      _s.set(s, s * (0.35 + 0.65 * shrink), s);
      _m4.compose(_v.set(this.SP[j * 3], this.SP[j * 3 + 1], this.SP[j * 3 + 2]), _q, _s);
      this.splats.setMatrixAt(j, _m4);
      sTop = j;
    }
    // ripple rings: expand and flatten out
    let rTop = -1;
    for (let j = 0; j < this.RN; j++) {
      const L = this.RL[j];
      if (this.RA[j] >= L) continue;
      const a = (this.RA[j] += dt);
      if (a >= L) { this.rings.setMatrixAt(j, ZERO_M); continue; }
      const f = a / L, rad = lerp(this.R0[j], this.R1[j], eOut3(f)), h = (1 - f) * (1 - f);
      _q.identity();
      _s.set(rad, Math.max(0.001, rad * 0.55 * h), rad);
      _m4.compose(_v.set(this.RP[j * 3], this.RP[j * 3 + 1], this.RP[j * 3 + 2]), _q, _s);
      this.rings.setMatrixAt(j, _m4);
      rTop = j;
    }
    // keep counts covering every live slot (dead slots in between hold zero matrices)
    this.splats.count = this._span(this.SA, this.SL, this.SN, sTop);
    this.rings.count = this._span(this.RA, this.RL, this.RN, rTop);
    this.splats.instanceMatrix.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
  }
  _span(A, L, n, top) { for (let j = n - 1; j > top; j--) if (A[j] < L[j]) return j + 1; return top + 1; }
}

// 【彩带池】纸 + 金属箔两种彩带:礼炮齐射与飘落雨;翻飞时扑翼摆动,落在鼓面上停留后消融。
// 【要点】paper 280 张、foil 72 张(金属箔更窄长、高 metalness);状态 0 空闲 1 飞行 2 落定;
//   颜色按队伍调色板逐实例设置(setColorAt)。
// Paper + foil confetti: cannon bursts and a falling rain; tumbles with flutter and settles on the podium tops.
class Confetti {
  constructor(scene, rand) {
    this.rand = rand;
    const geo = confettiGeometry();
    this.NP = 280; this.NF = 72;
    const N = (this.N = this.NP + this.NF);
    this.paper = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 }), this.NP);
    this.foil = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.26, metalness: 0.9 }), this.NF);
    const white = new THREE.Color(1, 1, 1);
    for (const m of [this.paper, this.foil]) {
      m.frustumCulled = false; m.count = 0; m.renderOrder = 2;
      for (let i = 0; i < m.instanceMatrix.count; i++) { m.setMatrixAt(i, ZERO_M); m.setColorAt(i, white); }
      scene.add(m);
    }
    this.P = new Float32Array(N * 3); this.V = new Float32Array(N * 3); this.AX = new Float32Array(N * 3);
    this.ANG = new Float32Array(N); this.SPIN = new Float32Array(N); this.PH = new Float32Array(N); this.FQ = new Float32Array(N);
    this.SW = new Float32Array(N); this.SH = new Float32Array(N); this.AGE = new Float32Array(N); this.LIFE = new Float32Array(N);
    this.YAW = new Float32Array(N); this.REST = new Float32Array(N);
    this.ST = new Uint8Array(N); // 0 free · 1 flying · 2 settled
    this.acc = 0;
    this.palette = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
    this.foils = [new THREE.Color(1.0, 0.72, 0.28), new THREE.Color(0.86, 0.88, 0.92), new THREE.Color()];
  }
  setColor(team) {
    const p = this.palette;
    p[0].copy(team); p[1].setRGB(0.92, 0.92, 0.95); p[2].setRGB(1.0, 0.66, 0.08); p[3].copy(team).lerp(p[1], 0.55);
    this.foils[2].copy(team).lerp(this.foils[1], 0.25);
  }
  _slot(foil) {
    const a = foil ? this.NP : 0, b = foil ? this.N : this.NP;
    for (let i = a; i < b; i++) if (!this.ST[i]) return i;
    return -1;
  }
  spawn(x, y, z, vx, vy, vz, foil) {
    const i = this._slot(foil); if (i < 0) return;
    const rnd = this.rand, i3 = i * 3;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z;
    this.V[i3] = vx; this.V[i3 + 1] = vy; this.V[i3 + 2] = vz;
    _d.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    this.AX[i3] = _d.x; this.AX[i3 + 1] = _d.y; this.AX[i3 + 2] = _d.z;
    this.ANG[i] = rnd() * TAU; this.SPIN[i] = (5 + rnd() * 9) * (rnd() < 0.5 ? -1 : 1);
    this.PH[i] = rnd() * TAU; this.FQ[i] = 2.2 + rnd() * 2.6;
    const s = 0.8 + rnd() * 0.45;
    this.SW[i] = (foil ? 0.034 : 0.03) * s; this.SH[i] = (foil ? 0.034 : 0.064) * s;
    this.AGE[i] = 0; this.LIFE[i] = 11 + rnd() * 4; this.ST[i] = 1;
    this.YAW[i] = rnd() * TAU; this.REST[i] = 4 + rnd() * 5;
    if (foil) { this.foil.setColorAt(i - this.NP, this.foils[(rnd() * 3) | 0]); this.foil.instanceColor.needsUpdate = true; }
    else {
      const u = rnd();
      this.paper.setColorAt(i, this.palette[u < 0.46 ? 0 : u < 0.72 ? 1 : u < 0.86 ? 2 : 3]);
      this.paper.instanceColor.needsUpdate = true;
    }
  }
  burst(x, y, z, dx, dy, dz, n, speed, spread) {
    const rnd = this.rand;
    for (let i = 0; i < n; i++) {
      _v.set(dx + (rnd() - 0.5) * spread, dy + (rnd() - 0.5) * spread * 0.6, dz + (rnd() - 0.5) * spread).normalize();
      const sp = speed * (0.55 + rnd() * 0.6);
      this.spawn(x + (rnd() - 0.5) * 0.3, y + (rnd() - 0.5) * 0.3, z + (rnd() - 0.5) * 0.3, _v.x * sp, _v.y * sp, _v.z * sp, rnd() < 0.2);
    }
  }
  rain(dt, rate, x0, x1, z0, z1, y) {
    this.acc += dt * rate;
    const rnd = this.rand;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.spawn(lerp(x0, x1, rnd()), y + rnd() * 0.6, lerp(z0, z1, rnd()), (rnd() - 0.5) * 0.4, -0.3 - rnd() * 0.5, (rnd() - 0.5) * 0.3, rnd() < 0.18);
    }
  }
  clear() {
    this.ST.fill(0); this.acc = 0;
    for (const m of [this.paper, this.foil]) { for (let i = 0; i < m.instanceMatrix.count; i++) m.setMatrixAt(i, ZERO_M); m.count = 0; m.instanceMatrix.needsUpdate = true; }
  }
  update(dt, decks) {
    const P = this.P, V = this.V;
    let topP = -1, topF = -1;
    const kd = Math.exp(-2.9 * dt);
    for (let i = 0; i < this.N; i++) {
      const st = this.ST[i];
      if (!st) continue;
      const foil = i >= this.NP, mesh = foil ? this.foil : this.paper, mi = foil ? i - this.NP : i;
      const i3 = i * 3;
      const age = (this.AGE[i] += dt);
      let x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
      let life = 1;
      if (st === 1) {
        V[i3 + 1] -= 4.1 * dt;
        V[i3] *= kd; V[i3 + 1] *= kd; V[i3 + 2] *= kd;
        const fl = Math.min(1, age * 1.5);
        const py = y;
        x += (V[i3] + fl * 0.5 * Math.sin(age * this.FQ[i] + this.PH[i])) * dt;
        y += V[i3 + 1] * dt;
        z += (V[i3 + 2] + fl * 0.3 * Math.cos(age * this.FQ[i] * 0.73 + this.PH[i])) * dt;
        this.ANG[i] += this.SPIN[i] * dt;
        for (let d = 0; d < decks.length; d++) {
          const D = decks[d];
          if (py >= D.y && y < D.y) {
            const dx = x - D.x, dz = z - D.z;
            if (dx * dx + dz * dz < D.r * D.r) { this.ST[i] = 2; y = D.y + 0.003 + (i % 5) * 0.0006; this.AGE[i] = 0; break; }
          }
        }
        if (y < -3.2 || age > this.LIFE[i]) { this.ST[i] = 0; mesh.setMatrixAt(mi, ZERO_M); continue; }
        _q.setFromAxisAngle(_d.set(this.AX[i3], this.AX[i3 + 1], this.AX[i3 + 2]), this.ANG[i]);
      } else {
        const rest = this.REST[i];
        if (age > rest) { this.ST[i] = 0; mesh.setMatrixAt(mi, ZERO_M); continue; }
        life = 1 - sstep(rest - 0.6, rest, age);
        _q.setFromAxisAngle(UPV, this.YAW[i]).multiply(Q_FLAT);
      }
      P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
      _s.set(this.SW[i] * life, this.SH[i] * life, this.SW[i] * life);
      _m4.compose(_v.set(x, y, z), _q, _s);
      mesh.setMatrixAt(mi, _m4);
      if (foil) topF = mi; else topP = mi;
    }
    this.paper.count = topP + 1; this.foil.count = topF + 1;
    this.paper.instanceMatrix.needsUpdate = true; this.foil.instanceMatrix.needsUpdate = true;
  }
}

// 【闪光池】相机朝向的星芒闪点(亮核 + 四条射线),用于点睛、换装庆祝;
// 尺寸随生命周期包络起伏,轻微上飘。实例 36 个,环形复用。
// Twinkling star glints (camera-facing, bright core + 4 rays).
class Sparkles {
  constructor(root, mat, rand) {
    this.rand = rand;
    const N = (this.N = 36);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, N);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 20;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < N; i++) { this.mesh.setMatrixAt(i, ZERO_M); this.mesh.setColorAt(i, white); }
    root.add(this.mesh);
    this.P = new Float32Array(N * 3); this.A = new Float32Array(N).fill(1e9); this.L = new Float32Array(N); this.S = new Float32Array(N);
    this.next = 0; this.acc = 0;
  }
  spawn(x, y, z, size, color, life) {
    const i = this.next; this.next = (i + 1) % this.N;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.A[i] = 0; this.L[i] = life; this.S[i] = size;
    this.mesh.setColorAt(i, color); this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.A.fill(1e9); this.acc = 0; for (let i = 0; i < this.N; i++) this.mesh.setMatrixAt(i, ZERO_M); this.mesh.count = 0; this.mesh.instanceMatrix.needsUpdate = true; }
  update(dt) {
    let top = -1;
    for (let i = 0; i < this.N; i++) {
      if (this.A[i] >= this.L[i]) continue;
      const a = (this.A[i] += dt), L = this.L[i];
      if (a >= L) { this.mesh.setMatrixAt(i, ZERO_M); continue; }
      const f = a / L, env = Math.pow(Math.sin(Math.PI * f), 1.6) * (0.82 + 0.18 * Math.sin(a * 31 + i));
      const s = this.S[i] * env;
      _m4.makeScale(s, s, s).setPosition(this.P[i * 3], this.P[i * 3 + 1] + a * 0.05, this.P[i * 3 + 2]);
      this.mesh.setMatrixAt(i, _m4);
      top = i;
    }
    let n = top + 1;
    for (let i = this.N - 1; i >= n; i--) if (this.A[i] < this.L[i]) { n = i + 1; break; }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// 【湿墨尾迹】游动乌贼身后的湿痕:沿路径每隔几厘米铺一个低拱顶,实例 520 个,
// 按队伍色逐实例上色,交叠成一条连续湿痕;先鼓起、随后「渗入沥青」(变窄变薄)数秒后消失。
// 【要点】clearcoat 只开 0.55——掠射角下全清漆只会镜像天空显得发白。
// Wet ink trail behind a swimming squid: low glossy domes laid every few cm along its path (one instanced draw, the
// swimmer's team colour per instance), overlapping into one streak. Each swells in behind the squid, then soaks into
// the asphalt (narrower, thinner) and is gone after a few seconds.
class InkTrail {
  constructor(root) {
    const N = (this.N = 520);
    const geo = new THREE.SphereGeometry(1, 16, 5, 0, TAU, 0, Math.PI / 2);   // a dome: flat underside on the ground
    // wet but coloured: at the grazing angles a lane is seen at, a full clearcoat just mirrors the sky and reads white
    this.mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.14, envMapIntensity: 0.3 });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, N);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.receiveShadow = true;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < N; i++) { this.mesh.setMatrixAt(i, ZERO_M); this.mesh.setColorAt(i, white); }
    root.add(this.mesh);
    this.P = new Float32Array(N * 3); this.Y = new Float32Array(N); this.W = new Float32Array(N); this.Ln = new Float32Array(N);
    this.A = new Float32Array(N).fill(1e9); this.L = new Float32Array(N); this.next = 0;
  }
  add(x, y, z, yaw, w, len, color, life) {
    const i = this.next; this.next = (i + 1) % this.N;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y + 0.0015 + (i % 5) * 0.0003; this.P[i * 3 + 2] = z;
    this.Y[i] = yaw; this.W[i] = w; this.Ln[i] = len; this.A[i] = 0; this.L[i] = life;
    this.mesh.setColorAt(i, color); this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.A.fill(1e9); for (let i = 0; i < this.N; i++) this.mesh.setMatrixAt(i, ZERO_M); this.mesh.count = 0; this.mesh.instanceMatrix.needsUpdate = true; }
  update(dt) {
    let top = -1;
    for (let i = 0; i < this.N; i++) {
      if (this.A[i] >= this.L[i]) continue;
      const a = (this.A[i] += dt), L = this.L[i];
      if (a >= L) { this.mesh.setMatrixAt(i, ZERO_M); continue; }
      const grow = eOut3(a / 0.14), soak = 1 - eInOut((a - 0.3 * L) / (0.7 * L));
      _q.setFromAxisAngle(UPV, this.Y[i]);
      // a film, not a tube: a few mm proud of the asphalt, thinning as it soaks in
      _s.set(this.W[i] * grow * (0.3 + 0.7 * soak), Math.max(0.0004, 0.0065 * grow * soak), this.Ln[i] * grow * (0.55 + 0.45 * soak));
      _m4.compose(_v.set(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]), _q, _s);
      this.mesh.setMatrixAt(i, _m4);
      top = i;
    }
    let n = top + 1;
    for (let i = this.N - 1; i >= n; i--) if (this.A[i] < this.L[i]) { n = i + 1; break; }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}

// 【游动路径】把场景给的折线变成弧长参数表。平面形状:点列的向心 Catmull-Rom,每约 8 cm 重采样;
// 高度直接取自折线本身,所以一段楼梯保持为匀速斜坡,游动者把它当作一次跳跃(climbs[])飞跃。
// pathAt() → 弧长 s 处的地面点 + 平面方向,以及该处应叠加的跳跃高度。
// Swim paths (set polylines → arc-length tables). Plan shape: centripetal Catmull-Rom through the points in xz,
// resampled every ~8 cm; heights come from the polyline itself, so a flight of stairs stays a straight rise, which the
// swimmer takes as one hop (climbs[]). pathAt() → the ground point + plan direction at arc length s, and the hop.
function polyY(pts, q) {
  let best = 1e9, y = pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const u = l2 > 1e-8 ? c01(((q.x - a.x) * dx + (q.z - a.z) * dz) / l2) : 0;
    const ex = a.x + dx * u - q.x, ez = a.z + dz * u - q.z, d = ex * ex + ez * ez;
    if (d < best - 1e-9) { best = d; y = a.y + (b.y - a.y) * u; }
  }
  return y;
}
// 【避障】路径中段若贴近站着的角色(avoid,含高度差判定)就把采样点外推,三遍平滑;
// 两端各留 0.5 m / 1.3 m 不动——那正是出发与落点。
function makePath(raw, avoid) {
  const pts = [raw[0].clone()];
  for (const p of raw) if (p.distanceTo(pts[pts.length - 1]) > 0.03) pts.push(p.clone());
  if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0, 0, 0.05)));
  const flat = pts.map((p) => new THREE.Vector3(p.x, 0, p.z));
  const curve = new THREE.CatmullRomCurve3(flat, false, 'centripetal');
  const sp = curve.getSpacedPoints(Math.max(2, Math.ceil(curve.getLength() / 0.08)));
  for (const q of sp) q.y = polyY(pts, q);
  // steer round kids standing near the line (not at the ends: that is where the swimmer starts / lands)
  if (avoid && avoid.length) {
    const n = sp.length, R = 0.62;
    let cum = 0;
    const cs = [0];
    for (let i = 1; i < n; i++) cs.push((cum += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].z - sp[i - 1].z)));
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < n - 1; i++) {
        if (cs[i] < 0.5 || cs[n - 1] - cs[i] < 1.3) continue;
        const q = sp[i];
        for (const o of avoid) {
          if (Math.abs(o.y - q.y) > 0.5) continue;
          const dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz);
          if (d < R) { const k = (R - d) / Math.max(d, 1e-3); q.x += dx * k; q.z += dz * k; }
        }
      }
      for (let i = 1; i < n - 1; i++) { sp[i].x = (sp[i - 1].x + 2 * sp[i].x + sp[i + 1].x) * 0.25; sp[i].z = (sp[i - 1].z + 2 * sp[i].z + sp[i + 1].z) * 0.25; }
    }
  }
  const cum = new Float32Array(sp.length);
  for (let i = 1; i < sp.length; i++) cum[i] = cum[i - 1] + Math.hypot(sp[i].x - sp[i - 1].x, sp[i].z - sp[i - 1].z);
  // climbs: runs of steep samples (merged across small gaps), padded, flown as one hop arc
  const climbs = [];
  let run = null;
  for (let i = 1; i < sp.length; i++) {
    const dh = cum[i] - cum[i - 1], dy = sp[i].y - sp[i - 1].y;
    if (Math.abs(dy) > 0.004 && Math.abs(dy) > 0.3 * dh) {
      if (run && cum[i - 1] - run.b < 0.35) run.b = cum[i]; else climbs.push((run = { a: cum[i - 1], b: cum[i] }));
    }
  }
  const len = cum[sp.length - 1];
  const P = { pts: sp, cum, len, climbs: [] };
  const hops = [];
  for (const r of climbs) {   // (P.climbs is still empty here, so pathAt gives plain ground heights)
    const s0 = Math.max(0, r.a - 0.3), s1 = Math.min(len, r.b + 0.25);
    pathAt(P, s0, _v); const y0 = _v.y;
    pathAt(P, s1, _v); const y1 = _v.y;
    hops.push({ s0, s1, y0, y1, h: 0.34 + 0.3 * Math.abs(y1 - y0) });
  }
  P.climbs = hops;
  return P;
}
// 【弧长取样】→ 把弧长 s 处的地面点写入 out(dir 给平面方向);
// 若 s 落在爬升段内,返回离地面线的跳跃高度(out.y 此时是两端的直线连线),否则返回 null。
// → the ground point at arc length s in `out` (and the plan direction in `dir`); returns the hop height above the
// ground line when s is inside a climb (out.y is then the straight line between the climb's ends), else null
function pathAt(P, s, out, dir) {
  const c = P.cum, n = c.length;
  s = Math.max(0, Math.min(P.len, s));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const u = (s - c[lo]) / Math.max(1e-6, c[hi] - c[lo]);
  out.lerpVectors(P.pts[lo], P.pts[hi], u);
  if (dir) {
    const a = P.pts[Math.max(0, lo - 1)], b = P.pts[Math.min(n - 1, hi + 1)];
    dir.set(b.x - a.x, 0, b.z - a.z);
    if (dir.lengthSq() < 1e-10) dir.set(0, 0, 1); else dir.normalize();
  }
  for (const C of P.climbs) {
    if (s > C.s0 && s < C.s1) {
      const x = (s - C.s0) / (C.s1 - C.s0);
      out.y = lerp(C.y0, C.y1, x);
      return 4 * C.h * x * (1 - x);
    }
  }
  return null;
}

// ================================================================================================
// 【材质区】展台鼓身、接触阴影、星芒、合成 pass 四种自定义材质。
// ================================================================================================ materials
// 【鼓身材质】深紫清漆塑料(roughness 0.36 + clearcoat 0.85);onBeforeCompile 注入 aGlow 属性:
// 顶点把灯槽光晕权重传成 varying,片元把 uGlow(队伍色)按权重加进自发光——灯槽随队色点亮。
// customProgramCacheKey 固定,防止 three 因源码相同而缓存错程序。
function makeBodyMaterial(glowUniform) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x38306a, roughness: 0.36, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.16, vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = glowUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlow;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * vGlow;');
  };
  m.customProgramCacheKey = () => 'iw-showcase-drum';
  return m;
}

// 【实例透明度顶点着色器】通用模板:把 instanceColor.r 借作逐实例透明度(接触阴影的 alpha)。
const INSTANCE_ALPHA_VS = /* glsl */`
  varying vec2 vUv; varying float vA;
  void main() {
    vUv = uv; vA = 1.0;
    #ifdef USE_INSTANCING_COLOR
      vA = instanceColor.r;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

// 【接触阴影材质】脚底软阴影:UV 径向衰减的暗色圆片,借 instanceColor.r 作逐实例 alpha,
// polygonOffset 防与地面闪面;不写入深度。
function makeContactMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.018, 0.012, 0.04) } },
    vertexShader: INSTANCE_ALPHA_VS,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying vec2 vUv; varying float vA;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.0, 1.0, r);
        a = a * a * (0.45 + 0.55 * a) * vA;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
  });
}

// 【星芒材质】广告牌式闪光片:顶点阶段只取实例矩阵的平移(相机朝向)与 X 轴长度(尺寸),
// 片元拼出亮核 + 十字射线 + 微光晕;instanceColor 给颜色。
function makeSparkMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vCol;
      void main() {
        vUv = uv; vCol = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        mv.xy += position.xy * length(instanceMatrix[0].xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec3 vCol;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float core = exp(-r * r * 26.0);
        float rays = exp(-abs(p.y) * 30.0) * pow(max(0.0, 1.0 - abs(p.x)), 2.0) + exp(-abs(p.x) * 30.0) * pow(max(0.0, 1.0 - abs(p.y)), 2.0);
        float halo = exp(-r * r * 5.0) * 0.18;
        float a = clamp(core * 1.3 + rays * 0.9 + halo, 0.0, 1.0);
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol * (1.2 + 3.0 * core), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
}

// 【合成材质】把 MSAA 解析后的 HDR 舞台帧反预乘 → 色调映射 + sRGB 编码(与直绘画布同一套数学,
// three 会往默认帧缓冲注入 toneMapping 与 linearToOutputTexel)→ 轻微增饱和 → 抖动去色带 →
// 预乘后叠到成品帧(混合:src*1 + dst*(1-a))。uOpacity 控制整体淡入淡出。
// Composite: un-premultiply the MSAA-resolved HDR stage, tone map + sRGB encode exactly like a direct canvas draw
// (three injects toneMapping()/linearToOutputTexel for the default framebuffer), then premultiplied-over the frame.
function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null }, uOpacity: { value: 1 }, uSat: { value: 1.06 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tMap; uniform float uOpacity; uniform float uSat; varying vec2 vUv;
      void main() {
        vec4 t = texture2D(tMap, vUv);
        float a = clamp(t.a, 0.0, 1.0) * uOpacity;
        if (a < 0.002) discard;
        vec3 c = max(t.rgb, 0.0) / max(t.a, 1e-4);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(l), c, uSat), 0.0);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        gl_FragColor.rgb = clamp(gl_FragColor.rgb + (n - 0.5) / 255.0, 0.0, 1.0);
        gl_FragColor = vec4(gl_FragColor.rgb * a, a);
      }`,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    depthTest: false, depthWrite: false, transparent: true,
  });
}

// 【灯光预设】三种摄影棚布光(loadout 装备 / win 胜 / lose 败):
// key 主光、rimA/B 双轮廓光、fill 补光、hemi 半球光、env 环境强度、glow 灯槽光晕强度。
// 方向相对舞台焦点,相机坐在 +Z。(联机后巷由 LobbySet 自带灯光,这些照不到它。)
// Studio light rigs per overlay mood. Directions are relative to the stage focus; the camera sits on +Z. (The lobby set
// is lit by its own lights in a scene of its own: none of these reach it.)
const MOODS = {
  loadout: { key: 2.75, keyCol: 0xfff0de, rimA: 3.4, rimB: 1.9, fill: 0.5, hemi: 0.8, sky: 0xdce8ff, ground: 0x2c2442, env: 0.6, glow: 2.2 },
  win: { key: 2.9, keyCol: 0xfff1dc, rimA: 3.6, rimB: 2.0, fill: 0.55, hemi: 0.85, sky: 0xdfe9ff, ground: 0x2e2644, env: 0.62, glow: 2.3 },
  lose: { key: 1.85, keyCol: 0xd9e2ff, rimA: 1.7, rimB: 2.5, fill: 0.36, hemi: 0.62, sky: 0xbfd0f4, ground: 0x1d1a30, env: 0.46, glow: 1.2 },
};

// ================================================================================================
// 【展示台主类】单例,由 boot 创建(this.showcase)。
// 【状态机】mode ∈ loadout | locker | results | hub | lobby | null;大厅/房间模式是 LobbySet 场景,
//   其余三种是叠加摄影棚模式。phase 记录单角色展台上的演出阶段
//   (emerge 破墨而出 → pose 站定 → hop 换武器跳 / dip 潜入换装)。
// 【要点】展台/奖台几何惰性构建(首次 show 时才建);_rt 是私有 MSAA HDR 目标(借不到合成器缓冲时用)。
// ================================================================================================ Showcase
export class Showcase {
  // 【构造】搭场景、相机、灯光、四个特效池、接触阴影实例、合成 pass 三角形;
  // stageL(装备展台)与 stageR(结算奖台)留空惰性构建;监听 resize 重置 UI 量取。
  constructor(renderer, CharacterClass) {
    this.r = renderer;
    this.CharacterClass = CharacterClass;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.05, 90);
    this.mode = null;
    this.chars = [];
    this.color = new THREE.Color(0xff8a14);
    this.won = true;
    this.t = 0; this.fadeIn = 0; this._out = 0; this._outDur = 0.2; this._lastMode = null;
    this.lob = null; this._ffFrame = false;
    this.spin = 0; this.spinVel = 0; this.sinceDrag = 99; this.drag = null;
    this.weapon = null; this.hopT = -99; this.hopWeapon = null; this.pop = null;
    this.ui = { panelR: -1, titleR: -1, titleB: -1, bandB: -1, s: null, W: 0, H: 0, next: 0, stamp: -1 };
    this.decks = [];
    this.rand = rng(0x5ca1ab);
    this._tgt = new THREE.Vector3(); this._clr = new THREE.Color(); this._dbs = new THREE.Vector2(); this._c = new THREE.Color();
    this._c2 = new THREE.Color(); this._pv = new THREE.Vector3();
    this._rt = null;
    this.emit = { spark: 0, bubble: 0 };

    this.fxRoot = new THREE.Group();
    this.scene.add(this.fxRoot);
    this._buildLights();
    this.glowU = { value: new THREE.Color() };
    this.inkMat = new THREE.MeshPhysicalMaterial({ color: this.color.clone(), roughness: 0.17, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.045, sheen: 0.3, sheenRoughness: 0.32, sheenColor: new THREE.Color(1, 1, 1) });
    this.bodyMat = makeBodyMaterial(this.glowU);
    this.fx = new InkFX(this.fxRoot, this.inkMat, this.rand);
    this.confetti = new Confetti(this.scene, this.rand);
    this.sparks = new Sparkles(this.fxRoot, makeSparkMaterial(), this.rand);
    // soft contact shadows under the feet (one instanced draw)
    this.contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), makeContactMaterial(), 8);
    this.contact.frustumCulled = false; this.contact.count = 0; this.contact.renderOrder = 1;
    for (let i = 0; i < 8; i++) { this.contact.setMatrixAt(i, ZERO_M); this.contact.setColorAt(i, this._c.setRGB(0, 0, 0)); }
    this.scene.add(this.contact);
    // composite pass
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.compMat = makeCompositeMaterial();
    this.compQuad = new THREE.Mesh(tri, this.compMat); this.compQuad.frustumCulled = false;
    this.compScene = new THREE.Scene(); this.compScene.add(this.compQuad);
    this.compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.stageL = null; this.stageR = null; // built lazily (first show)
    // locker: current look, an in-flight look change (+ one queued behind it), camera framing blend between modes
    this.style = null; this.look = null; this.lookNext = null; this.emT0 = 0; this.danceBack = -1;
    this.shotFrom = null; this.shotT = 9; this._shotA = {}; this._shotB = {};
    // portraits
    this._pq = []; this._pcache = new Map(); this._prt = null; this._prt8 = null; this._pbuf = null; this._pcam = null;
    this._bindDrag();
    addEventListener('resize', () => { this.ui.next = 0; });
  }

  // ---------------------------------------------------------------------------------------------- setup
  // 【布光】五灯摄影棚:key 主光(唯一投影光,2048 阴影贴图,大半径软边)、rimA/B 双轮廓光、
  // fill 补光、hemi 半球天光。方向光的 target 一并入场景,朝向才有意义。
  _buildLights() {
    const s = this.scene;
    const key = (this.key = new THREE.DirectionalLight(0xfff0de, 2.7));
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.012; key.shadow.radius = 3;
    this.rimA = new THREE.DirectionalLight(0xffffff, 3);
    this.rimB = new THREE.DirectionalLight(0xd4e8ff, 1.8);
    this.fill = new THREE.DirectionalLight(0xe3ecff, 0.5);
    this.hemi = new THREE.HemisphereLight(0xdce8ff, 0x2c2442, 0.8);
    for (const l of [key, this.rimA, this.rimB, this.fill]) s.add(l, l.target);
    s.add(this.hemi);
  }

  // 【指向布光】按心情预设(MOODS)把五盏灯对准焦点 focus;spread 缩放主光距离与阴影范围
  // (结果台比展台大,需要更大的阴影相机)。投影范围随 spread 扩 1.25 倍,深度覆盖 16×spread。
  _aimLights(focus, spread, mood) {
    const M = MOODS[mood];
    const f = focus;
    this.key.position.set(f.x - 3.4 * spread, f.y + 5.4 * spread, f.z + 4.6 * spread); this.key.target.position.copy(f);
    this.rimA.position.set(f.x + 3.8, f.y + 2.8, f.z - 4.4); this.rimA.target.position.copy(f);
    this.rimB.position.set(f.x - 4.4, f.y + 2.0, f.z - 3.6); this.rimB.target.position.copy(f);
    this.rimB.color.set(0xd4e8ff);
    this.fill.position.set(f.x + 4.6, f.y + 0.6, f.z + 3.8); this.fill.target.position.copy(f);
    const sc = this.key.shadow.camera, e = 1.25 * spread;
    sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 0.5; sc.far = 16 * spread; sc.updateProjectionMatrix();
    this.key.intensity = M.key; this.key.color.set(M.keyCol);
    this.rimB.intensity = M.rimB; this.fill.intensity = M.fill;
    this.hemi.intensity = M.hemi; this.hemi.color.set(M.sky); this.hemi.groundColor.set(M.ground);
    this.mood = M;
    this._tintLights();
  }

  // 【队色染光】rimA 轮廓光与灯槽光晕(uGlow)跟着墨色走:
  // 颜色先按最大通道归一化再向白拉 18%(保持色相不烧),灯槽光晕更淡、按 glow 强度缩放。
  // team-coloured rim + groove glow follow the ink colour
  _tintLights() {
    const M = this.mood || MOODS.loadout;
    const c = this._c.copy(this.color);
    const mx = Math.max(c.r, c.g, c.b, 1e-4);
    c.multiplyScalar(1 / mx).lerp(new THREE.Color(1, 1, 1), 0.18);
    this.rimA.color.copy(c); this.rimA.intensity = M.rimA;
    this.glowU.value.copy(this.color).multiplyScalar(1 / mx).lerp(this._c.setRGB(1, 1, 1), 0.3).multiplyScalar(M.glow);
  }

  // 【换色】更新墨材质颜色与 sheen、彩带调色板,并联动染灯光。
  _setColor(color) {
    this.color.copy(color);
    this.inkMat.color.copy(color);
    this.inkMat.sheenColor.copy(color).lerp(this._c.setRGB(1, 1, 1), 0.55);
    this.confetti.setColor(color);
    this._tintLights();
  }

  // 【装备展台】单鼓 + 墨衣(14 滴墨、随机种子固定),默认隐藏,show 时才亮起。
  _buildLoadoutStage() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(drumGeometry(PED.R, PED, 144), this.bodyMat);
    body.receiveShadow = true;
    const drips = makeDrips(11, 14, { w0: 0.036, w1: 0.07, L0: 0.05, L1: 0.3, longChance: 0.3 });
    const ink = new THREE.Mesh(inkCoatGeometry(PED.R, PED.bevel, drips, { T0: PED.ink, du: 0.02, duF: 0.0034, NB: 26, seed: 5, depth: 0.42 }), this.inkMat);
    ink.receiveShadow = true;
    group.add(body, ink);
    group.visible = false;
    this.scene.add(group);
    return { group, parts: [body, ink] };
  }

  // 【结算奖台】四个鼓座按 SLOTS 站位排开(中央最高),每座带自己的墨衣;
  // 墨滴只布置在朝相机的半圈(front 参数),看不见的一面省掉。
  _buildResultsStage() {
    const group = new THREE.Group();
    const drums = SLOTS.map((S, i) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(drumGeometry(S.R, DRUM, 112), this.bodyMat);
      body.receiveShadow = true;
      const drips = makeDrips(31 + i * 7, 8, { front: 1.35, w0: 0.034, w1: 0.064, L0: 0.05, L1: 0.26, longChance: 0.35 });
      const ink = new THREE.Mesh(inkCoatGeometry(S.R, DRUM.bevel, drips, { T0: DRUM.ink, du: 0.024, duF: 0.0042, NB: 22, seed: 9 + i, depth: 0.36 }), this.inkMat);
      ink.receiveShadow = true;
      g.add(body, ink);
      g.position.set(S.x, S.top, S.z);
      group.add(g);
      return g;
    });
    group.visible = false;
    this.scene.add(group);
    return { group, drums };
  }

  // 【拖拽旋转】展台模式(loadout/locker)下按住指针左右拖 = 转台;松手带惯性衰减,
  // 停稳 2.4 秒后慢慢转回正面最近的整圈。只在 UI 面板左侧区域起拖,不抢面板的点击。
  _bindDrag() {
    const el = document.getElementById('app');
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      if (!PEDESTAL.has(this.mode)) return;
      const edge = this.ui.s ? this.ui.s.panelR : innerWidth * 0.52;
      if (e.clientX > edge) { this.drag = { x: e.clientX, t: performance.now() }; this.spinVel = 0; }
    });
    addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const now = performance.now(), dx = e.clientX - d.x, dts = Math.max(0.008, (now - d.t) / 1000);
      this.spin += dx * 0.011;
      this.spinVel = lerp(this.spinVel, (dx * 0.011) / dts, 0.5);
      d.x = e.clientX; d.t = now;
      this.sinceDrag = 0;
    });
    addEventListener('pointerup', () => { this.drag = null; });
  }

  // ---------------------------------------------------------------------------------------------- lifecycle
  // 【清场】移除并销毁全部角色、清空四个特效池与接触阴影、藏起两套舞台、复位弹出缩放与甲板表。
  _clear() {
    for (const c of this.chars) { this.scene.remove(c.root); c.dispose?.(); }
    if (this._warmChar) { this.scene.remove(this._warmChar.root); this._warmChar.dispose?.(); this._warmChar = null; }
    this.chars = [];
    this.fx.clear(); this.confetti.clear(); this.sparks.clear();
    for (let i = 0; i < 8; i++) this.contact.setMatrixAt(i, ZERO_M);
    this.contact.count = 0; this.contact.instanceMatrix.needsUpdate = true;
    if (this.stageL) this.stageL.group.visible = false;
    if (this.stageR) this.stageR.group.visible = false;
    if (this.pop) { this.pop.scale.setScalar(1); this.pop = null; }
    this.decks.length = 0;
    this._out = 0;
  }

  // 【假动画输入】给预览角色喂的合成用输入状态:站定、着地、满墨、无敌。
  // 角色 update 只读它,以为「这就是一帧正常游戏」。
  _anim() {
    return { time: 0, speed: 0, localMove: { x: 0, z: 0 }, grounded: true, vy: 0, aimPitch: 0, firing: false, charge: 0, rolling: false, form: 'kid', wallNormal: new THREE.Vector3(0, 0, 1), ink: 1, lowInk: false, special: 0, invuln: false };
  }

  /** The saved player look (main.js keeps the profile; menus save to it) — the default for pedestal kids. */
  // 【存档外观】main.js 保管的玩家档案,展台角色的默认造型(无存档时给默认发型肤色)。
  _profileStyle() {
    const st = G.game?.profile?.style;
    return st && typeof st === 'object' ? { ...st } : { hair: 0, skin: 1 };
  }

  // 【三个入口】装备 / 更衣室 / 联机大厅,都是「单角色上台」模式,共用 _showPedestal。
  // 武器缺省时依次回落:当前武器 → 存档武器 → 射手。
  showLoadout(weapon, color, style) { this._showPedestal('loadout', weapon, color, style); }
  showLocker(style, color, weapon) { this._showPedestal('locker', weapon || this.weapon || G.game?.profile?.weapon || 'shooter', color, style); }
  /** Online hub (menus.js 'online'): your kid on the pedestal right of the create / join cards. */
  showHub(style, color, weapon) { this._showPedestal('hub', weapon || this.weapon || G.game?.profile?.weapon || 'shooter', color, style); }

  // 【上台状态机】三种开场:fresh(清场重建,角色从台底升起)、onStage(同一角色换模式,
  //   只融运镜)、resume(淡出中途又回来,取消淡出)。换装/换武器的差异留给后续 diff 触发小演出。
  _showPedestal(mode, weapon, color, style) {
    if (!color || !color.isColor) color = new THREE.Color(color || this.color);
    const look = style ? { ...style } : this._profileStyle();
    const onStage = PEDESTAL.has(this.mode) && this.chars.length;
    const resume = !onStage && this._out > 0 && PEDESTAL.has(this._lastMode) && this.chars.length;
    const fresh = !onStage && !resume;
    if (resume) this._out = 0;
    if (fresh) {
      this._clear();
      if (!this.stageL) this.stageL = this._buildLoadoutStage();
      const c = new this.CharacterClass({ color: color.clone(), weapon, style: { ...look }, name: 'preview', isLocal: false });
      c._a = this._anim(); c._a.grounded = false;
      c._y = -1.6; c.root.position.set(0, -1.6, 0);
      this.scene.add(c.root);
      this.chars.push(c);
      this.style = { ...look };
      this.look = null; this.lookNext = null; this.danceBack = -1;
      this.t = 0; this.fadeIn = 0; this.emT0 = 0;
      this.spin = 0; this.spinVel = 0; this.sinceDrag = 99;
      this.hopT = -99; this.hopWeapon = null;
      this.phase = 'emerge'; this.landT = -99; this.emerged = false;
      this.weapon = weapon;
      this.stageL.group.visible = true;
      this.ui.next = 0;
      this.shotFrom = null;
    } else if (this.mode !== mode) {
      // same kid, new framing: blend the camera from the old shot
      this.shotFrom = PEDESTAL.has(this.mode) ? this.mode : this._lastMode;
      this.shotT = 0;
      this.ui.next = 0; this.ui.stamp = -1;
    }
    this.mode = mode;
    this._lastMode = mode;
    this._aimLights(this._tgt.set(0, 0.8, 0), 1, 'loadout');
    this._setColor(color);
    const c = this.chars[0];
    c.setColor(color);
    if (!fresh) {
      if (weapon !== this.weapon) {
        // weapon change: hop + twirl, the new weapon materialises mid-air, splash on landing, camera punch
        this.weapon = weapon;
        this.hopWeapon = weapon;
        this.hopT = this.t;
        if (this.phase === 'pose') this.phase = 'hop';
      }
      if (style && !sameStyle(look, (this.look && this.look.style) || this.style)) this.setStyle(look, 'swap');
    }
  }

  /** Change the pedestal kid's look with a reaction. cause: 'hair' | 'eyes' | 'skin' | 'outfit' | 'preset' | 'random'. */
  // 【换装请求】cause 决定演出:发色/眼睛/肤色/衣服 → pop(蹲缩 → 满蹲瞬间换 → 拉伸跳+旋转);
  //   预设/随机 → dip(跳起变乌贼扎进墨里,新造型破墨而出)。
  // 【排队】进行中未过换装点的请求直接改目标;进行中已过点、或正在别的演出时,挂到 lookNext 队列。
  setStyle(style, cause = 'swap') {
    const look = { ...style };
    if (!PEDESTAL.has(this.mode) || !this.chars.length) { this.style = look; return; }
    const want = (this.lookNext && this.lookNext.style) || (this.look && this.look.style) || this.style;
    if (sameStyle(look, want)) return;
    const kind = cause === 'preset' || cause === 'random' ? 'dip' : 'pop';
    const L = this.look;
    // still before the swap point of the running change → just retarget it
    if (L && !L.swapped) { L.style = look; if (kind === 'dip' && L.kind === 'pop') { L.kind = 'dip'; } L.cause = cause; return; }
    if (L || this.phase !== 'pose') { this.lookNext = { style: look, cause, kind }; return; }
    this._startLook(look, cause, kind);
  }

  // 【开演】旋转量只取整圈(起点即终点,无需回卷):衣服正转、头发反转,其余不转。
  _startLook(style, cause, kind) {
    // full turns only (they end where they started, so nothing has to unwind): outfit spins one way, hair the other
    const spin = cause === 'outfit' ? TAU : cause === 'hair' ? -TAU : 0;
    this.look = { style, cause, kind, t0: this.t, swapped: false, landed: false, spin, dove: false };
    this.danceBack = -1;
    if (kind === 'dip') { this.phase = 'dip'; this.chars[0].trigger('jump'); }
  }

  // 【离屏热身——防 T-pose 的关键】新角色先进场景、继承旧角色的位置/姿态/舞蹈,
  // 然后离屏连跑 warm/n 帧(默认 0.8 s、16 帧)把骨骼、弹簧与舞蹈相位推进到「已经在动」,
  // 再替换上台——观众看到的第一帧就是动态姿势,而不是绑定的 T-pose。
  /** Replace the pedestal kid with one wearing `style` (pre-warmed off-screen so it appears mid-pose, not T-posed). */
  _swapChar(style, dance = 'lobby_pose') {
    const old = this.chars[0];
    const c = new this.CharacterClass({ color: this.color.clone(), weapon: this.weapon || 'shooter', style: { ...style }, name: 'preview', isLocal: false });
    c._a = old ? old._a : this._anim();
    if (old) { c.root.position.copy(old.root.position); c.root.rotation.copy(old.root.rotation); c.root.scale.copy(old.root.scale); }
    if (dance) {
      c.setDance(dance);
      const warm = 0.8, n = 16;
      c.danceT = Math.max(0, (old && old.dance === dance ? old.danceT : warm) - warm);
      const a = c._a, g = a.grounded;
      for (let i = 0; i < n; i++) { a.time += warm / n; c.update(warm / n, a); }
      a.grounded = g;
    }
    if (old) { this.scene.remove(old.root); old.dispose?.(); }
    this.scene.add(c.root);
    this.chars[0] = c;
    this.style = { ...style };
    return c;
  }

  // 【结算上台】清场 → 亮奖台 → 按 SLOTS 摆人(最多 4 个):
  // 胜方按 0.46+0.13i 的节拍从 3 m 高空依次砸落(落地水花 + 胜利舞 + 余振);
  // 败方随鼓座升起,已是 slump(颓废舞),并预先错开相位免得四人同步摆动。
  showResults(team, won, color, styles) {
    this._clear();
    if (!this.stageR) this.stageR = this._buildResultsStage();
    this.mode = 'results';
    this._lastMode = 'results';
    this.won = !!won;
    this.t = 0; this.fadeIn = 0;
    this._setColor(color);
    this.stageR.group.visible = true;
    const n = Math.min(styles.length, SLOTS.length);
    this.slots = SLOTS.slice(0, Math.max(1, n));
    this.stageR.drums.forEach((d, i) => { d.visible = i < this.slots.length; d.position.y = -9; });
    for (let i = 0; i < n; i++) {
      const st = styles[i], S = SLOTS[i];
      const c = new this.CharacterClass({ color: color.clone(), weapon: st.weapon, style: st.style, name: st.name, isLocal: false });
      c._a = this._anim();
      c._slot = S;
      c._land = this.won ? 0.46 + i * 0.13 + (i === 3 ? 0.05 : 0) : -1;
      c._landed = !this.won;
      c.root.rotation.y = S.yaw;
      c.root.visible = !this.won;
      if (!this.won) {
        c.setDance('defeat');
        for (let k = 0; k < i * 7 + 3; k++) c.update(0.1, c._a); // desync the slump cycles
      }
      this.scene.add(c.root);
      this.chars.push(c);
    }
    this.events = { cannon: 0, bombs: 0 };
    this._aimLights(this._tgt.set(0.55, 1.25, 0), 2.6, this.won ? 'win' : 'lose');
    this.ui.next = 0;
  }

  // 【隐藏】摄影棚叠加模式:先 0.2 s 淡出再清场;联机后巷自己会在 _updateSet 里溶解,不用管。
  hide() {
    if (!this.mode) return;
    // studio overlays: a quick fade-out, then _clear(); the lobby set dissolves away on its own (_updateSet)
    if (OVERLAY.has(this.mode) && this.chars.length) { this._lastMode = this.mode; this._out = this._outDur = 0.2; }
    this.mode = null;
  }

  // 【销毁】整台拆除:清场、释放两套舞台几何、释放联机后巷、销毁私有渲染目标。
  dispose() {
    this.mode = null; this._clear();
    for (const st of [this.stageL, this.stageR]) {
      if (!st) continue;
      st.group.traverse((o) => o.geometry?.dispose());
      this.scene.remove(st.group);
    }
    this.stageL = this.stageR = null;
    this._lobRelease();
    this._rt?.dispose(); this._rt = null;
  }

  // ---------------------------------------------------------------------------------------------- update
  // 【主更新】每帧先跑联机后巷,再按模式分发:展台模式走 _updateLoadout,结算走 _updateResults;
  // 淡出中(_out>0)沿用上一模式继续演。dt 封顶 0.1 s,防卡顿后跳变。
  update(dt) {
    dt = Math.min(dt || 0, 0.1);
    this._ffFrame = this.fullFrame;   // what main.js saw at the top of this frame (it didn't draw the world if true)
    // 手机菜单不抢跑整套隐藏展台预热，真正打开装备/大厅时仍按原入口创建所需内容。
    if (!window.inkwaveMobile && !this._warmState && G.env) this._warmup();
    this._updateSet(dt);
    let mode = OVERLAY.has(this.mode) ? this.mode : null;
    if (!mode && this._out > 0) {
      this._out -= dt;
      if (this._out <= 0) { this._clear(); return; }
      mode = this._lastMode;
    }
    if (!mode || !this.chars.length) return;
    this.t += dt;
    this.shotT += dt;
    this.fadeIn = Math.min(1, this.fadeIn + dt / 0.25);
    if (PEDESTAL.has(mode)) this._updateLoadout(dt);
    else this._updateResults(dt);
    this.fx.update(dt, this.decks);
    this.confetti.update(dt, this.decks);
    this.sparks.update(dt);
    this.contact.instanceMatrix.needsUpdate = true;
    if (this.contact.instanceColor) this.contact.instanceColor.needsUpdate = true;
  }

  _contactAt(i, x, y, z, size, alpha) {
    _m4.makeScale(size, 1, size).setPosition(x, y, z);
    this.contact.setMatrixAt(i, _m4);
    this.contact.setColorAt(i, this._c.setRGB(alpha, 0, 0));
    if (this.contact.count < i + 1) this.contact.count = i + 1;
  }

  // 【展台演出】每帧推进:展台升起(回弹出缓)→ 转台(拖拽/手柄 + 惯性 + 慢摇摆回正)→
  // 角色编排(下方按 phase 状态机)→ 特效与接触阴影。甲板表 decks[0] 是台面圆(供墨滴落地判定)。
  _updateLoadout(dt) {
    const t = this.t, st = this.stageL, rnd = this.rand;
    // pedestal rises in
    const stageY = -0.95 * (1 - backOut(t / 0.6, 1.25));
    st.group.position.y = stageY;
    const deckY = stageY + PED.ink;
    // turntable: user drag + momentum; otherwise a slow sway that drifts home
    const rx = PEDESTAL.has(this.mode) && G.input?.padAxis ? G.input.padAxis(2) : 0;
    if (Math.abs(rx) > 0.25) { this.spinVel = lerp(this.spinVel, rx * 3.4, 1 - Math.exp(-10 * dt)); this.sinceDrag = 0; }
    if (!this.drag) {
      this.spin += this.spinVel * dt;
      this.spinVel *= Math.exp(-3.4 * dt);
      this.sinceDrag += dt;
      if (this.sinceDrag > 2.4 && Math.abs(this.spinVel) < 0.35) this.spin = damp(this.spin, Math.round(this.spin / TAU) * TAU, 1.1, dt);
    }
    const sway = 0.17 * Math.sin((t - 1.6) * 0.5) * sstep(1.6, 4, t);
    const yawStage = this.spin + sway;
    st.group.rotation.y = yawStage;
    this.fxRoot.rotation.y = yawStage;
    this.fxRoot.position.y = stageY;
    this.decks.length = 1;
    const dk = this.decks[0] || (this.decks[0] = { x: 0, z: 0, r: 0, y: 0 });
    dk.x = 0; dk.z = 0; dk.r = PED.R - 0.035; dk.y = PED.ink;

    // 【角色编排】phase 状态机,四种阶段:
    // · dip    换装(预设/随机):预蹲 → 抛物下潜变乌贼扎进墨中 → _swapChar 换新 → 转 emerge
    // · emerge 破墨而出:从台内弹道跃起,拉伸上行、落地压扁回弹,落定进 pose
    // · hop    换武器:小跳 + 整周转,新武器在跳到 12% 时凭空弹出(pop 缩放),落地带水花
    // · pose   站定:余振衰减;pop 类换装(发色等)在满蹲瞬间换人,接拉伸跳与整圈旋转
    // 所有跳跃共用「挤压-拉伸」语言:上行拉 sy>1、下落压 sy<1、落地 wobble 余振。
    // character choreography
    let c = this.chars[0];
    let y = 0, sy = 1, twirl = 0, air = false, vy = 0;
    const L = this.look;
    if (this.phase === 'dip') {
      // costume change: hop, turn squid at the apex and dive into the pedestal ink; the new look bursts back out
      const tl = t - L.t0, ant = 0.09, T = 0.4, H = 0.22, y1 = -1.5;
      if (tl < ant) { sy = 1 - 0.12 * Math.sin((Math.PI * 0.5 * tl) / ant); }
      else {
        const x = Math.min(1, (tl - ant) / T);
        // ballistic from 0 through apex H down to y1 at x = 1
        const b = 2 * H + 2 * Math.sqrt(H * H - H * y1), a = y1 - b; // y(x) = a x² + b x: apex H, y(1) = y1
        y = a * x * x + b * x; vy = (2 * a * x + b) / T; air = true;
        twirl = 1.2 * eInOut(x);
        c._a.form = x > 0.3 ? 'squid' : 'kid';
        sy = 1 + 0.12 * c01(vy / 3) - 0.06 * c01(-vy / 6);
        if (!L.dove && y < 0 && vy < 0) {
          L.dove = true;
          this.fx.crown(0, PED.ink, 0, 1.1, 22, 0.22);
          this.fx.ripple(0, PED.ink, 0, 0.1, 0.7, 0.7);
          G.audio?.play?.('squid_in', { volume: 0.7 });
        }
        if (x >= 1) {
          c = this._swapChar(L.style, null);
          c._a.form = 'kid'; c._a.grounded = false;
          L.swapped = true;
          this.phase = 'emerge'; this.emT0 = t - 0.02; this.emerged = false;
          y = y1; air = true; twirl = 0;
        }
      }
    }
    if (this.phase === 'emerge') {
      // bursts out of the ink: ballistic from inside the pedestal, stretched on the way up, squash on landing
      const t0 = 0.12, y0 = -1.45, tp = 0.4, peak = 0.3;
      const g = (2 * (peak - y0)) / (tp * tp), v0 = g * tp;
      const te = t - this.emT0 - t0;
      if (te < 0) { y = y0; air = true; }
      else {
        y = y0 + v0 * te - 0.5 * g * te * te;
        vy = v0 - g * te;
        air = true;
        if (!this.emerged && y > 0) {
          this.emerged = true; this.fx.crown(0, PED.ink, 0, 1.25, 26, 0.24); c.trigger('jump');
          if (L) G.audio?.play?.('squid_out', { volume: 0.7 });
        }
        if (te > tp && y <= 0) {
          y = 0; air = false; this.phase = 'pose'; this.landT = t;
          c.trigger('land', 7);
          this.fx.crown(0, PED.ink, 0, 0.7, 16, 0.3);
          if (L && L.kind === 'dip') {
            // new look lands: a short celebration before settling back into the lobby stance
            c.setDance('victory'); this.danceBack = t + 1.7;
            this._sparkleBurst(14);
            this.look = null;
          } else c.setDance('lobby_pose');
        }
        sy = 1 + 0.16 * c01(vy / 7);
      }
      twirl = -0.6 * (1 - eOut3(c01(te / 0.55)));
    } else if (this.phase === 'hop') {
      const tw = t - this.hopT, ant = 0.075, T = 0.46, H = 0.3;
      if (tw < ant) { sy = 1 - 0.1 * Math.sin((Math.PI * 0.5 * tw) / ant); }
      else if (tw < ant + T) {
        const x = (tw - ant) / T;
        y = 4 * H * x * (1 - x); vy = (4 * H * (1 - 2 * x)) / T; air = true;
        twirl = TAU * eInOut(x);
        sy = 1 + 0.12 * c01(vy / 3) - 0.04 * c01(-vy / 3);
        if (this.hopWeapon && x > 0.12) {
          if (this.pop) this.pop.scale.setScalar(1);
          c.setWeapon(this.hopWeapon);
          this.pop = c.weapon?.pivot || null;
          if (this.pop) { this.pop.scale.setScalar(0.001); this.popT = t; }
          this.hopWeapon = null;
          c.setDance(null); c.trigger('jump');
        }
      } else {
        this.phase = 'pose'; this.landT = t;
        c.trigger('land', 6); c.setDance('lobby_pose');
        this.fx.crown(0, PED.ink, 0, 1.0, 22, 0.26);
      }
    }
    if (this.phase === 'pose') {
      const tl = t - this.landT;
      sy = 1 - 0.13 * wobble(tl, 15, 6.5);
      // look change: squash (anticipation) → swap at full squash under an ink pop → stretch hop with a twirl → settle
      if (L && L.kind === 'pop') {
        const lt = t - L.t0, ant = 0.085, T = 0.34, H = L.cause === 'outfit' ? 0.2 : 0.13;
        if (lt < ant) { sy *= 1 - 0.15 * Math.sin((Math.PI * 0.5 * lt) / ant); y -= 0.015 * (lt / ant); }
        else {
          if (!L.swapped) {
            c = this._swapChar(L.style);
            L.swapped = true;
            c.trigger('jump');
            this.fx.crown(0, PED.ink, 0, 0.85, 18, 0.3);
            this._sparkleBurst(L.cause === 'eyes' ? 6 : 9);
          }
          const x = (lt - ant) / T;
          if (x < 1) {
            y += 4 * H * x * (1 - x); vy = (4 * H * (1 - 2 * x)) / T; air = true;
            twirl += L.spin * eInOut(x);
            sy = 1 + 0.1 * c01(vy / 2.2) - 0.05 * c01(-vy / 2.2);
          } else {
            if (!L.landed) {
              L.landed = true; c.trigger('land', L.cause === 'outfit' ? 6 : 4.5); this.landT = t; this.fx.crown(0, PED.ink, 0, 0.5, 10, 0.3);
              // look-specific flourish (no-ops until the animation stream adds them — see docs/HALYARD.md requests)
              c.trigger(L.cause === 'outfit' ? 'admire' : L.cause === 'hair' ? 'hairflip' : 'wink');
            }
            if (x > 1.35) this.look = null;
          }
        }
      }
      if (!this.look && this.lookNext) { const n = this.lookNext; this.lookNext = null; this._startLook(n.style, n.cause, n.kind); }
      if (this.danceBack > 0 && t > this.danceBack) { this.danceBack = -1; c.setDance('lobby_pose'); }
    }
    if (this.pop) {
      const k = backOut((t - this.popT) / 0.34, 2.4);
      this.pop.scale.setScalar(Math.max(0.001, k));
      if (t - this.popT > 0.34) { this.pop.scale.setScalar(1); this.pop = null; }
    }
    const a = c._a;
    a.time = G.time;
    a.grounded = !air; a.vy = vy;
    const sxz = 1 / Math.sqrt(sy);
    c.root.position.set(0, stageY + PED.ink * 0.5 + y, 0);
    c.root.scale.set(sxz, sy, sxz);
    c.root.rotation.y = -0.45 + yawStage + twirl;
    c.update(dt, a);
    // contact shadow
    const hgt = Math.max(0, y);
    this._contactAt(0, 0, deckY + 0.004, 0, 0.78 * (1 + hgt * 0.8), y < -0.05 ? 0 : 0.8 * (1 - c01(hgt / 1.1) * 0.75));

    // idle life: a few ink bubbles drifting up off the pedestal, glints around the kid
    if (t > 1.2) {
      this.emit.bubble += dt * 0.85;
      while (this.emit.bubble >= 1) {
        this.emit.bubble -= 1;
        const ang = rnd() * TAU, rr = 0.36 + rnd() * 0.34;
        this.fx.bubble(Math.sin(ang) * rr, PED.ink + 0.01, Math.cos(ang) * rr, 0.009 + rnd() * 0.016, 0.16 + rnd() * 0.16, 3 + rnd() * 3);
      }
      this.emit.spark += dt * 2.0;
      while (this.emit.spark >= 1) {
        this.emit.spark -= 1;
        const ang = rnd() * TAU, rr = 0.38 + rnd() * 0.5;
        const col = rnd() < 0.3 ? this._c.copy(this.color).lerp(_c1.setRGB(1, 1, 1), 0.45) : this._c.setRGB(1, 0.97, 0.9);
        this.sparks.spawn(Math.sin(ang) * rr, 0.25 + rnd() * 1.55, Math.cos(ang) * rr, 0.05 + rnd() * 0.07, col, 0.7 + rnd() * 0.7);
      }
    }
  }

  // a ring of glints around the kid (look changes)
  _sparkleBurst(n) {
    const rnd = this.rand;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd() * 0.5, rr = 0.34 + rnd() * 0.28;
      const col = rnd() < 0.45 ? this._c.copy(this.color).lerp(_c1.setRGB(1, 1, 1), 0.35) : this._c.setRGB(1, 0.96, 0.84);
      this.sparks.spawn(Math.sin(ang) * rr, 0.35 + rnd() * 1.35, Math.cos(ang) * rr, 0.08 + rnd() * 0.08, col, 0.45 + rnd() * 0.4);
    }
  }

  // 【结算演出】鼓座从 UI 横带下升起(中央先行,每台错 0.04 s);
  // 胜:礼炮两连 + 彩带雨(30→5 渐稀)+ 场外墨弹按计划表抛物落台 + 金白闪点;
  // 败:慢速墨雨敲台。两种情况鼓面都冒气泡。
  _updateResults(dt) {
    const t = this.t, rnd = this.rand, won = this.won;
    const slots = this.slots;
    // drums rise from under the UI band, centre first
    this.decks.length = slots.length;
    for (let i = 0; i < slots.length; i++) {
      const S = slots[i], d = this.stageR.drums[i];
      const k = backOut((t - 0.04 * i) / 0.72, 1.15);
      d.position.set(S.x, S.top - 2.4 * (1 - k), S.z);
      const dk = this.decks[i] || (this.decks[i] = { x: 0, z: 0, r: 0, y: 0 });
      dk.x = S.x; dk.z = S.z; dk.r = S.R - 0.04; dk.y = d.position.y + DRUM.ink;
    }
    // squidkids: winners drop in one by one and splash down; losers ride the drums up, already slumped
    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i], S = c._slot, a = c._a, dk = this.decks[i];
      a.time = G.time;
      let y = dk.y - DRUM.ink * 0.5, sy = 1, air = false, vy = 0;
      if (won) {
        const T = 0.5, H = 3.1, g = (2 * H) / (T * T);
        const tf = t - (c._land - T);
        if (tf < 0) { c.root.visible = false; }
        else if (tf < T) {
          c.root.visible = true; air = true;
          y += H - 0.5 * g * tf * tf; vy = -g * tf;
          sy = 1 + 0.1 * c01(-vy / 12);
        } else {
          c.root.visible = true;
          if (!c._landed) {
            c._landed = true;
            c.trigger('land', 9); c.setDance('victory');
            this.fx.crown(S.x, dk.y, S.z, i === 0 ? 1.15 : 0.95, i === 0 ? 24 : 16, 0.24);
          }
          sy = 1 - 0.15 * wobble(t - c._land, 14, 6);
        }
      }
      a.grounded = !air; a.vy = vy;
      const sxz = 1 / Math.sqrt(sy);
      c.root.position.set(S.x, y, S.z);
      c.root.scale.set(sxz, sy, sxz);
      c.update(dt, a);
      const hgt = Math.max(0, y - dk.y);
      this._contactAt(i, S.x, dk.y + 0.004, S.z, 0.74 * (1 + hgt * 0.35), c.root.visible ? 0.78 * (1 - c01(hgt / 2.5) * 0.85) : 0);
    }
    if (won) {
      // confetti cannons from both wings + a rain that tapers to a gentle trickle
      const ev = this.events;
      if (ev.cannon === 0 && t > 0.98) { ev.cannon = 1; this.confetti.burst(-3.3, 0.1, 0.8, 0.42, 1, -0.12, 95, 8.8, 0.7); this.confetti.burst(4.3, 0.1, 0.8, -0.42, 1, -0.12, 95, 8.8, 0.7); }
      if (ev.cannon === 1 && t > 1.3) { ev.cannon = 2; this.confetti.burst(-3.0, 0.2, 0.6, 0.3, 1, -0.1, 45, 7.2, 0.8); this.confetti.burst(4.0, 0.2, 0.6, -0.3, 1, -0.1, 45, 7.2, 0.8); }
      if (t > 0.9) this.confetti.rain(dt, lerp(30, 5, sstep(1.5, 7, t)), -2.9, 4.0, -1.1, 1.0, 3.9);
      // glossy ink bombs arc in from off-stage and splat on the drums
      const plan = [[1.05, 0, -1], [1.3, 2, 1], [1.62, 1, -1], [2.0, 3, 1], [3.6, 0, 1], [5.2, 2, -1], [6.9, 1, 1]];
      while (ev.bombs < plan.length && t > plan[ev.bombs][0]) {
        const [, di, side] = plan[ev.bombs++];
        if (di >= slots.length) continue;
        const S = slots[di], ang = rnd() * TAU, rr = S.R * (0.5 + rnd() * 0.3);
        const tx = S.x + Math.sin(ang) * rr, tz = S.z + Math.cos(ang) * rr * 0.6 - 0.1, ty = this.decks[di].y;
        const sx = tx + side * (2.4 + rnd()), sy2 = ty - 1.2, sz = tz - 2.2, T = 0.78, g = 9.5;
        this.fx.drop(sx, sy2, sz, (tx - sx) / T, (ty - sy2) / T + 0.5 * g * T, (tz - sz) / T, 0.05 + rnd() * 0.025, 2, 3);
      }
      // gold/white glints over the team
      this.emit.spark += dt * (t < 3 ? 7 : 3.5);
      while (this.emit.spark >= 1) {
        this.emit.spark -= 1;
        const col = rnd() < 0.5 ? this._c.setRGB(1, 0.84, 0.45) : rnd() < 0.5 ? this._c.setRGB(1, 1, 1) : this._c.copy(this.color).lerp(_c1.setRGB(1, 1, 1), 0.5);
        const i = (rnd() * slots.length) | 0, S = slots[i];
        this.sparks.spawn(S.x + (rnd() - 0.5) * 1.3, S.top + 0.3 + rnd() * 2.0, S.z + (rnd() - 0.5) * 0.8, 0.07 + rnd() * 0.08, col, 0.6 + rnd() * 0.7);
      }
    } else if (t > 1.0) {
      // defeat: a light, slow ink drizzle pattering on the podium
      this.emit.spark += dt * 2.4;
      while (this.emit.spark >= 1) {
        this.emit.spark -= 1;
        this.fx.drop(-2.4 + rnd() * 5.6, 3.6 + rnd() * 0.8, -0.8 + rnd() * 1.4, 0, -2.5, 0, 0.013 + rnd() * 0.012, 4, 3);
      }
    }
    // bubbles off the drum tops (both moods)
    if (t > 1.5) {
      this.emit.bubble += dt * (won ? 1.1 : 0.7);
      while (this.emit.bubble >= 1) {
        this.emit.bubble -= 1;
        const i = (rnd() * slots.length) | 0, S = slots[i], ang = rnd() * TAU, rr = S.R * (0.45 + rnd() * 0.45);
        this.fx.bubble(S.x + Math.sin(ang) * rr, this.decks[i].y + 0.01, S.z + Math.cos(ang) * rr, 0.01 + rnd() * 0.016, 0.16 + rnd() * 0.18, 2.5 + rnd() * 3);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- lobby set (hub + room)
  // 【联机后巷(hub + room)】两套联机界面都在 LobbySet(lobbySet.js,蓝调时刻的一条后巷)里上演:
  // 它有自己的场景、灯光与相机,全屏绘制——fullFrame 为 true 时 main.js 既不画也不模拟世界;
  // 淡入淡出(SET_FADE 0.45 s)期间需要底下的实时世界,故 fullFrame 为 false。
  // 【成员行为】每人一个 member;新成员沿 set.lanes 低姿游入(湿墨尾迹), rivals 要上码头台阶,
  // 到点后海豚弧跃出变人、砸落转向镜头;离开则转身潜入墨中游向 set.exitPath;换队即 mark→mark 游过去。
  // 【进出房间】开房:你在 hub 位潜入墨中、从站位的水洼破墨而出,镜头后拉成整队(已在房的人跟着冒出);
  // 回房(更衣室/比赛归来):全员已站好;离房:其他人潜走,你游回 hub 位。
  // showHub(style, color, weapon) · showLobby(players, colors[, opts]) · updateLobby(players, colors) · lobbyEmote(id,
  // name) · lobbyGetSet() · lobbyLaunch() → seconds · lobbyAnchor(id, out) · lobbySlotAnchor(row, i, out) · leaveLobby().
  // players = G.net.lobby.players (docs/NET.md), colors = [team 0, team 1] (hex / THREE.Color).
  //
  // Both online screens are staged in the LobbySet (src/game/lobbySet.js: a back alley at blue hour with its own
  // lights), in a scene of its own drawn full-frame: while it covers the screen `fullFrame` is true and main.js neither
  // draws nor simulates the world; it cross-dissolves with the world / the pedestal / the podium. One member per player
  // (the hub kid is you, and becomes your room member). Arrivals swim in from the alley mouth along set.lanes(mark) —
  // a low squid swim laying a wet ink trail, a hop up the dock stairs for the rivals' marks — then leap out as a kid,
  // splash down on the mark and turn to camera; leavers turn, dive and swim out along set.exitPath(mark); a team switch
  // swims mark → mark. Opening the room you duck into the ink at the hub spot and burst out of a puddle on your mark
  // while the camera pulls back to the line-up (whoever is already in the room surfaces right after you). Coming back to
  // the room (locker, a match) finds everyone standing there. Leaving it, the others duck away and you swim home.
  // 【全屏判定】后巷就绪、淡入完成且当前是联机模式时,main.js 可跳过世界绘制与模拟;
  // 淡入淡出期间返回 false——底下的活世界要露出来供溶解。
  /** True while the lobby set covers the whole frame: main.js may skip drawing (and simulating) the world. It is false
   *  during the set's cross-dissolves, which need the live world underneath (render() handles either case). */
  get fullFrame() {
    const L = this.lob;
    return !!(L && L.ready && L.k >= 1 && SET_MODES.has(this.mode));
  }

  // 【后台预载】主菜单空闲时(boot 之后)提前构建并编译后巷场景与着色器,
  // 让首次进入联机大厅直接落在后巷,而不是一边加载一边看竞技场。首次展示后该标记失效。
  // Build and compile the alley ahead of time (main.js calls this once the main menu is idle), so the first visit to
  // the online hub opens straight onto the set instead of the arena while it loads. Kept until it's first shown.
  preloadLobby() { if (!this.lob) this._lobEnsure().preload = true; }

  // 【后巷容器】惰性创建联机场景:两套墨材质(两支队伍)、十个接触阴影、
  // 两组墨特效(每队一组,颜色分开)、闪光、湿痕、成员表 members、淡入系数 k、镜头状态等。
  _lobEnsure() {
    if (this.lob) return this.lob;
    const scene = new THREE.Scene();
    const kids = new THREE.Group(), fxRoot = new THREE.Group();
    scene.add(kids, fxRoot);
    const ink = [this.inkMat.clone(), this.inkMat.clone()];
    const contact = new THREE.InstancedMesh(this.contact.geometry, this.contact.material, 10);
    contact.frustumCulled = false; contact.count = 0; contact.renderOrder = 1;
    for (let i = 0; i < 10; i++) { contact.setMatrixAt(i, ZERO_M); contact.setColorAt(i, this._c.setRGB(0, 0, 0)); }
    fxRoot.add(contact);
    const L = (this.lob = {
      scene, kids, fxRoot, ink, contact, cam: new THREE.PerspectiveCamera(30, 1, 0.08, 240),
      set: null, ready: false, failed: false, quality: null, k: 0, t: 0, gone: 0,
      fx: [new InkFX(fxRoot, ink[0], this.rand), new InkFX(fxRoot, ink[1], this.rand)],
      sparks: new Sparkles(fxRoot, makeSparkMaterial(), this.rand), trail: new InkTrail(fxRoot),
      members: new Map(), colors: [new THREE.Color(0xff8a14), new THREE.Color(0x2f5bff)], myTeam: null, room: false, initial: false,
      decks: [], fits: {}, shot: null, shotFrom: null, shotT: 9, cs: null, setT: -1, launchT: -1, seq: 0, nextIn: 0, reduced: false,
      kFront: 150, bg: new THREE.Color(0x0a0f1c), U: null,
    });
    this._lobLoad(L);
    return L;
  }

  // 【异步装载】lobbySet.js 动态 import,拿到场景后:按画质建 LobbySet → 等 ready →
  // 建甲板、染队色、放一个「暖场角色」(人形+乌贼形都在灯光下 update 一次)→
  // compileAsync 离线编译全部着色器 → 标记 ready。整条链路都在关键路径之外,首帧零卡顿。
  // The set module loads lazily; everything it will draw (the alley, a squidkid in both forms under its lights, the FX)
  // is compiled off the critical path before it may dissolve in, so its first frame never hitches.
  _lobLoad(L) {
    import('./lobbySet.js').then(async (mod) => {
      if (this.lob !== L) return;
      const q = G.settings?.quality || 'high';
      const buildDone = globalThis.inkwaveDiagnostics?.beginStage('lobby-scene-build');
      let set;
      try { set = new mod.LobbySet(this.r, { quality: q, texlib: G.game?.texlib || null }); }
      finally { buildDone?.(); }
      L.set = set; L.quality = q;
      L.scene.add(set.root);
      await set.ready;
      if (this.lob !== L) { set.dispose(); return; }
      this._lobDecks(L);
      this._lobColors();
      const warm = new this.CharacterClass({ color: L.colors[0].clone(), weapon: 'shooter', style: this._profileStyle(), name: 'warm', isLocal: false });
      warm.root.position.copy(set.hubSpot.pos);
      L.kids.add(warm.root);
      warm.update(1 / 30, this._anim());
      if (warm.kid) warm.kid.visible = true;
      if (warm.squidRoot) warm.squidRoot.visible = true;
      const C = set.camera;
      this._placeLook(L.cam, C.pos, C.target, C.fov, innerWidth / 2, innerHeight / 2, innerWidth, innerHeight);
      this._lobEnv(L);
      const compileDone = globalThis.inkwaveDiagnostics?.beginStage('lobby-shader-compile');
      try { if (this.r.compileAsync) await this.r.compileAsync(L.scene, L.cam); else this.r.compile(L.scene, L.cam); }
      catch (e) { console.warn('[showcase] lobby set warm-up', e); }
      finally { compileDone?.(); }
      L.kids.remove(warm.root); warm.dispose?.();
      if (this.lob !== L) return;
      L.ready = true;
    }).catch((e) => { console.error('[showcase] lobby set', e); L.failed = true; });
  }

  // 【环境接管】后巷自带的环境贴图/雾/背景色,缺省时回退到全局 G.env。
  _lobEnv(L) {
    const S = L.set;
    L.scene.environment = (S && S.environment) || G.env?.envMap || null;
    L.scene.environmentIntensity = S && S.environmentIntensity != null ? S.environmentIntensity : 0.5;
    if (S && S.fog) L.scene.fog = S.fog;
    if (S && S.background && S.background.isColor) L.bg.copy(S.background);
  }

  // droplets land on the dock (a disc over the rivals' marks) or the asphalt
  // 【甲板表】墨滴的落地面: rivals 的站位在码头圆盘上(一个大盘),其余是沥青大地面(zs=1 的圆≈无限)。
  _lobDecks(L) {
    const sp = L.set.spots, F = sp.slice(0, 4), B = sp.slice(4, 8);
    const avg = (a, k) => a.reduce((s, p) => s + p.pos[k], 0) / a.length;
    const bx = avg(B, 'x'), bz = avg(B, 'z');
    let br = 0;
    for (const p of B) br = Math.max(br, Math.hypot(p.pos.x - bx, p.pos.z - bz));
    L.groundY = avg(F, 'y');
    L.decks = [{ x: bx, z: bz, r: br + 1.0, y: avg(B, 'y') + 0.002 }, { x: 0, z: 0, r: 1e4, y: L.groundY + 0.002 }];
  }

  // 【彻底释放】联机界面永久退出后调用:销毁全部成员、后巷场景、特效几何与墨材质(含 GPU 资源)。
  // release the whole set (GPU resources included) — the online screens were left for good
  _lobRelease() {
    const L = this.lob;
    if (!L) return;
    this.lob = null;
    for (const M of L.members.values()) if (M.c) { M.c.dispose?.(); M.c = null; }
    L.members.clear();
    if (L.set) { L.set.dispose(); L.set = null; }
    for (const f of L.fx) { f.mesh.geometry.dispose(); f.splats.geometry.dispose(); f.rings.geometry.dispose(); }
    for (const m of L.ink) m.dispose();
    L.sparks.mesh.geometry.dispose(); L.sparks.mesh.material.dispose();
    L.trail.dispose();
    L.scene.clear();
  }

  // 【进入联机模式】若当前是摄影棚叠加模式(展台/奖台),先让它按 SET_FADE 溶解掉,而不是硬切。
  _enterSetMode(mode) {
    // a studio overlay on screen (pedestal / podium) dissolves away over the set instead of cutting
    if (OVERLAY.has(this.mode) && this.chars.length) { this._lastMode = this.mode; this._out = this._outDur = SET_FADE; }
    this.mode = mode;
  }

  // 【运镜切换】hub ⇄ room 两档取景。已在屏上:GLIDE 秒平滑过渡;不在屏上:直接切
  // (后巷溶解进来时就是目标取景)。
  _lobShot(kind) {
    const L = this.lob;
    if (L.shot === kind) return;
    // on screen: glide between the framings; otherwise cut (the set dissolves in already framed)
    if (L.shot && L.k > 0.05 && !L.reduced) { L.shotFrom = L.shot; L.shotT = 0; } else L.shotFrom = null;
    L.shot = kind;
  }

  // 【联机大厅(hub)】你的小孩站在后巷 hub 位,取景在创建/加入卡片的右侧。
  // 首次:破墨而出('pop');从房间返回:站在原位的成员改回 HUB_ID,走回 hub 位。
  /** Online hub (menus.js 'online'): your kid on the set's hub spot, framed right of the create / join cards. */
  showHub(style, color, weapon) {
    const L = this._lobEnsure();
    if (!color || !color.isColor) color = new THREE.Color(color || this.color);
    const look = style ? { ...style } : this._profileStyle();
    weapon = weapon || G.game?.profile?.weapon || 'shooter';
    this._enterSetMode('hub');
    this._lobShot('hub');
    if (this.ui.hub) this.ui.hub.next = 0;
    L.setT = -1; L.launchT = -1;
    if (!L.room) {
      L.myTeam = 0;
      L.colors[0].copy(color);
      const rv = G.teamColors && G.teamColors[1];
      if (rv) L.colors[1].set(rv.isColor ? rv : new THREE.Color(rv));
      this._lobColors(true);
    }
    let M = L.members.get(HUB_ID) || [...L.members.values()].find((m) => m.you && !m.dead && !m.leaving);
    if (M && M.id !== HUB_ID) { L.members.delete(M.id); M.id = HUB_ID; L.members.set(HUB_ID, M); }
    if (!M) {
      M = this._lobNew({ id: HUB_ID, name: 'You', you: true, weapon, style: look }, styleKey(look));
      L.members.set(HUB_ID, M);
      M.mark = 'hub'; M.fresh = false;
      this._lobArrive(M, 'pop', 0.3);   // bursts out of a puddle once the alley is up
      return;
    }
    M.you = true; M.ready = false; M.leaving = false; M.team = 0; M.wantTeam = 0;
    this._lobChange(M, weapon, look, false);
    if (M.mark !== 'hub') {
      M.mark = 'hub';
      if (this._lobStanding(M) && L.k > 0.05) this._lobDepart(M, 'duck');
      else if (M.phase !== 'dive' && M.phase !== 'swim') this._lobArrive(M, 'stand', 0);
    } else if (M.phase === 'launched' || M.phase === 'off') this._lobArrive(M, 'stand', 0);
  }

  /** opts.reduced: prefers-reduced-motion (no camera drift or glides). opts.quick is accepted for compatibility: coming
   *  back to a room whose line-up is parked here (locker, a match) always finds everyone already standing. */
  // 【房间上线】切到 room 运镜;已进过房(从更衣室/比赛回来)则全员直接站好。
  // L.initial 标记「本帧是首进房」,供 updateLobby 决定新成员是破墨还是直接站。
  showLobby(players, colors, opts = {}) {
    const L = this._lobEnsure();
    L.reduced = !!opts.reduced;
    if (this.mode !== 'lobby') {
      this._enterSetMode('lobby');
      this._lobShot('lobby');
      if (this.ui.lob) this.ui.lob.next = 0;
      L.launchT = -1; L.setT = -1;
      if (L.room) {
        // back in the room: everyone is simply there (looks / weapons changed meanwhile are already on)
        for (const M of L.members.values()) {
          if (M.dead || M.leaving || M.id === HUB_ID || typeof M.mark !== 'number') continue;
          if (M.phase === 'launched' || M.phase === 'off' || M.phase === 'wait' || M.act) { M.act = null; M.q.length = 0; this._lobArrive(M, 'stand', 0); }
        }
      }
    }
    const first = !L.room;
    L.room = true;
    L.initial = first;
    this.updateLobby(players, colors);
    L.initial = false;
  }

  // 【房间同步】对照 G.net.lobby.players 增删改成员:
  // 新 id → _lobNew(入场方式由 _lobSlots 决定);消失 id → _lobLeave;换装/换武器/准备态 → _lobChange。
  // 换边(flip)时全队列重排,每人潜泳换 mark。结束时按需要染队色并重排站位。
  updateLobby(players, colors) {
    const L = this.lob;
    if (!L || !L.room) return;
    let palette = false;
    if (colors && colors.length >= 2) {
      for (let t = 0; t < 2; t++) {
        const nc = this._c.set(colors[t].isColor ? colors[t] : new THREE.Color(colors[t]));
        if (!L.colors[t].equals(nc)) { L.colors[t].copy(nc); palette = true; }
      }
    }
    let recolor = palette;
    const list = Array.isArray(players) ? players.filter((p) => p && p.id != null) : [];
    const me = list.find((p) => p.you);
    const teamOf = (p) => (p.team === 1 ? 1 : 0);
    const myTeam = me ? teamOf(me) : (L.myTeam ?? 0);
    const flip = L.myTeam != null && !L.initial && myTeam !== L.myTeam;
    if (myTeam !== L.myTeam) recolor = true;
    L.myTeam = myTeam;
    // your hub kid becomes your room member
    if (me && !L.members.has(me.id)) {
      const H = L.members.get(HUB_ID);
      if (H && !H.dead) { L.members.delete(HUB_ID); H.id = me.id; L.members.set(me.id, H); }
    }
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      const team = p.you || teamOf(p) === myTeam ? 0 : 1;
      let M = L.members.get(p.id);
      if (M && M.dead) { L.members.delete(p.id); M = null; }
      const skey = styleKey(p.style);
      if (!M) {
        M = this._lobNew(p, skey);
        M.team = M.wantTeam = team; M.fresh = true;
        L.members.set(p.id, M);
        continue;
      }
      M.name = p.name || M.name; M.host = !!p.host; M.you = !!p.you; M.wantTeam = team;
      if (M.leaving && M.phase !== 'dive') M.leaving = false;   // left and came straight back: the swim-out turns into an arrival
      this._lobChange(M, p.weapon, p.style, !!p.ready, skey);
    }
    for (const M of L.members.values()) if (!seen.has(M.id) && M.id !== HUB_ID && !M.leaving && !M.dead) this._lobLeave(M);
    if (recolor) this._lobColors(palette && !flip);
    this._lobSlots(flip);
  }

  // weapon / look / ready changes: a reaction on a kid standing on its mark; silent (already on at its entrance)
  // while it's off stage; queued (played once it lands) while it's travelling
  // 【变更分发】武器换→小跳(hop);外观换→pop(墨爆换人);准备态换→准备/取消动作。
  // 台上立刻演;台下静默生效(入场时已是新样);移动中排队,落地补演。
  _lobChange(M, weapon, style, ready, skey = styleKey(style)) {
    const onStage = this._lobStanding(M) && this.lob.k > 0.05;
    const hidden = !M.c || !M.c.root.visible || M.phase === 'wait' || M.phase === 'off' || M.phase === 'launched' || this.lob.k <= 0.05;
    if (weapon && weapon !== M.weapon) {
      M.weapon = weapon;
      if (hidden) { if (M.c) { M.kind = weaponKind(M.weapon); M.c.setWeapon(M.kind); } } else this._lobAct(M, { kind: 'hop' });
    }
    if (style && skey !== M.skey) {
      M.skey = skey; M.style = { ...style };
      if (hidden) { if (M.c) { this.lob.kids.remove(M.c.root); M.c.dispose?.(); M.c = null; if (M.phase !== 'wait' && M.phase !== 'off' && M.phase !== 'launched') this._lobArrive(M, 'stand', 0); } }
      else this._lobAct(M, { kind: 'pop' });
    }
    if (ready !== M.ready) {
      M.ready = ready;
      if (onStage) this._lobAct(M, { kind: ready ? 'ready' : 'unready' });
      else if (M.c && M.a.form === 'kid') M.c.setDance(ready ? 'lobby_pose' : M.danceIdle);
    }
  }

  // 【成员工厂】member 是一大包逐人状态:身份、mark/dest(站位)、phase(阶段)、
  // 路径(path/s/v)、动画输入 a、pose 量(y/sy)、一次性动作 act 与队列 q、
  // 闲暇变化(idleT 换舞蹈、gT 扫视)、头部扫视弹簧(gY/gV/gTarget)。
  // danceIdle 按序号在 menu_idle / locker_idle 间交替,免得全队同步。
  _lobNew(p, skey) {
    const L = this.lob;
    return {
      id: p.id, name: p.name || 'Squidkid', you: !!p.you, host: !!p.host, ready: !!p.ready, weapon: p.weapon || 'shooter',
      style: p.style ? { ...p.style } : {}, skey, team: 0, wantTeam: 0, mark: null, at: null, dest: null, c: null, a: this._anim(), kind: null,
      phase: 'off', t0: 0, delay: 0, flag: 0, enter: null, fresh: false, path: null, s: 0, v: 0, onEnd: null, leap: null, dive: null, after: null,
      pos: new THREE.Vector3(), yaw: 0, y: 0, sy: 1, vis: 0, plateH: PLATE_H, trailS: 0, hy: 0, popAnt: 0.3, puddle: false,
      act: null, q: [], leaving: false, dead: false,
      danceIdle: (L.seq++ & 1) ? 'locker_idle' : 'menu_idle', idleT: 6 + this.rand() * 8, gT: 1 + this.rand() * 3, gY: 0, gV: 0, gTarget: 0, gHold: 0,
      pop: null, popT: 0, yawOff: (this.rand() - 0.5) * 0.1,
    };
  }

  // 【小工具】mark→场景站位;成员行色(我方永远显示为前排色,换边时翻转的是世界不是队色);
  // 「在台上」=有实体、可见且处于 idle/land。
  _lobSpot(mark) {
    const S = this.lob && this.lob.set;
    if (!S || mark == null) return null;
    return mark === 'hub' ? S.hubSpot : S.spots[mark] || null;
  }
  _lobRowColor(team) { const L = this.lob, t = L.myTeam === 1 ? 1 : 0; return L.colors[team ? 1 - t : t]; }
  _lobStanding(M) { return !!(M.c && M.c.root.visible && (M.phase === 'idle' || M.phase === 'land')); }

  // team colours → ink materials (by row), the set's own dressing; kids too on a palette change (`kids`) — a side swap
  // shows on each kid as it dives through the ink instead
  _lobColors(kids = false) {
    const L = this.lob;
    const a = this._lobRowColor(0), b = this._lobRowColor(1);
    for (let i = 0; i < 2; i++) {
      const c = i ? b : a;
      L.ink[i].color.copy(c);
      L.ink[i].sheenColor.copy(c).lerp(this._c.setRGB(1, 1, 1), 0.55);
    }
    // (the set re-bakes its environment map on a colour change: only when the colours really changed)
    const key = a.getHexString() + b.getHexString();
    if (L.set && L.sentCols !== key) { L.sentCols = key; L.set.setTeamColors?.(a, b); }
    if (kids) for (const M of L.members.values()) if (M.c && !M.dead) M.c.setColor(this._lobRowColor(M.team));
  }

  // 【角色构建】按成员的队伍色/武器/外观建 Character(复用游戏内的角色类),
  // rotation.order='YXZ'(先偏航后俯仰,摆姿势需要);就绪舞蹈按准备态选择;先藏,入场上台。
  _lobChar(M) {
    const kind = weaponKind(M.weapon);
    const c = new this.CharacterClass({ color: this._lobRowColor(M.team).clone(), weapon: kind, style: { ...M.style }, name: M.name || 'Squidkid', isLocal: false });
    c.root.rotation.order = 'YXZ';
    c.setDance(M.ready ? 'lobby_pose' : M.danceIdle);
    c.root.visible = false;
    this.lob.kids.add(c.root);
    M.c = c; M.kind = kind;
    return c;
  }

  // 【站位分配】你 = 前排中央(mark 0);队伍不变就保原位;新人由中间向外填空位
  // (场景站位顺序:前排 0..3,对手 4..7)。mark 编码:行号 = mark>>2,列 = mark&3。
  // slots: you = front centre (mark 0); everyone keeps their mark while their team is unchanged; newcomers fill
  // centre-out (the set orders its spots front 0..3, rivals 4..7)
  _lobSlots(flip) {
    const L = this.lob;
    const taken = [[null, null, null, null], [null, null, null, null]];
    const live = [...L.members.values()].filter((M) => !M.leaving && !M.dead && M.id !== HUB_ID);
    const cur = (M) => (typeof M.dest === 'number' ? M.dest : typeof M.mark === 'number' ? M.mark : null);
    for (const M of live) if (M.you) { taken[0][0] = M; this._lobMove(M, 0, flip, 0); }
    for (const M of live) {
      if (M.you) continue;
      const m = cur(M);
      if (!flip && m != null && (m >> 2) === M.wantTeam && !taken[m >> 2][m & 3] && m !== 0) taken[m >> 2][m & 3] = M;
    }
    let k = 0;
    for (const M of live) {
      if (M.you) continue;
      const m = cur(M);
      if (m != null && taken[m >> 2][m & 3] === M) { this._lobMove(M, m, false, 0); continue; }
      const order = M.wantTeam ? [0, 1, 2, 3] : [1, 2, 3];
      const s = order.find((i) => !taken[M.wantTeam][i]);
      if (s == null) { this._lobMove(M, null, flip, k++); continue; }   // overflow (never with ≤ 4 a side)
      taken[M.wantTeam][s] = M;
      this._lobMove(M, M.wantTeam * 4 + s, flip, k++);
    }
  }

  // 【移动指令】按成员当前状态决定移动方式:
  // 新成员→入场(真实房间:游入,彼此间隔 0.62 s;首进房:你 pop、队友跟着冒;其余:直接站);
  // 已在位:换边→潜水(duck)、同层换位→游过去(switch);台下/移动中→落地后再处理(见 _lobStep 'land')。
  _lobMove(M, mark, flip, k) {
    const L = this.lob;
    const first = M.fresh;
    if (!first && M.mark === mark && !flip) return;
    M.fresh = false;
    M.mark = mark;
    if (mark == null) { this._lobHide(M); return; }
    if (first) {
      if (!L.initial) {
        // a real arrival: swim in from the alley mouth, spaced out behind anyone already on the way
        const d = Math.max(0.12, L.nextIn - L.t);
        L.nextIn = L.t + d + 0.62;
        this._lobArrive(M, 'swim', d);
      } else if (M.you) this._lobArrive(M, 'pop', L.k > 0.05 ? 0.2 : 0);
      else if (L.k > 0.05 && L.shot === 'lobby' && L.shotFrom) this._lobArrive(M, 'pop', 0.95 + 0.13 * k);   // the room surfaces around you
      else this._lobArrive(M, 'stand', 0);
      return;
    }
    if (this._lobStanding(M) && L.k > 0.05) {
      // on its mark: a flip (you changed teams: everyone swaps sides) ducks through the ink; one kid switching swims over
      if (flip || typeof M.at !== 'number') this._lobDepart(M, 'duck', flip ? 0.05 + 0.08 * k : 0);
      else this._lobDepart(M, 'switch', 0.08 * k);
    } else if (M.phase === 'wait' || M.phase === 'off' || M.phase === 'launched' || !M.c || !M.c.root.visible || L.k <= 0.05) {
      if (M.phase !== 'wait') this._lobArrive(M, 'stand', 0);
    }
    // travelling (swim / leap / pop / dive): it finishes the trip, then heads for the new mark (see _lobStep 'land')
  }

  // 【登记入场】置 phase='wait',记下入场方式与延迟;后巷就绪且非 'stand' 时等 k≥0.6 才开场
  // (保证观众看得到过程);'stand' 则立刻站好(藏着的也算数)。
  _lobArrive(M, how, delay) {
    M.phase = 'wait'; M.enter = how; M.delay = delay; M.act = null; M.q.length = 0; M.vis = 0; M.path = null;
    if (M.c) M.c.root.visible = false;
    if (how === 'stand' && this.lob.ready) this._lobBegin(M);
  }

  _lobHide(M) { M.phase = 'off'; M.vis = 0; M.path = null; if (M.c) M.c.root.visible = false; }

  // 【离场】去程游入途中折返:沿来路倒游出巷;已站好:潜入墨中游出;
  // 其余状态(跃出/破墨/潜水中):落地后再走(_lobIdle 里处理)。
  _lobLeave(M) {
    M.leaving = true;
    const L = this.lob;
    if (!M.c || !M.c.root.visible || M.phase === 'wait' || M.phase === 'off' || M.phase === 'launched' || L.k <= 0.05) { this._lobDispose(M); return; }
    if (M.phase === 'swim' && M.onEnd !== 'gone' && M.path) {
      // turned back mid-arrival: swim out the way it came
      const P = M.path, n = P.pts.length;
      let i = 0;
      while (i < n - 1 && P.cum[i] < M.s) i++;
      const back = P.pts.slice(0, i + 1).reverse();
      back[0] = M.pos.clone();
      M.path = makePath(back.length > 1 ? back : [M.pos.clone(), P.pts[0]], null);
      M.s = 0; M.onEnd = 'gone';
    } else if (this._lobStanding(M)) this._lobDepart(M, 'leave');
    // leaping / popping / diving: it leaves as soon as it has landed (see _lobIdle)
  }

  // 【强制退场】直接销毁成员并移出成员表(离房且不可见、或离开联机时)。
  _lobDispose(M) {
    M.dead = true;
    if (M.c) { this.lob.kids.remove(M.c.root); M.c.dispose?.(); M.c = null; }
    if (this.lob.members.get(M.id) === M) this.lob.members.delete(M.id);
  }

  // 【出发】站着的成员转身朝目的地 → 小跳 → 在空中变乌贼钻进自己的墨里;
  // 后续由 _lobAfterDive 接:leave 游出巷子 / switch 游向新 mark / duck 直接在原地新 mark 冒出。
  // 'vanish':房间正在你周围溶解,潜下即消失。
  // A standing kid sets off: turns toward where it's going, hops and dives into its own ink, then (see _lobAfterDive)
  // swims the route ('leave' → out of the alley · 'switch' → to its new mark) or surfaces on its new mark ('duck').
  // 'vanish': the room dissolving around you as you leave it (dives and is gone).
  _lobDepart(M, how, delay = 0) {
    const L = this.lob, S = L.set;
    M.after = how; M.phase = 'dive'; M.t0 = L.t + delay; M.flag = 0; M.act = null; M.q.length = 0; M.path = null;
    let yaw = M.yaw;
    if (S && (how === 'leave' || how === 'switch')) {
      const raw = how === 'leave' ? S.exitPath(M.at) : this._lobRoute(M.at, M.mark);
      if (raw && raw.length) {
        raw[0] = M.pos.clone();
        M.path = makePath(raw, this._lobAvoid(M));
        pathAt(M.path, Math.min(0.7, M.path.len), _v, _d);
        yaw = Math.atan2(_d.x, _d.z);
      }
    }
    M.dive = { yaw };
  }

  // mark → mark along the set's own corridors: out along the old mark's exit path until it meets the new mark's lane
  // (same level: the dock is only climbed by its stairs), then in along that lane
  // 【走廊寻路】mark→mark 走场景自己的通道:先沿旧 mark 的 exitPath 出,找到与去新 mark 的
  // lane 相遇的交会点(代价 = 已走路程 + 1.7×直线距 + 剩余lane;只接受同高度的点,
  // 码头只有楼梯能上),再沿 lane 进去。路径点加密到 0.5 m 供代价计算。
  _lobRoute(from, to) {
    const S = this.lob.set;
    if (typeof from !== 'number') return [this._lobSpot(from)?.pos.clone() || new THREE.Vector3(), S.spots[to].pos.clone()];
    const dense = (pts) => {
      const out = [pts[0].clone()];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.5));
        for (let k = 1; k <= n; k++) out.push(new THREE.Vector3().lerpVectors(a, b, k / n));
      }
      const cum = [0];
      for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + out[i].distanceTo(out[i - 1]));
      return { p: out, cum };
    };
    const E = dense(S.exitPath(from)), N = dense(S.lanes(to));
    const nl = N.cum[N.cum.length - 1];
    let best = 1e9, bi = 0, bj = N.p.length - 1;
    for (let i = 0; i < E.p.length; i++) {
      for (let j = 0; j < N.p.length; j++) {
        if (Math.abs(E.p[i].y - N.p[j].y) > 0.12) continue;
        const c = E.cum[i] + 1.7 * E.p[i].distanceTo(N.p[j]) + (nl - N.cum[j]);
        if (c < best) { best = c; bi = i; bj = j; }
      }
    }
    return [...E.p.slice(0, bi + 1), ...N.p.slice(bj)];
  }

  // kids standing on their marks, for swimmers to steer round
  // 【避让集合】站上 mark 的其他人,游动者绕行用。
  _lobAvoid(M) {
    const out = [];
    for (const N of this.lob.members.values()) if (N !== M && !N.dead && this._lobStanding(N)) out.push(N.pos);
    return out;
  }

  /** Queue a one-shot on a member (weapon hop, look pop, ready flourish, emote, launch). `now` pre-empts. */
  // 【动作入队】一次性演出(换武器跳/换装 pop/准备/表情/发射)。同类动作去重;
  // now=true 清空当前与队列(倒计时这种「立刻肃立」的场合)。
  _lobAct(M, act, now = false) {
    if (act.kind === 'hop' || act.kind === 'pop') { const i = M.q.findIndex((a) => a.kind === act.kind); if (i >= 0) M.q.splice(i, 1); }
    if (now) { M.q.length = 0; M.act = null; }
    M.q.push(act);
  }

  // 【表情】查表 LOB_EMOTES,排队替换旧表情(同一人只演一个),正在演的直接收尾。
  lobbyEmote(id, name) {
    const M = this.lob && this.lob.members.get(id);
    if (!M || M.dead || M.leaving || !LOB_EMOTES[name] || !this._lobStanding(M)) return;
    const i = M.q.findIndex((a) => a.kind === 'emote');
    if (i >= 0) M.q.splice(i, 1);
    if (M.act && M.act.kind === 'emote') M.act.end = true;
    M.q.push({ kind: 'emote', name });
  }

  /** Countdown started: everyone drops what they're doing and squares up in the ready stance; the camera leans in. */
  // 【倒计时】全员清空动作与队列、肃立 lobby_pose,镜头随后缓缓推近(见 _lobCamera 的 setT)。
  lobbyGetSet() {
    const L = this.lob;
    if (!L || this.mode !== 'lobby') return;
    L.setT = L.t;
    for (const M of L.members.values()) {
      if (M.dead || M.leaving || !this._lobStanding(M)) continue;
      M.q.length = 0;
      if (M.act && M.act.kind !== 'jumpout') M.act = null;
      M.gTarget = 0; M.gHold = 0; M.gT = 9;
      M.c.setDance('lobby_pose');
      M.c.trigger('land', 4);
    }
  }

  /** Match start: every kid super-jumps out, front centre first. Returns the seconds until the alley is empty. */
  // 【开赛】每个站着的成员按 mark 顺序 super-jump 出画(中央先行,每人错 0.07 s);
  // 返回「巷子清空所需秒数」,供调用方决定何时切换画面。
  lobbyLaunch() {
    const L = this.lob;
    if (!L || this.mode !== 'lobby') return 0;
    let k = 0;
    const ms = [...L.members.values()].filter((M) => !M.dead && !M.leaving && this._lobStanding(M) && typeof M.mark === 'number')
      .sort((a, b) => a.mark - b.mark);
    for (const M of ms) { M.q.length = 0; M.act = null; M.phase = 'idle'; M.q.push({ kind: 'jumpout', launch: true, delay: 0.07 * k++ }); }
    L.launchT = L.t;
    return 0.75 + 0.07 * Math.max(0, k - 1);
  }

  /** The room was left: the others duck away into the ink; your kid stays and heads back to the hub spot (showHub). */
  // 【离房】其他成员逐个 'vanish' 潜走(不在台上的直接销毁);你的成员改回 HUB_ID、
  // 恢复闲逛舞蹈,等 showHub 叫它走回 hub 位。
  leaveLobby() {
    const L = this.lob;
    if (!L) return;
    let k = 0;
    for (const M of [...L.members.values()]) {
      if (M.dead) continue;
      if (M.you || M.id === HUB_ID) {
        if (M.id !== HUB_ID) { L.members.delete(M.id); M.id = HUB_ID; L.members.set(HUB_ID, M); }
        M.ready = false; M.act = null; M.q.length = 0; M.team = M.wantTeam = 0;
        if (M.c && M.a.form === 'kid') M.c.setDance(M.danceIdle);
        continue;
      }
      M.leaving = true;
      if (this._lobStanding(M) && L.k > 0.05) this._lobDepart(M, 'vanish', 0.04 + 0.06 * k++);
      else this._lobDispose(M);
    }
    L.room = false; L.myTeam = 0; L.setT = -1; L.launchT = -1; L.nextIn = 0;
    if (this.mode === 'lobby') this.hide();
  }

  // 【名牌锚点】成员的屏幕投影(脚下 + 身高×缩放处),供 DOM 名牌跟随;
  // 离场/隐藏成员返回 null。
  lobbyAnchor(id, out = {}) {
    const L = this.lob;
    if (!L || !L.ready || L.k <= 0.02 || this.mode !== 'lobby') return null;
    const M = L.members.get(id);
    if (!M || M.dead || !M.c || M.phase === 'wait' || M.phase === 'off' || M.phase === 'launched') return null;
    _v.set(M.pos.x, M.pos.y + M.y + M.plateH * M.sy, M.pos.z);
    return this._lobProject(_v, out, M.vis, M.team, typeof M.mark === 'number' ? M.mark & 3 : 0);
  }

  // 【空位锚点】某排某列空站位的名牌投影(组队时显示「+ 邀请」位);
  // 有成员占用或正在开赛(launchT≥0)时隐藏。
  lobbySlotAnchor(row, i, out = {}) {
    const L = this.lob;
    if (!L || !L.ready || L.k <= 0.02 || this.mode !== 'lobby' || !L.room) return null;
    const mark = row * 4 + i, S = this._lobSpot(mark);
    if (!S) return null;
    let free = true;
    for (const M of L.members.values()) if (!M.dead && !M.leaving && (M.mark === mark || M.dest === mark)) { free = false; break; }
    _v.set(S.pos.x, S.pos.y + PLATE_H - 0.35, S.pos.z);
    return this._lobProject(_v, out, free && L.launchT < 0 ? 1 : 0, row, i);
  }

  // screen point for a DOM plate; hidden when it would sit under a UI panel (swimmers pass behind them in the distance)
  // 【投影】世界点 → 屏幕像素 + 缩放基准(s = 相对前排水准的每米像素比,名牌按它缩放);
  // 落在 UI 面板之下时 vis 清零(游动者从远处面板后路过,名牌不该冒出来)。
  _lobProject(p, out, vis, row, slot) {
    const cam = this.lob.cam, W = innerWidth, H = innerHeight;
    _s.copy(p);
    _v.copy(p).project(cam);
    out.x = (_v.x + 1) * 0.5 * W; out.y = (1 - _v.y) * 0.5 * H;
    out.behind = _v.z > 1;
    _d.setFromMatrixColumn(cam.matrixWorld, 0);
    _s.add(_d).project(cam);
    out.s = Math.abs(_s.x - _v.x) * 0.5 * W / Math.max(1, this.lob.kFront);
    const U = this.lob.U;
    const inside = !U || (out.x > U.l + 24 && out.x < U.r - 24 && out.y > U.t + 20 && out.y < U.b + 30);
    out.vis = inside ? vis : 0; out.row = row; out.slot = slot;
    return out;
  }

  // ---------------------------------------------------------------------------------------------- lobby set: update
  // 【后巷更新】淡入系数 k 按 SET_FADE 增减;完全退出后并不立刻释放——只要还在联机流程里
  // (在线、在房里、预载标记、菜单栈含 online/lobby)就先驻留,彻底离开 1.5 s 后才 _lobRelease 省显存。
  _updateSet(dt) {
    const L = this.lob;
    if (!L) return;
    const on = SET_MODES.has(this.mode);
    L.k = on && L.ready ? Math.min(1, L.k + dt / SET_FADE) : Math.max(0, L.k - dt / SET_FADE);
    if (!on && L.k <= 0) {
      // off screen: kept (parked) while you're online — a room, the hub or a trip to the locker from either;
      // released a moment after the online screens are left for good
      const net = G.net && G.net.state && G.net.state !== 'offline' && G.net.state !== 'error';
      const st = G.menus && G.menus._stack;
      const keep = net || L.room || L.preload || (st && st.some((s) => s === 'online' || s === 'lobby')) || (G.menus && (G.menus.current === 'online' || G.menus.current === 'lobby'));
      L.gone = keep ? 0 : L.gone + dt;
      if (L.gone > 1.5) this._lobRelease();
      return;
    }
    L.gone = 0;
    L.preload = false;       // shown once: from here on it follows the normal parked / released rules
    if (!L.ready) return;
    const S = L.set;
    const q = G.settings?.quality;
    if (q && q !== L.quality) { L.quality = q; S.setQuality?.(q); }
    L.t += dt;
    L.shotT += dt;
    S.update?.(dt, L.t);
    // members (kids + contact shadows)
    let ci = 0;
    for (const M of [...L.members.values()]) {
      this._lobStep(M, dt);
      if (M.dead || !M.c || !M.c.root.visible || ci >= 10) continue;
      const kidK = M.c.kidScale ?? (M.a.form === 'kid' ? 1 : 0);
      const hgt = Math.max(0, M.y);
      const al = kidK * (M.y < -0.05 ? 0 : 0.6 * (1 - c01(hgt / 1.4) * 0.8));
      if (al > 0.01) this._lobContact(ci++, M.pos.x, M.pos.y + 0.004, M.pos.z, 0.66 * (1 + hgt * 0.6), al);
    }
    for (let i = ci; i < 10; i++) L.contact.setMatrixAt(i, ZERO_M);
    L.contact.count = Math.max(ci, 1);
    L.contact.instanceMatrix.needsUpdate = true;
    if (L.contact.instanceColor) L.contact.instanceColor.needsUpdate = true;
    L.fx[0].update(dt, L.decks); L.fx[1].update(dt, L.decks);
    L.sparks.update(dt);
    L.trail.update(dt);
  }

  _lobContact(i, x, y, z, size, alpha) {
    const C = this.lob.contact;
    _m4.makeScale(size, 1, size).setPosition(x, y, z);
    C.setMatrixAt(i, _m4);
    C.setColorAt(i, this._c.setRGB(alpha, 0, 0));
  }

  // start an entrance ('stand' · 'pop' out of a puddle · 'swim' in from the alley mouth)
  // 【入场开场】三种方式:
  // 'swim' 沿 lane 游入(初速 0.8 巡航,名牌压低到 0.55 m);'pop' 从水洼破墨(先藏好);
  // 'stand' 直接站定触发 spawn。三种都会先 _lobWarm 离屏热身,首帧即活。
  _lobBegin(M) {
    const L = this.lob, S = this._lobSpot(M.mark);
    if (!S) return;
    if (!M.c) this._lobChar(M);
    const c = M.c, a = M.a, how = M.enter;
    M.dest = M.mark; M.flag = 0; M.t0 = L.t; M.y = 0; M.sy = 1; M.act = null;
    M.team = typeof M.mark === 'number' ? M.mark >> 2 : 0;
    c.setColor(this._lobRowColor(M.team));
    if (how === 'swim') {
      const P = (M.path = makePath(L.set.lanes(M.mark), this._lobAvoid(M)));
      M.s = 0; M.v = SWIM.v * 0.8; M.onEnd = 'leap'; M.trailS = 0;
      const h = pathAt(P, 0, M.pos, _d);
      M.yaw = Math.atan2(_d.x, _d.z); M.hy = h || 0;
      a.form = 'swim'; a.grounded = true;
      M.phase = 'swim'; M.vis = 1; M.plateH = 0.55;
      this._lobWarm(M, SWIM.lift);
      return;
    }
    M.pos.copy(S.pos); M.yaw = S.yaw + M.yawOff;
    if (how === 'pop') {
      M.phase = 'pop'; M.puddle = false; M.popAnt = M.popAnt || 0.3;
      a.form = 'swim'; M.vis = 0; M.plateH = PLATE_H;
      this._lobWarm(M, -1.2);
      c.root.visible = false;
      return;
    }
    // stand: already there, feet planted, mid-idle
    M.phase = 'idle'; M.at = M.mark; M.vis = 1; M.plateH = PLATE_H;
    a.form = 'kid'; a.grounded = true;
    c.trigger('spawn');
    c.setDance(M.ready ? 'lobby_pose' : M.danceIdle);
    this._lobWarm(M, 0);
  }

  // settle a (re)placed kid's springs / feet / squid pose off-screen so its first visible frame is already alive
  // 【离屏热身】把(重)放置的成员先藏到目标点、连跑 10 帧 30 fps 模拟:
  // 弹簧、脚步、乌贼姿态全部进入自然相位,再亮出——杜绝 T-pose / 弹簧僵直。
  _lobWarm(M, y) {
    const c = M.c, a = M.a;
    c.root.position.set(M.pos.x, M.pos.y + y, M.pos.z);
    c.root.rotation.set(0, M.yaw, 0);
    c.root.scale.set(1, 1, 1);
    for (let i = 0; i < 10; i++) { a.time += 1 / 30; c.update(1 / 30, a); }
    c.root.visible = true;
  }

  // 【成员推进】phase 状态机,每帧一步:
  // wait 等开场 → swim 低姿游动(避人、上台阶、铺湿痕、甩尾水花)→ leap 海豚弧跃出变人 →
  // pop 水洼破墨 → dive 转身潜墨 → land 落地余振 → idle 站定(闲暇变化与一次性动作)。
  _lobStep(M, dt) {
    const L = this.lob, t = L.t;
    if (M.dead || M.phase === 'off' || M.phase === 'launched') return;
    if (M.phase === 'wait') {
      if (M.mark == null) return;
      // entrances wait for the alley to be on screen (a 'stand' happens at once, hidden or not)
      if (M.enter !== 'stand' && L.k < 0.6) return;
      M.delay -= dt;
      if (!M.c && M.delay < 0.5) this._lobChar(M);
      if (M.delay > 0) return;
      this._lobBegin(M);
      if (M.phase === 'wait') return;
    }
    const c = M.c;
    if (!c) return;
    const a = M.a, fx = L.fx[M.team ? 1 : 0];
    a.time = G.time;
    let y = 0, sy = 1, twirl = 0, pitch = 0, air = false, vy = 0;
    const tau = t - M.t0;
    if (M.phase === 'swim') {
      // ---- low fast swim along the path; hops the stairs; brakes into the leap (or a surfacing / the alley mouth)
      const P = M.path;
      const sEnd = M.onEnd === 'leap' ? Math.max(0, P.len - SWIM.leap) : P.len;
      const vEnd = M.onEnd === 'leap' ? 4.6 : M.onEnd === 'pop' ? 1.2 : SWIM.v;
      const cap = Math.sqrt(vEnd * vEnd + 2 * SWIM.brake * Math.max(0, sEnd - M.s));
      const inHop = P.climbs.some((C) => M.s > C.s0 - 0.4 && M.s < C.s1);
      const vT = Math.min(SWIM.v * (inHop ? 0.62 : 1), cap);
      M.v = M.v < vT ? Math.min(vT, M.v + SWIM.acc * dt) : Math.max(vT, M.v - SWIM.brake * 1.6 * dt);
      M.s = Math.min(sEnd, M.s + M.v * dt);
      const h = pathAt(P, M.s, M.pos, _d);
      M.yaw = dampAngle(M.yaw, Math.atan2(_d.x, _d.z), 14, dt);
      a.form = 'swim';
      if (h !== null) { air = true; y = h; vy = (h - M.hy) / Math.max(dt, 1e-3); }
      else y = SWIM.lift;
      if (h !== null && M.hy === 0) fx.crown(M.pos.x, M.pos.y, M.pos.z, 0.5, 9, 0.12);   // takes off up / down the steps
      if (h === null && M.hy > 0.05) { fx.crown(M.pos.x, M.pos.y, M.pos.z, 0.55, 10, 0.12); G.audio?.play?.('swim_splash', { volume: 0.18 }); }
      M.hy = h || 0;
      M.plateH = damp(M.plateH, 0.55, 8, dt);
      if (!air) {
        // wet trail + a little spray off the tail at speed
        M.trailS += M.v * dt;
        const col = this._lobRowColor(M.team), sp = c01(M.v / SWIM.v);
        while (M.trailS >= SWIM.gap) {
          M.trailS -= SWIM.gap;
          const back = M.trailS + 0.16;
          L.trail.add(M.pos.x - _d.x * back, M.pos.y, M.pos.z - _d.z * back, M.yaw, (0.068 + 0.024 * sp) * (0.85 + 0.3 * this.rand()), 0.12, col, 1.6 + this.rand() * 0.5);
        }
        if (this.rand() < dt * 26 * sp) {
          const r = this.rand, side = r() < 0.5 ? -1 : 1;
          fx.drop(M.pos.x - _d.x * 0.28 + _d.z * side * 0.07, M.pos.y + 0.05, M.pos.z - _d.z * 0.28 - _d.x * side * 0.07,
            -_d.x * (0.6 + r()) + _d.z * side * (0.4 + r() * 0.5), 1.1 + r() * 1.3, -_d.z * (0.6 + r()) - _d.x * side * (0.4 + r() * 0.5), 0.01 + r() * 0.012, 1, 2);
        }
      }
      if (M.s >= sEnd - 1e-4) this._lobSwimEnd(M, fx);
    } else if (M.phase === 'leap') {
      // ---- out of the ink: a squid arc that pops into the kid past the apex, turning to camera, splash-down on the mark
      const Lp = M.leap, x = c01(tau / Lp.T);
      M.pos.lerpVectors(Lp.p0, Lp.p1, x);
      y = 4 * Lp.H * x * (1 - x); vy = (4 * Lp.H * (1 - 2 * x)) / Lp.T + (Lp.p1.y - Lp.p0.y) / Lp.T;
      air = x < 1;
      if (x > 0.42 && a.form !== 'kid') {
        a.form = 'kid'; c.trigger('jump'); c.setDance(null);
        this._lobInkBurst(M, fx, 7);
      } else if (x <= 0.42) a.form = 'squid';
      M.yaw = Lp.yaw0 + wrapA(Lp.yaw1 - Lp.yaw0) * eInOut(sstep(0.2, 1.05, x));
      sy = a.form === 'kid' ? 1 + 0.1 * c01(vy / 4) - 0.05 * c01(-vy / 5) : 1;
      M.plateH = damp(M.plateH, a.form === 'kid' ? PLATE_H : 0.6, 10, dt);
      if (x >= 1) this._lobLanded(M, fx, 10);
    } else if (M.phase === 'pop') {
      // ---- out of a puddle on the mark: the puddle blooms, bubbles, then the kid bursts up through it
      const ant = M.popAnt, te = tau - ant;
      if (!M.puddle) {
        M.puddle = true;
        fx.splat(M.pos.x, M.pos.y, M.pos.z, 0.42, 2.6);
        fx.ripple(M.pos.x, M.pos.y, M.pos.z, 0.05, 0.55, Math.max(0.35, ant + 0.1));
        for (let i = 0; i < 4; i++) { const g = this.rand() * TAU, rr = 0.08 + this.rand() * 0.16; fx.bubble(M.pos.x + Math.sin(g) * rr, M.pos.y + 0.01, M.pos.z + Math.cos(g) * rr, 0.012 + this.rand() * 0.014, 0.25, 0.4 + this.rand() * 0.4); }
      }
      const y0 = -1.1, tp = 0.36, peak = 0.34;
      const g = (2 * (peak - y0)) / (tp * tp), v0 = g * tp;
      if (te < 0) { c.root.visible = false; y = y0; air = true; }
      else {
        c.root.visible = true;
        y = y0 + v0 * te - 0.5 * g * te * te; vy = v0 - g * te; air = true;
        a.form = y > -0.42 ? 'kid' : 'swim';
        if (!M.flag && y > 0) {
          M.flag = 1; M.vis = 1;
          fx.crown(M.pos.x, M.pos.y, M.pos.z, 1.15, 22, 0.2);
          c.trigger('jump');
          this._lobSparkle(M, 8);
          G.audio?.play?.('squid_out', { volume: 0.5 });
        }
        sy = 1 + 0.16 * c01(vy / 7);
        twirl = -0.6 * (1 - eOut3(c01(te / 0.55)));
        if (te > tp && y <= 0) { y = 0; air = false; this._lobLanded(M, fx, 7); }
      }
    } else if (M.phase === 'dive') {
      // ---- turn toward the way out, crouch, hop and dive into its own ink
      const D = M.dive;
      if (tau >= -0.05) M.yaw = dampAngle(M.yaw, D.yaw, 11, dt);
      const at = tau - 0.16, ant = 0.08, T = 0.36, Hh = 0.3;
      if (at < 0) { /* turning */ }
      else if (at < ant) sy = 1 - 0.14 * Math.sin((Math.PI * 0.5 * at) / ant);
      else {
        const x = Math.min(1, (at - ant) / T);
        if (!M.flag) { M.flag = 1; c.setDance(null); c.trigger('jump'); }
        y = 4 * Hh * x * (1 - x) - 0.1 * x * x; vy = (4 * Hh * (1 - 2 * x) - 0.2 * x) / T; air = true;
        // turns squid right off the ground inside a burst of ink (the character's kid → squid gesture is made for the
        // ground: mid-air it reads as a glitch), then flies the hop and dives head first into its own puddle
        if (x > 0.12 && a.form === 'kid') { a.form = 'squid'; this._lobInkBurst(M, fx, 9); }
        sy = a.form === 'kid' ? 1 + 0.1 * c01(vy / 2.5) : 1;
        pitch = 1.15 * sstep(0.3, 1, x);
        M.plateH = damp(M.plateH, a.form === 'kid' ? PLATE_H : 0.55, 10, dt);
        if (x >= 1) { this._lobAfterDive(M, fx); if (M.dead || M.phase !== 'dive') return this._lobPoseKeep(M, dt); }
      }
    } else if (M.phase === 'land') {
      sy = 1 - 0.17 * wobble(tau, 14, 6);
      a.form = 'kid';
      if (tau > 0.55) { M.phase = 'idle'; M.t0 = t; }
    }
    if (M.phase === 'idle' || M.phase === 'land') {
      // settle the turn to camera on the mark (the gait steps it round)
      const S = this._lobSpot(M.at);
      if (S) M.yaw = dampAngle(M.yaw, S.yaw + M.yawOff, M.phase === 'land' ? 5 : 3, dt);
      M.plateH = damp(M.plateH, PLATE_H, 8, dt);
    }
    if (M.phase === 'idle') {
      const r = this._lobIdle(M, t, dt, fx);
      if (M.dead || M.phase === 'launched') return;
      if (r) { y = r.y; sy = r.sy; twirl = r.twirl; pitch = r.pitch; air = r.air; vy = r.vy; }
    }
    this._lobPose(M, y, sy, twirl, pitch, air, vy, dt);
  }

  // hold the last pose for the frame a phase handed over mid-step (keeps the kid drawn where it was)
  // 【保持上一帧姿态】阶段在中途交出控制(如 dive→swim)时,让小孩停在原地再画一帧。
  _lobPoseKeep(M, dt) { if (M.c && M.c.root.visible) this._lobPose(M, M.y, M.sy, 0, 0, true, 0, dt); }

  // 【游动收尾】按 onEnd 分流:leap → 起跳弧跃向 mark(留 SWIM.leap 作为助跑距离,
  // 起跳点水花+音效);pop → 在原地转入破墨;'gone' → 出巷:离场者销毁、折返者重新游入。
  _lobSwimEnd(M, fx) {
    const L = this.lob;
    if (M.onEnd === 'leap') {
      const S = this._lobSpot(M.mark) || this._lobSpot(M.dest);
      if (!S) return;
      M.dest = M.mark;
      const p0 = M.pos.clone(), p1 = S.pos.clone();
      const span = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      M.leap = { p0, p1, T: SWIM.T * (0.8 + 0.2 * c01(span / SWIM.leap)), H: SWIM.H + Math.max(0, p1.y - p0.y) * 0.4, yaw0: M.yaw, yaw1: S.yaw + M.yawOff };
      M.phase = 'leap'; M.t0 = L.t; M.flag = 0;
      M.a.form = 'squid';
      fx.crown(p0.x, p0.y, p0.z, 0.9, 16, 0.14);
      fx.ripple(p0.x, p0.y, p0.z, 0.06, 0.5, 0.5);
      G.audio?.play?.('squid_out', { volume: 0.35 });
    } else if (M.onEnd === 'pop') {
      M.phase = 'pop'; M.t0 = L.t; M.flag = 0; M.puddle = false; M.popAnt = 0.08; M.dest = M.mark;
    } else {
      // out of the alley: gone (or, if it changed its mind on the way out, straight back in)
      M.c.root.visible = false; M.vis = 0; M.path = null;
      if (M.leaving) this._lobDispose(M); else this._lobArrive(M, 'swim', 0.35);
    }
  }

  // 【潜墨之后】换队在入墨一刻生效:乌贼带着新队色从水花里出来。
  // vanish/无路可游的 leave → 销毁;duck → 近就直接原地 pop、远就游过去再 pop;
  // 其余(leave/switch)→ 沿路径游出巷子或游向新 mark。
  _lobAfterDive(M, fx) {
    const L = this.lob, how = M.after;
    // a team change shows as it hits the ink: the squid comes out of the splash in its new colour
    M.team = typeof M.mark === 'number' ? M.mark >> 2 : 0;
    M.c.setColor(this._lobRowColor(M.team));
    fx = L.fx[M.team ? 1 : 0];
    fx.crown(M.pos.x, M.pos.y, M.pos.z, 1.0, 18, 0.18);
    fx.splat(M.pos.x, M.pos.y, M.pos.z, 0.3, 1.8);
    fx.ripple(M.pos.x, M.pos.y, M.pos.z, 0.08, 0.6, 0.55);
    G.audio?.play?.('squid_in', { volume: 0.35 });
    M.a.form = 'swim'; M.at = null;
    if (how === 'vanish' || (how === 'leave' && !M.path)) { this._lobDispose(M); return; }
    if (how === 'duck') {
      const S = this._lobSpot(M.mark);
      const far = S && Math.hypot(S.pos.x - M.pos.x, S.pos.z - M.pos.z) > 0.7 && Math.abs(S.pos.y - M.pos.y) < 0.2;
      M.dest = M.mark;
      if (far) { M.path = makePath([M.pos.clone(), S.pos.clone()], this._lobAvoid(M)); M.phase = 'swim'; M.onEnd = 'pop'; M.s = 0; M.v = 1.5; M.trailS = 0; }
      else { M.popAnt = 0.1; this._lobArrive(M, 'pop', 0.1); }
      return;
    }
    M.phase = 'swim'; M.s = 0; M.v = 1.6; M.trailS = 0; M.hy = 0;
    M.onEnd = how === 'leave' ? 'gone' : 'leap';
    M.dest = how === 'leave' ? null : M.mark;
  }

  // 【落定】进 land 阶段:记入 mark、触 land(振幅决定水花大小)、换舞蹈、
  // 大水花时加涟漪与闪点并出声,最后 _lobNotice 让队友扭头看。
  _lobLanded(M, fx, amp) {
    const L = this.lob, c = M.c;
    M.phase = 'land'; M.t0 = L.t; M.at = M.dest = M.mark; M.vis = 1; M.leap = null; M.path = null; M.popAnt = 0.3;
    M.a.form = 'kid';
    c.trigger('land', amp);
    c.setDance(M.ready ? 'lobby_pose' : M.danceIdle);
    fx.crown(M.pos.x, M.pos.y, M.pos.z, amp > 8 ? 1.2 : 0.75, amp > 8 ? 24 : 14, 0.22);
    fx.splat(M.pos.x, M.pos.y, M.pos.z, 0.34, 2.8);
    if (amp > 8) { fx.ripple(M.pos.x, M.pos.y, M.pos.z, 0.15, 0.95, 0.65); this._lobSparkle(M, 10); G.audio?.play?.('splat_small', { volume: 0.35 }); }
    this._lobNotice(M);
  }

  // 【闲时一瞥】其他 idle 且没在忙的成员,75% 概率扭头看向落地者 1.2~2 s(头部弹簧驱动)。
  // a kid lands: the others glance over at it
  _lobNotice(M) {
    for (const N of this.lob.members.values()) {
      if (N === M || N.dead || N.phase !== 'idle' || N.act || this.rand() < 0.25) continue;
      N.gTarget = this._lobYawTo(N, M.pos); N.gHold = 1; N.gT = 1.2 + this.rand() * 0.8;
    }
  }

  // yaw (kid space) toward a world point, clamped to a head turn
  _lobYawTo(M, p) {
    const yaw = M.c ? M.c.root.rotation.y : M.yaw;
    const dx = p.x - M.pos.x, dz = p.z - M.pos.z;
    const kx = dx * Math.cos(yaw) - dz * Math.sin(yaw), kz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.max(-1, Math.min(1, Math.atan2(kx, kz)));
  }

  _lobInkBurst(M, fx, n) {
    const r = this.rand, y = M.pos.y + M.y + 0.2;
    for (let i = 0; i < n; i++) {
      const g = r() * TAU, sp = 0.6 + r() * 1.1;
      fx.drop(M.pos.x, y, M.pos.z, Math.sin(g) * sp, 0.4 + r() * 1.4, Math.cos(g) * sp, 0.012 + r() * 0.014, 1, 2);
    }
  }

  // 【闲暇与一次性动作】无事时:到点换闲逛舞蹈、随机扫视邻居;
  // 有 queued 动作依次演出:hop 换武器 / pop 换装 / ready·unready / emote 表情 / jumpout 开赛跳。
  // 返回本帧的姿态偏移(y/sy/twirl/pitch/air/vy)。
  // idle life + one-shots (hop / pop / ready / unready / emote / jumpout); returns the pose offsets
  _lobIdle(M, t, dt, fx) {
    const c = M.c, a = M.a, P = M.pos;
    let y = 0, sy = 1, twirl = 0, pitch = 0, air = false, vy = 0;
    // pending business once back on the ground: leave, or head for a mark it was reassigned to on the way in
    if (!M.act) {
      if (M.leaving) { this._lobDepart(M, 'leave'); return null; }
      if (M.mark != null && M.mark !== M.at && this.lob.k > 0.05) { this._lobDepart(M, typeof M.at === 'number' && typeof M.mark === 'number' ? 'switch' : 'duck'); return null; }
    }
    if (!M.act && M.q.length) {
      M.act = M.q.shift();
      M.act.t0 = t + (M.act.delay || 0);
      M.act.flag = 0;
      if (M.act.kind === 'emote') {
        const E = LOB_EMOTES[M.act.name];
        c.setDance(E.dance); c.danceVar = E.v; if (E.t0) c.danceT = E.t0;
        if (E.trig) c.trigger(E.trig);
        if (!E.hop) c.trigger('jump');
        this._lobSparkle(M, 6);
      } else if (M.act.kind === 'ready') c.trigger('jump');
    }
    const A = M.act;
    const at = A ? t - A.t0 : 0;
    if (A && at >= 0) {
      if (A.kind === 'hop') {
        // weapon swap: crouch, spin-hop, the new weapon pops into the hand mid-air, splash on landing
        const ant = 0.075, T = 0.46, H = 0.3;
        if (at < ant) sy = 1 - 0.1 * Math.sin((Math.PI * 0.5 * at) / ant);
        else if (at < ant + T) {
          const x = (at - ant) / T;
          y = 4 * H * x * (1 - x); vy = (4 * H * (1 - 2 * x)) / T; air = true;
          twirl = TAU * eInOut(x);
          sy = 1 + 0.12 * c01(vy / 3) - 0.04 * c01(-vy / 3);
          if (!A.flag && x > 0.12) {
            A.flag = 1;
            if (M.pop) M.pop.scale.setScalar(1);
            const kind = weaponKind(M.weapon);
            c.setWeapon(kind); M.kind = kind;
            M.pop = c.weapon?.pivot || null;
            if (M.pop) { M.pop.scale.setScalar(0.001); M.popT = t; }
            c.trigger('jump');
          }
        } else if (A.flag < 2) {
          A.flag = 2; c.trigger('land', 6); fx.crown(P.x, P.y, P.z, 0.9, 18, 0.26); M.act = null;
        }
      } else if (A.kind === 'pop') {
        // look swap: squash, the new kid pops out of an ink burst, twirl hop, land
        const ant = 0.085, T = 0.34, H = 0.16;
        if (at < ant) { sy = 1 - 0.15 * Math.sin((Math.PI * 0.5 * at) / ant); y = -0.015 * (at / ant); }
        else {
          if (!A.flag) { A.flag = 1; this._lobSwap(M); fx.crown(P.x, P.y, P.z, 0.85, 18, 0.3); this._lobSparkle(M, 9); M.c.trigger('jump'); }
          const x = (at - ant) / T;
          if (x < 1) { y = 4 * H * x * (1 - x); vy = (4 * H * (1 - 2 * x)) / T; air = true; twirl = TAU * eInOut(x); sy = 1 + 0.1 * c01(vy / 2.2) - 0.05 * c01(-vy / 2.2); }
          else if (A.flag < 2) { A.flag = 2; M.c.trigger('land', 5); fx.crown(P.x, P.y, P.z, 0.5, 10, 0.3); M.c.trigger('wink'); }
          if (x > 1.35) M.act = null;
        }
      } else if (A.kind === 'ready') {
        // ready: a hop, fist pumps, a ring of glints and a splash ring round the feet
        const T = 0.36, H = 0.2;
        if (at < T) { const x = at / T; y = 4 * H * x * (1 - x); vy = (4 * H * (1 - 2 * x)) / T; air = true; sy = 1 + 0.08 * c01(vy / 2); }
        else if (!A.flag) { A.flag = 1; M.c.trigger('land', 6); M.c.setDance('victory'); M.c.danceVar = 0; fx.crown(P.x, P.y, P.z, 0.8, 16, 0.28); fx.ripple(P.x, P.y, P.z, 0.1, 1.1, 0.8); this._lobSparkle(M, 14); }
        else sy = 1 - 0.12 * wobble(at - T, 14, 6);
        if (at > 1.55) { M.act = null; M.c.setDance('lobby_pose'); }
      } else if (A.kind === 'unready') {
        sy = 1 - 0.1 * Math.sin(Math.PI * c01(at / 0.3));
        if (!A.flag) { A.flag = 1; M.c.trigger('land', 4); M.c.setDance(M.danceIdle); }
        if (at > 0.4) M.act = null;
      } else if (A.kind === 'emote') {
        const E = LOB_EMOTES[A.name];
        if (E.hop) { const T = 0.42; if (at < T) { const x = at / T; y = 4 * E.hop * x * (1 - x); vy = (4 * E.hop * (1 - 2 * x)) / T; air = true; } else if (!A.flag) { A.flag = 1; c.trigger('land', 7); fx.crown(P.x, P.y, P.z, 0.7, 14, 0.28); } }
        if (at > E.dur || A.end) { M.act = null; c.setDance(M.ready ? 'lobby_pose' : M.danceIdle); }
      } else if (A.kind === 'jumpout') {
        // super-jump out (match start): crouch, squid, launch straight up out of frame, then park until the room is back
        const ant = 0.13;
        if (at < ant) sy = 1 - 0.22 * Math.sin((Math.PI * 0.5 * at) / ant);
        else {
          const x = at - ant;
          if (!A.flag) {
            A.flag = 1; M.vis = 0; a.form = 'squid'; c.trigger('jump');
            fx.crown(P.x, P.y, P.z, 1.2, 22, 0.24); fx.ripple(P.x, P.y, P.z, 0.15, 1.1, 0.6);
            G.audio?.play?.('super_jump', { volume: 0.4 });
          }
          y = 7 * x + 26 * x * x; vy = 7 + 52 * x; air = true; pitch = -Math.PI / 2; sy = 1.4;
          if (this.rand() < 0.8) fx.drop(P.x + (this.rand() - 0.5) * 0.14, P.y + y - 0.2, P.z + (this.rand() - 0.5) * 0.14, (this.rand() - 0.5) * 0.5, -1, (this.rand() - 0.5) * 0.5, 0.012 + this.rand() * 0.016, 1, 2);
          if (x > 0.55) { M.act = null; c.root.visible = false; a.form = 'squid'; M.phase = 'launched'; return null; }
        }
      }
    }
    if (!M.act) {
      // idle variety: relaxed kids drift between two idles; everyone glances at a neighbour now and then
      M.idleT -= dt;
      if (M.idleT <= 0 && !M.ready) { M.idleT = 9 + this.rand() * 7; M.danceIdle = M.danceIdle === 'menu_idle' ? 'locker_idle' : 'menu_idle'; c.setDance(M.danceIdle); }
      else if (!c.dance) c.setDance(M.ready ? 'lobby_pose' : M.danceIdle);
    }
    M.gT -= dt;
    if (M.gT <= 0) {
      if (M.gHold > 0 || this.rand() < 0.45) { M.gTarget = 0; M.gHold = 0; M.gT = 2 + this.rand() * 4; }
      else { M.gTarget = this._lobGlance(M); M.gHold = 1; M.gT = 1.1 + this.rand() * 1.3; }
    }
    return { y, sy, twirl, pitch, air, vy };
  }

  // yaw (kid space) toward the nearest neighbour (the other team counts a little further away)
  // 【扫视目标】最近的可见邻居(对手加权 0.8 m 距离 + 随机抖动),没有就随便看看。
  _lobGlance(M) {
    let best = null, bd = 1e9;
    for (const N of this.lob.members.values()) {
      if (N === M || N.dead || !N.c || !N.c.root.visible) continue;
      const d = Math.hypot(N.pos.x - M.pos.x, N.pos.z - M.pos.z) + (N.team !== M.team ? 0.8 : 0) + this.rand() * 0.9;
      if (d < bd) { bd = d; best = N; }
    }
    return best ? this._lobYawTo(M, best.pos) : (this.rand() - 0.5) * 0.9;
  }

  // 【姿态落地】把本帧算好的 y/sy/twirl/pitch/air/vy 写进角色:
  // 位置/缩放(挤压拉伸用 xz 补偿,体积感守恒)/旋转,然后 update 角色;
  // 乌贼形强制显示眼睛(玩法里远程游动者的眼睛藏在墨下,这里要露出来);
  // 头部扫视弹簧(gY/gV)以临界阻尼叠加在 dance 姿态之上。
  _lobPose(M, y, sy, twirl, pitch, air, vy, dt) {
    const c = M.c, a = M.a;
    if (!c) return;          // released during this step (left / re-dressed / hidden): nothing left to pose
    a.grounded = !air; a.vy = vy;
    M.y = y; M.sy = sy;
    if (M.pop) {
      const k = backOut((this.lob.t - M.popT) / 0.34, 2.4);
      M.pop.scale.setScalar(Math.max(0.001, k));
      if (this.lob.t - M.popT > 0.34) { M.pop.scale.setScalar(1); M.pop = null; }
    }
    const sxz = 1 / Math.sqrt(sy);
    c.root.position.set(M.pos.x, M.pos.y + y, M.pos.z);
    c.root.scale.set(sxz, sy, sxz);
    c.root.rotation.set(pitch, M.yaw + twirl, 0);
    c.update(dt, a);
    // swimming squids keep their eyes (gameplay hides a remote swimmer's: it's under the ink there)
    if (a.form !== 'kid' && c.squid) { c.squid.eyes.visible = true; c.squid.dark.visible = true; }
    // glance: spring the head toward the target on top of the dance pose
    const k = 60, z = 11;
    M.gV += (k * (M.gTarget - M.gY) - z * M.gV) * dt;
    M.gY += M.gV * dt;
    if (Math.abs(M.gY) > 0.002 && c.bones?.head && a.form === 'kid') {
      _q2.setFromAxisAngle(UPV, M.gY * 0.62);
      c.bones.head.quaternion.premultiply(_q2);
    }
  }

  // a new look: rebuild the kid mid-squash (pre-warmed so it never shows a rest pose)
  // 【墨中换人】pop 类换装:在最扁的瞬间重建角色——继承舞蹈、变体、位置、旋转、缩放,
  // 离屏热身 12 帧再上台;pop 武器缩放归零防旧武器闪现。
  _lobSwap(M) {
    const old = M.c;
    const c = new this.CharacterClass({ color: this._lobRowColor(M.team).clone(), weapon: weaponKind(M.weapon), style: { ...M.style }, name: M.name || 'Squidkid', isLocal: false });
    c.root.rotation.order = 'YXZ';
    const dance = old ? old.dance : (M.ready ? 'lobby_pose' : M.danceIdle);
    c.setDance(dance);
    if (old) { c.danceVar = old.danceVar; c.root.position.copy(old.root.position); c.root.rotation.copy(old.root.rotation); c.root.scale.copy(old.root.scale); }
    const a = M.a, g = a.grounded;
    for (let i = 0; i < 12; i++) { a.time += 1 / 30; c.update(1 / 30, a); }
    a.grounded = g;
    if (old) { c.danceT = old.danceT; this.lob.kids.remove(old.root); old.dispose?.(); }
    if (M.pop) M.pop = null;
    this.lob.kids.add(c.root);
    M.c = c;
  }

  _lobSparkle(M, n) {
    const rnd = this.rand, P = M.pos, L = this.lob;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd() * 0.5, rr = 0.3 + rnd() * 0.3;
      const col = rnd() < 0.45 ? this._c.copy(this._lobRowColor(M.team)).lerp(_c1.setRGB(1, 1, 1), 0.35) : this._c.setRGB(1, 0.96, 0.84);
      L.sparks.spawn(P.x + Math.sin(ang) * rr, P.y + 0.35 + rnd() * 1.35, P.z + Math.cos(ang) * rr, 0.07 + rnd() * 0.07, col, 0.45 + rnd() * 0.4);
    }
  }

  // ---------------------------------------------------------------------------------------------- lobby set: camera
  // 【后巷运镜】场景自带两台机位(room 的 camera 与 hubCamera),机身永不移动(场景保证机位不撞墙):
  // 取景 = 变焦(fov)+ 镜头偏移(setViewOffset),把主体放进 UI 面板之间的空白区。
  // room:全队八站位加名牌空间;hub:你的小孩在卡片右侧。hub⇄room 按 GLIDE 滑移,其上叠一层手持微晃。
  // The set's own cameras (camera = the room, hubCamera = the hub), never moved off their positions (the set keeps
  // them clear of its walls): the fit is a zoom (fov) plus a lens shift that puts the subject inside the free area
  // between the UI panels — all eight marks with nameplate room for the room, your kid right of the cards for the hub.
  // Hub ⇄ room glides between the two; a slow handheld drift on top.
  // 【每帧运镜】debugCam 审计可整体覆盖。取目标帧(_lobFrame)→ 滑翔混合 →
  // 布局迟变用指数平滑接住 → 手持漂移(多频正弦 + 微变焦;reduced 时全关)→
  // 倒计时推近(setT)、开赛后抬头追跳走的人(launchT)。
  _lobCamera(W, H) {
    const L = this.lob, t = L.t;
    const D = this.debugCam;   // audits: { pos, target, fov } overrides the framing
    if (D) { this._placeLook(L.cam, D.pos, D.target, D.fov || 30, W * 0.5, H * 0.5, W, H); return; }
    const A = this._lobFrame(L.shot || 'lobby', W, H, this._fa || (this._fa = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 30, sx: 0, sy: 0 }));
    const gliding = L.shotFrom && L.shotT < GLIDE;
    if (gliding) {
      const B = this._lobFrame(L.shotFrom, W, H, this._fb || (this._fb = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 30, sx: 0, sy: 0 }));
      const k = eInOut(L.shotT / GLIDE);
      A.pos.lerpVectors(B.pos, A.pos, k); A.tgt.lerpVectors(B.tgt, A.tgt, k);
      A.fov = lerp(B.fov, A.fov, k); A.sx = lerp(B.sx, A.sx, k); A.sy = lerp(B.sy, A.sy, k);
    }
    // late layout changes ease in instead of snapping the framing
    const cs = L.cs || (L.cs = { fov: A.fov, sx: A.sx, sy: A.sy });
    const kk = gliding ? 1 : 1 - Math.exp(-7 * (this._fdt || 1 / 60));
    cs.fov += (A.fov - cs.fov) * kk; cs.sx += (A.sx - cs.sx) * kk; cs.sy += (A.sy - cs.sy) * kk;
    // the camera body never moves off the set's mark (the rivals' marks sit in the on-screen gaps between front heads
    // by bearing from it): breathing is a slow drift of the aim plus a whisper of zoom; the countdown leans in with the
    // lens, the launch tilts up after the jumpers
    let fov = cs.fov;
    if (!L.reduced) {
      A.tgt.x += 0.05 * Math.sin(t * 0.21) + 0.015 * Math.sin(t * 0.53 + 1);
      A.tgt.y += 0.028 * Math.sin(t * 0.17 + 2);
      A.tgt.z += 0.03 * Math.sin(t * 0.13 + 0.4);
      fov *= 1 + 0.006 * Math.sin(t * 0.19 + 2.1);
      if (L.shot === 'lobby') {
        if (L.setT >= 0) fov *= 1 - 0.05 * eInOut((t - L.setT) / 3);
        if (L.launchT >= 0) { const k = eInOut((t - L.launchT - 0.2) / 1.1); A.tgt.y += 1.4 * k; fov *= 1 - 0.03 * k; }
      }
    }
    this._placeLook(L.cam, A.pos, A.tgt, fov, cs.sx, cs.sy, W, H);
  }

  // 【摆机位】fov + 位置 + 看向目标 + setViewOffset(把 (sx,sy) 这一像素挪到画面中心),
  // 近远裁剪沿用场景相机的设定。
  _placeLook(cam, pos, tgt, fov, sx, sy, W, H) {
    const C = this.lob && this.lob.set && this.lob.set.camera;
    cam.fov = fov;
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(tgt);
    cam.near = (C && C.near) || 0.08; cam.far = (C && C.far) || 240;
    cam.setViewOffset(W, H, W * 0.5 - sx, H * 0.5 - sy, W, H);
    cam.updateMatrixWorld();
  }

  // framing for 'lobby' | 'hub' → o { pos, tgt, fov, sx, sy } (cached per layout)
  // 【取景求解】对 hub/lobby 各解一次并缓存(键含视口与 UI 四边):
  // 先按场景原始机位投影出主体的包围盒,再解缩放 z(主体放进空白区, clamp 0.55~2.6)、
  // 换算成 fov 与镜头偏移 sx/sy。lobby 还顺手量出前排每米像素数 kFront(DOM 名牌的缩放基准)。
  _lobFrame(kind, W, H, o) {
    const L = this.lob, S = L.set, C = kind === 'hub' ? S.hubCamera : S.camera;
    const U = kind === 'hub' ? this._measureHub(W, H) : this._measureLobby(W, H);
    if (kind === 'lobby') L.U = U;
    const key = `${W}x${H}:${Math.round(U.l)}:${Math.round(U.r)}:${Math.round(U.t)}:${Math.round(U.b)}`;
    let f = L.fits[kind];
    if (!f || f.key !== key) {
      const cam = L.cam;
      this._placeLook(cam, C.pos, C.target, C.fov, W * 0.5, H * 0.5, W, H);
      const bb = [1e9, -1e9, 1e9, -1e9];
      const add = (x, y, z) => {
        _v.set(x, y, z).project(cam);
        const px = (_v.x + 1) * 0.5 * W, py = (1 - _v.y) * 0.5 * H;
        bb[0] = Math.min(bb[0], px); bb[1] = Math.max(bb[1], px); bb[2] = Math.min(bb[2], py); bb[3] = Math.max(bb[3], py);
      };
      const u = Math.min(W * 0.01, H * 0.017778);
      let z, cx, cy;
      if (kind === 'hub') {
        const p = S.hubSpot.pos;
        add(p.x - 0.42, p.y, p.z); add(p.x + 0.42, p.y, p.z); add(p.x, p.y + CHAR_H, p.z); add(p.x, p.y - 0.05, p.z + 0.35);
        const bw = bb[1] - bb[0], bh = bb[3] - bb[2];
        const h = Math.min(0.5 * H, 0.88 * (U.b - U.t));
        z = Math.min(h / Math.max(1, bh), (0.8 * (U.r - U.l)) / Math.max(1, bw));
        cx = (U.l + U.r) * 0.5; cy = Math.min((U.t + U.b) * 0.5 + 0.03 * H, U.b - 0.5 * bh * z - 0.01 * H);
      } else {
        for (const sp of S.spots) {
          const p = sp.pos;
          add(p.x - 0.42, p.y - 0.05, p.z + 0.2); add(p.x + 0.42, p.y - 0.05, p.z + 0.2);
          add(p.x, p.y + PLATE_H, p.z);
        }
        const top = U.t + 4.2 * u;   // nameplates stand above the anchor
        const bw = bb[1] - bb[0], bh = bb[3] - bb[2];
        z = Math.min((U.r - U.l) / Math.max(1, bw), (U.b - top) / Math.max(1, bh));
        cx = (U.l + U.r) * 0.5; cy = (top + U.b) * 0.5;
      }
      z = Math.max(0.55, Math.min(2.6, z));
      const fov = (2 * Math.atan(Math.tan((C.fov * Math.PI) / 360) / z) * 180) / Math.PI;
      const bcx = W * 0.5 + ((bb[0] + bb[1]) * 0.5 - W * 0.5) * z, bcy = H * 0.5 + ((bb[2] + bb[3]) * 0.5 - H * 0.5) * z;
      f = L.fits[kind] = { key, fov, sx: W * 0.5 + (cx - bcx), sy: H * 0.5 + (cy - bcy) };
      if (kind === 'lobby') {
        // px per metre at your mark (the DOM nameplates scale against it)
        this._placeLook(cam, C.pos, C.target, f.fov, f.sx, f.sy, W, H);
        const p = S.spots[0].pos;
        _v.set(p.x, p.y + PLATE_H, p.z).project(cam);
        _d.setFromMatrixColumn(cam.matrixWorld, 0);
        _s.set(p.x, p.y + PLATE_H, p.z).add(_d).project(cam);
        L.kFront = Math.abs(_s.x - _v.x) * 0.5 * W;
      }
    }
    o.pos.copy(C.pos); o.tgt.copy(C.target); o.fov = f.fov; o.sx = f.sx; o.sy = f.sy;
    return o;
  }

  // 【量空白区·房间】从 DOM 量联机大厅界面的左(侧栏右缘)/右/上(顶栏与状态条)/下(底栏)边界,
  // 量不到就用样式公式兜底(u 为 vw/vh 换算单位)。1.5 s 轮询一次,resize 立即重量。
  _measureLobby(W, H) {
    const U = this.ui, L = this.lob;
    const u = Math.min(W * 0.01, H * 0.017778);
    if (!U.lob) U.lob = { l: 0, r: W, t: 0, b: H, next: 0 };
    const R = U.lob;
    if (R.W !== W || R.H !== H) { R.next = 0; R.W = W; R.H = H; }
    if (L.t >= R.next || R.next - L.t > 3) {
      R.next = L.t < 2 ? L.t + 0.25 : L.t + 1.5;
      const side = domBox('.iw-lobby:not(.is-leaving) .iw-lob__side');
      const bar = domBox('.iw-lobby:not(.is-leaving) .iw-lob__bar');
      const top = domBox('.iw-lobby:not(.is-leaving) .iw-lob__top'), stat = domBox('.iw-lobby:not(.is-leaving) .iw-lob__status');
      R.l = (side && side.r < W * 0.6 ? side.r : 3.6 * u + 27 * u) + 1.2 * u;
      R.r = W - 2.4 * u;
      R.t = Math.max(top && top.b < H * 0.4 ? top.b : 9 * u, stat && stat.b < H * 0.4 ? stat.b : 0) + 0.4 * u;
      R.b = (bar && bar.t > H * 0.5 ? bar.t : H - 13 * u) - 0.8 * u;
    }
    return R;
  }

  // 【量空白区·大厅】hub 的空白区:卡片右缘以右、名牌下方、装备/外观 chips 上方。
  _measureHub(W, H) {
    const U = this.ui, L = this.lob;
    const u = Math.min(W * 0.01, H * 0.017778);
    if (!U.hub) U.hub = { l: 0, r: W, t: 0, b: H, next: 0 };
    const R = U.hub;
    if (R.W !== W || R.H !== H) { R.next = 0; R.W = W; R.H = H; }
    if (L.t >= R.next || R.next - L.t > 3) {
      R.next = L.t < 2 ? L.t + 0.25 : L.t + 1.5;
      // right of the create / join cards, under your name tag, above the weapon / look chips
      const b = domBox('.iw-online:not(.is-leaving) .iw-hub__body');
      const tag = domBox('.iw-online:not(.is-leaving) .iw-hub__metag'), chips = domBox('.iw-online:not(.is-leaving) .iw-hub__chips');
      R.l = (b && b.r > W * 0.2 && b.r < W * 0.8 ? b.r : 3.6 * u + Math.min(50 * u, 0.54 * W)) + 1.2 * u;
      R.r = W - 2.4 * u;
      R.t = (tag && tag.b < H * 0.4 ? tag.b : 9 * u) + 0.6 * u;
      R.b = (chips && chips.t > H * 0.5 ? chips.t : H - 12 * u) - 0.8 * u;
    }
    return R;
  }

  // ---------------------------------------------------------------------------------------------- framing
  // 【UI 量取(摄影棚模式)】与后巷同款思路:从活 DOM 量面板右缘/标题右缘与下缘/分数带顶,
  // 带样式公式兜底;刚开场量得密(0.1/0.35/0.2 s),9 s 后停量。测量值经指数缓动逼近,
  // 迟到的布局变化不会硬拽相机。
  // Free screen areas come from the live DOM (layout boxes, transform-free) with stylesheet-formula fallbacks.
  _measureUI(W, H) {
    const U = this.ui;
    const u = Math.min(W * 0.01, H * 0.017778);
    if (U.W !== W || U.H !== H) { U.W = W; U.H = H; U.next = 0; }
    if (!U.s) U.s = { panelR: 0, titleR: 0, titleB: 0, bandB: 0 };
    if (this.t >= U.next) {
      U.next = this.t < 0.4 ? this.t + 0.1 : this.t < 1.5 ? this.t + 0.35 : this.t < 9 ? this.t + 0.2 : 1e9;
      U.panelR = 3.6 * u + Math.min(52 * u, 0.54 * W);
      U.titleR = 3.8 * u + 33.2 * u; U.titleB = 12.3 * u; U.bandB = 0.42 * H;
      const box = (sel) => {
        const list = document.querySelectorAll(sel);
        const el = list[list.length - 1];
        if (!el || !el.offsetParent) return null;
        let x = 0, y = 0;
        for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
        return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight };
      };
      if (PEDESTAL.has(this.mode) || PEDESTAL.has(this._lastMode)) {
        const b = box('.iw-locker:not(.is-leaving) .iw-locker__body') || box('.iw-loadout:not(.is-leaving) .iw-loadout__body') || box('.iw-online:not(.is-leaving) .iw-hub__body');
        if (b && b.r > W * 0.2 && b.r < W * 0.8) U.panelR = b.r;
      } else {
        const tt = box('.iw-results:not(.is-leaving) .iw-res__title'), hd = box('.iw-results:not(.is-leaving) .iw-res__head'), bd = box('.iw-results:not(.is-leaving) .iw-res__body');
        if (tt && tt.r < W * 0.75) U.titleR = tt.r;
        const tag = box('.iw-results:not(.is-leaving) .iw-res__metarow');
        if (hd && hd.b < H * 0.5) U.titleB = Math.min(hd.b, tag ? tag.b + 8 : hd.b);
        if (bd && bd.t > H * 0.25) U.bandB = bd.t;
        // podium moment: the scoreboard is still below the fold → frame the team big
        if (document.querySelector('.iw-results.is-intro:not(.is-leaving)')) U.bandB = H * 0.86;
      }
      if (U.stamp < 0) { U.s.panelR = U.panelR; U.s.titleR = U.titleR; U.s.titleB = U.titleB; U.s.bandB = U.bandB; }
      U.stamp = this.t;
    }
    // ease toward new measurements so a late layout never snaps the camera
    const k = 1 - Math.exp(-8 * (this._fdt || 0.016));
    U.s.panelR += (U.panelR - U.s.panelR) * k; U.s.titleR += (U.titleR - U.s.titleR) * k;
    U.s.titleB += (U.titleB - U.s.titleB) * k; U.s.bandB += (U.bandB - U.s.bandB) * k;
    return U.s;
  }

  // Orbit the focus point, aim at it, then lens-shift so the focus lands on screen pixel (sx, sy).
  // 【摆机位·摄影棚版】绕焦点轨道(偏航/俯仰/距离),看向焦点,镜头偏移把焦点投到屏幕 (sx, sy);
  // 可选滚转。近远裁剪按距离自适应。
  _place(focus, yaw, pitch, dist, fov, sx, sy, W, H, roll = 0) {
    const cam = this.camera, cp = Math.cos(pitch);
    cam.fov = fov;
    cam.position.set(focus.x + dist * Math.sin(yaw) * cp, focus.y - dist * Math.sin(pitch), focus.z + dist * Math.cos(yaw) * cp);
    cam.up.set(0, 1, 0);
    cam.lookAt(focus);
    if (roll) cam.rotateZ(roll);
    cam.near = Math.max(0.05, dist - 12); cam.far = dist + 14;
    cam.setViewOffset(W, H, W * 0.5 - sx, H * 0.5 - sy, W, H);
    cam.updateMatrixWorld();
  }

  // Pedestal framing for a mode → o { fy, yaw, pitch, dist, fov, sx, sy, roll }. Loadout: whole kid + pedestal in the free
  // area right of the panel. Locker: closer, a touch lower angle, the kid fills more of the frame (the look is the point).
  // 【展台取景】loadout:全身+展台放进面板右侧空白;locker:更近、视角更低(展示服装);
  // hub:人与台比例介于两者之间。入场 1.45 s 内从侧后方缓转到正面,之后叠慢速呼吸摆动;
  // 换武器跳触发镜头 punch(急推+回弹),换装 pop 轻微一推。
  _pedestalShot(mode, W, H, U, o) {
    const t = this.t, locker = mode === 'locker', hub = mode === 'hub';
    const fov = locker ? 23 : 25, tanH = Math.tan((fov * Math.PI) / 360);
    const freeL = U.panelR + W * 0.012, freeR = W * 0.985, freeW = Math.max(W * 0.18, freeR - freeL);
    const fy = locker ? 0.86 : LOAD_FOCUS_Y;
    const kV = ((locker ? 0.56 : hub ? 0.5 : 0.6) * H) / CHAR_H, kW = ((locker ? 0.98 : 0.84) * freeW) / (2 * (PED.R + PED.flange.out));
    const k = Math.min(kV, kW);
    let dist = H / (2 * k * tanH);
    const sx = (freeL + freeR) * 0.5, sy = (locker ? 0.8 : hub ? 0.68 : 0.735) * H - fy * k;
    const e = eOut3(t / 1.45);
    let yaw = 0.36 * (1 - e) + 0.03 * Math.sin(t * 0.41) * e;
    let pitch = (locker ? -0.07 : -0.1) - 0.05 * (1 - e) + 0.012 * Math.sin(t * 0.29 + 1.3) * e;
    dist *= 1 + 0.3 * (1 - e) + 0.012 * Math.sin(t * 0.23 + 2.1) * e;
    let roll = 0;
    const tw = t - this.hopT;
    if (tw >= 0 && tw < 1.6) { const p = punch(tw); dist *= 1 - 0.075 * p; yaw -= 0.035 * p; roll = 0.012 * wobble(tw, 11, 5); }
    const L = this.look;
    if (L && L.kind === 'pop') { const p = punch(t - L.t0, 26, 5); dist *= 1 - 0.035 * p; }
    o.fy = fy; o.yaw = yaw; o.pitch = pitch; o.dist = dist; o.fov = fov; o.sx = sx; o.sy = sy; o.roll = roll;
    return o;
  }

  // 【展台相机】loadout ⇄ locker 互切时,同一角色留在台上,相机按 0.75 s 在两档取景间滑移。
  _cameraPedestal(mode, W, H) {
    const U = this._measureUI(W, H);
    const A = this._pedestalShot(mode, W, H, U, this._shotA);
    // switching loadout ⇄ locker keeps the kid on stage and glides the camera between the two framings
    if (this.shotFrom && this.shotT < 0.75) {
      const B = this._pedestalShot(this.shotFrom, W, H, U, this._shotB);
      const k = eInOut(this.shotT / 0.75);
      for (const key of ['fy', 'yaw', 'pitch', 'dist', 'fov', 'sx', 'sy', 'roll']) A[key] = lerp(B[key], A[key], k);
    }
    this._place(this._tgt.set(0, A.fy, 0), A.yaw, A.pitch, A.dist, A.fov, A.sx, A.sy, W, H, A.roll);
  }

  // 【奖台取景】竖直:全队(含 0 号头顶空间)夹进顶部 5% 与分数带之间;水平:避开标题块、
  // 最多 8 次迭代收敛(必要时缩小)。入场 2.5 s 缓缓转正、13 s 后轻微前推(聚焦掌声)。
  _cameraResults(W, H) {
    const U = this._measureUI(W, H), t = this.t, won = this.won;
    const fov = 22, tanH = Math.tan((fov * Math.PI) / 360);
    const S0 = this.slots[0];
    const yFeet = S0.top, yHead = S0.top + CHAR_H + 0.28;
    const topPx = H * 0.05;
    const feetPx = Math.min(H * 0.66, Math.max(H * 0.34, U.bandB - H * 0.11));
    let k = (feetPx - topPx) / (yHead - yFeet);
    // horizontal: stay clear of the title block and inside the right edge
    let xL = 0, xR = 0, yTopL = yHead;
    for (const S of this.slots) {
      if (S.x - 0.42 < xL) { xL = S.x - 0.42; yTopL = S.top + CHAR_H + 0.28; }
      xR = Math.max(xR, S.x + S.R + 0.12);
    }
    let sx0 = W * 0.5;
    for (let it = 0; it < 8; it++) {
      sx0 = W * 0.5;
      const headL = feetPx - (yTopL - yFeet) * k;
      const left = sx0 + xL * k;
      if (headL < U.titleB + H * 0.01 && left < U.titleR + W * 0.012) sx0 += U.titleR + W * 0.012 - left;
      if (sx0 + xR * k > W * 0.975) { k *= 0.95; continue; }
      break;
    }
    const fy = yFeet + 0.55;
    const sy = feetPx - (fy - yFeet) * k;
    let dist = H / (2 * k * tanH);
    const e = eOut3(t / 2.5);
    const pitch0 = won ? -0.075 : -0.15;
    let yaw = -0.3 * (1 - e) + 0.02 * Math.sin(t * 0.33) * e;
    let pitch = pitch0 + 0.08 * (1 - e) + 0.007 * Math.sin(t * 0.21 + 1) * e;
    dist *= (1 + 0.32 * (1 - e)) * (1 - 0.045 * eInOut((t - 2.5) / 13));
    this._place(this._tgt.set(0, fy, 0), yaw, pitch, dist, fov, sx0, sy, W, H);
  }

  // ---------------------------------------------------------------------------------------------- portraits
  // 【菜单头像】给菜单磁贴出摄影棚小像:就在本场景同一套灯光下摆姿势(角色着色器已编译,
  // 且色调与展台一致),渲进小型 MSAA HDR 目标,经解析 pass 做色调映射 + sRGB(直出 alpha),
  // 读回 2D 画布。每帧最多一张,结果按请求键缓存(96 张上限)。
  // Studio portraits for menu tiles: the kid is posed in this same scene (same lights → the character shaders are already
  // compiled, and portraits match the pedestal look), rendered into a small MSAA HDR target, tone mapped + sRGB encoded
  // by a resolve pass (straight alpha, transparent background) and read back into a 2D canvas. One per frame; cached.
  // 【取像入口】缓存命中直接回调副本;否则入队(同键合并回调)。
  // 返回句柄带 cancel()——没人等的请求会被跳过,绝不白渲。
  portrait(req, cb) {
    const key = [req.kind || 'head', req.size | 0 || 128, '#' + this._c2.set(req.color || this.color).getHexString(), req.weapon || '',
      ...Object.keys(req.style || {}).sort().map((k) => `${k}:${req.style[k]}`)].join('|');
    const hit = this._pcache.get(key);
    if (hit) { cb(copyCanvas(hit)); return null; }
    let q = this._pq.find((x) => x.key === key);
    if (q) q.cbs.push(cb); else this._pq.push((q = { key, req: { ...req, style: { ...(req.style || {}) } }, cbs: [cb] }));
    // handle: cancel() drops this request (a job nobody waits for any more is skipped, never rendered)
    return { cancel: () => { const i = q.cbs.indexOf(cb); if (i >= 0) q.cbs.splice(i, 1); } };
  }

  // 【每帧一张】奖台模式(灯光被结果舞台占着)与热身未完成时让路;并发读回最多 2 张。
  // 渲染失败也走 finish(null),回调总能等到答复。
  _portraitStep() {
    // the podium lights are aimed at the results stage; portraits wait until it's gone. Shaders first (see _warmup).
    if (this.mode === 'results' || (!OVERLAY.has(this.mode) && this._out > 0 && this._lastMode === 'results')) return;
    if (this._warmState !== 'done' || (this._pflight || 0) >= 2) return;
    while (this._pq.length && !this._pq[0].cbs.length) this._pq.shift();
    const job = this._pq.shift();
    if (!job) return;
    const t0 = performance.now();
    let read = null;
    try { read = this._renderPortrait(job.req); } catch (e) { console.error('[showcase] portrait', e); }
    this.portraitMs = performance.now() - t0;
    const finish = (cv) => {
      if (cv) { this._pcache.set(job.key, cv); if (this._pcache.size > 96) this._pcache.delete(this._pcache.keys().next().value); }
      for (const cb of job.cbs) { try { cb(cv ? copyCanvas(cv) : null); } catch (e) { console.error('[showcase] portrait cb', e); } }
    };
    if (!read) { finish(null); return; }
    this._pflight = (this._pflight || 0) + 1;
    read.then((cv) => { this._pflight--; finish(cv); }, (e) => { this._pflight--; console.error('[showcase] portrait read', e); finish(null); });
  }

  _renderPortrait(req) {
    const r = this.r, S = Math.max(32, Math.min(512, req.size | 0 || 128)), kind = req.kind || 'head';
    this._renderPortraitSetup(S);
    // isolate the portrait kid in the showcase scene (lights stay)
    return this._renderPortraitRun(req, S, kind, r);
  }

  // 【头像目标与解析 pass】HDR 目标(4×MSAA HalfFloat)+ LDR 中转;解析材质内联了
  // three 的 NeutralToneMapping 与 sRGB 公式,保证头像与主画面同一条调色管线。
  _renderPortraitSetup(S) {
    if (!this._prt || this._prt.width !== S) {
      this._prt?.dispose(); this._prt8?.dispose();
      this._prt = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: 4 });
      this._prt8 = new THREE.WebGLRenderTarget(S, S, { depthBuffer: false });
    }
    if (!this._pres) {
      this._pres = new THREE.ShaderMaterial({
        uniforms: { tMap: { value: null }, uExposure: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: /* glsl */`
          uniform sampler2D tMap; uniform float uExposure; varying vec2 vUv;
          vec3 neutral(vec3 color) { // three.js NeutralToneMapping (the canvas' tone mapper), exposure applied
            const float S0 = 0.8 - 0.04; const float D = 0.15;
            color *= uExposure;
            float x = min(color.r, min(color.g, color.b));
            float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
            color -= off;
            float peak = max(color.r, max(color.g, color.b));
            if (peak < S0) return color;
            float d = 1. - S0;
            float np = 1. - d * d / (peak + d - S0);
            color *= np / peak;
            float g = 1. - 1. / (D * (peak - np) + 1.);
            return mix(color, vec3(np), g);
          }
          vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
          void main() {
            vec4 t = texture2D(tMap, vUv);
            float a = clamp(t.a, 0.0, 1.0);
            vec3 c = max(t.rgb, 0.0) / max(t.a, 1e-4);
            gl_FragColor = vec4(clamp(srgb(neutral(c)), 0.0, 1.0), a);
          }`,
        depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      });
      this._presScene = new THREE.Scene();
      const q = new THREE.Mesh(this.compQuad.geometry, this._pres); q.frustumCulled = false;
      this._presScene.add(q);
    }
  }

  // 【渲染流程】藏起场景里所有非灯光对象 → 空闲时把灯光指向展台位并染请求色 →
  // 建预览角色、摆舞蹈、热身 14 帧 → 小相机取景(四分之三侧面,主体略偏上给磁贴标签留位)→
  // 渲染到 HDR 目标 → 解析 pass 输出 sRGB+alpha → 异步读回(PBO+fence,不卡管线)→
  // 恢复渲染器与场景状态、角色销毁。行序读回翻转为图像行序后画进画布。
  _renderPortraitRun(req, S, kind, r) {
    const hidden = [];
    for (const o of this.scene.children) if (o.visible && !o.isLight) { o.visible = false; hidden.push(o); }
    const col = this._c2.set(req.color || this.color);
    const idle = !OVERLAY.has(this.mode) && !(this._out > 0);   // studio lights are free (the set has its own)
    const keep = this._c.copy(this.color);
    const keepCol = new THREE.Color().copy(keep);
    if (idle) { this._aimLights(this._tgt.set(0, 0.8, 0), 1, 'loadout'); this._setColor(col); }
    const c = new this.CharacterClass({ color: col.clone(), weapon: req.weapon || 'shooter', style: { ...req.style }, name: 'portrait', isLocal: false });
    const a = this._anim();
    c.setDance(kind === 'body' ? 'lobby_pose' : 'menu_idle');
    this.scene.add(c.root);
    for (let i = 0; i < 14; i++) { a.time = i / 30; c.update(1 / 30, a); }
    // framing
    const cam = this._pcam || (this._pcam = new THREE.PerspectiveCamera(18, 1, 0.05, 40));
    // three-quarter view from the kid's right (the key-lit side); tiles put a name label over the bottom ~25 %, so
    // the subject sits a little high in frame
    let fy, span, yaw = -0.4, pitch = -0.06, fx = 0, fz = 0;
    const fov = 18;
    if (kind === 'body') { fy = 0.72; span = 1.74; yaw = -0.3; pitch = -0.07; }
    else {
      c.getHeadPosition(this._pv);
      fx = this._pv.x; fz = this._pv.z;
      if (kind === 'bust') { fy = this._pv.y - 0.3; span = 1.2; }
      else if (kind === 'face') { fy = this._pv.y - 0.1; span = 0.5; pitch = -0.02; }
      else { fy = this._pv.y - 0.08; span = 0.64; }
    }
    const dist = span / 2 / Math.tan((fov * Math.PI) / 360);
    cam.fov = fov; cam.aspect = 1; cam.clearViewOffset();
    cam.position.set(fx + Math.sin(yaw) * Math.cos(pitch) * dist, fy - Math.sin(pitch) * dist, fz + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(fx, fy, fz);
    cam.near = Math.max(0.05, dist - 3); cam.far = dist + 3;
    cam.updateProjectionMatrix();
    // render → resolve → read back
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear, prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clr);
    r.autoClear = false;
    this.scene.environment = G.env?.envMap || null;
    this.scene.environmentIntensity = MOODS.loadout.env;
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this._prt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    this._pres.uniforms.tMap.value = this._prt.texture;
    this._pres.uniforms.uExposure.value = r.toneMappingExposure;
    r.setRenderTarget(this._prt8);
    r.render(this._presScene, this.compCam);
    // async read-back (PBO + fence): no GPU pipeline stall; the next portrait may reuse the target right away
    const buf = new Uint8Array(S * S * 4);
    const read = r.readRenderTargetPixelsAsync ? r.readRenderTargetPixelsAsync(this._prt8, 0, 0, S, S, buf) : Promise.resolve(r.readRenderTargetPixels(this._prt8, 0, 0, S, S, buf));
    this._pres.uniforms.tMap.value = null;
    r.setRenderTarget(prevRT);
    r.setClearColor(this._clr, prevAlpha);
    r.autoClear = prevAuto;
    r.shadowMap.needsUpdate = true; // the pedestal render after us needs its own shadow pass
    // restore
    this.scene.remove(c.root); c.dispose?.();
    for (const o of hidden) o.visible = true;
    if (idle) this._setColor(keepCol);
    return read.then(() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(S, S);
      const row = S * 4;
      for (let y = 0; y < S; y++) img.data.set(buf.subarray((S - 1 - y) * row, (S - y) * row), y * row);
      ctx.putImageData(img, 0, 0);
      return cv;
    });
  }

  // Compile every showcase shader (pedestal, ink, FX pools, a squidkid under these lights, the portrait resolve)
  // asynchronously once, right after boot, so the first loadout / locker / portrait never hitches on a compile.
  // 【着色器热身】boot 后一旦有环境贴图就异步编译展示台全部着色器:
  // 展台+墨衣+特效池+灯光下的角色+头像解析 pass。之后首次 loadout/locker/头像都不会卡在编译上。
  _warmup() {
    if (this._warmState) return;
    this._warmState = 'busy';
    const r = this.r;
    try {
      if (!this.stageL) this.stageL = this._buildLoadoutStage();
      const stageWas = this.stageL.group.visible;
      this.stageL.group.visible = true;
      const c = (this._warmChar = new this.CharacterClass({ color: this.color.clone(), weapon: 'shooter', style: this._profileStyle(), name: 'warm', isLocal: false }));
      this.scene.add(c.root);
      this._aimLights(this._tgt.set(0, 0.8, 0), 1, 'loadout');
      this.scene.environment = G.env?.envMap || null;
      this._place(this._tgt.set(0, 0.8, 0), 0, -0.1, 6, 25, innerWidth / 2, innerHeight / 2, innerWidth, innerHeight);
      this._renderPortraitSetup(128);
      const done = () => {
        if (this._warmChar) { this.scene.remove(this._warmChar.root); this._warmChar.dispose?.(); this._warmChar = null; }
        if (!PEDESTAL.has(this.mode)) this.stageL.group.visible = stageWas && PEDESTAL.has(this.mode);
        this._warmState = 'done';
      };
      const p1 = r.compileAsync ? r.compileAsync(this.scene, this.camera) : Promise.resolve(r.compile(this.scene, this.camera));
      const p2 = r.compileAsync ? r.compileAsync(this._presScene, this.compCam) : Promise.resolve(r.compile(this._presScene, this.compCam));
      Promise.all([p1, p2]).then(done, (e) => { console.warn('[showcase] warm-up', e); done(); });
    } catch (e) { console.warn('[showcase] warm-up', e); this._warmState = 'done'; }
  }

  // ---------------------------------------------------------------------------------------------- render
  // 【渲染目标】优先借后处理合成器的 writeBuffer(帧输出后它已闲置,白捡);兼容条件:
  // 带深度、MSAA 样本够、HDR 格式、尺寸一致。借不到就用自己的 4×MSAA HalfFloat 目标。
  // MSAA HDR target: the composer's spare ping-pong buffer when it matches the canvas, else a private one.
  _target() {
    const r = this.r;
    r.getDrawingBufferSize(this._dbs);
    const w = this._dbs.x, h = this._dbs.y;
    const comp = G.post?.composer;
    const b = comp && comp.writeBuffer;
    // the composer's buffers are single-sampled on Apple GPUs (SMAA runs there instead), but the showcase is composited
    // after the post chain, so it keeps its own 4× target to stay anti-aliased
    const want = (G.post?.q?.msaa ?? 4) > 0 ? G.post?.samples || 4 : 0;
    if (b && b.isWebGLRenderTarget && b.depthBuffer && (b.samples || 0) >= want && b.texture.type !== THREE.UnsignedByteType && Math.abs(b.width - w) <= 1 && Math.abs(b.height - h) <= 1) {
      if (this._rt) { this._rt.dispose(); this._rt = null; }
      return b;
    }
    if (!this._rt) this._rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: want ? 4 : 0 });
    else if (this._rt.width !== w || this._rt.height !== h) this._rt.setSize(w, h);
    return this._rt;
  }

  // Two layers, each rendered into the MSAA HDR target and composited: the lobby set (its own scene + camera; opaque,
  // dissolving with whatever is under it — or, while it covers the frame, drawn over a cleared canvas because main.js
  // skipped the world), then the studio overlay (pedestal / podium, premultiplied over the frame).
  // 【主渲染】两层各自渲进 HDR 目标再用合成 pass 叠加:
  // ① 后巷(自己的场景+相机;盖住全帧时底下的世界被跳过,直接清屏画它,否则按 k 溶解);
  // ② 摄影棚叠加(展台/奖台,按 fadeIn/_out 决定透明度,预乘叠加)。
  // 全程保存并还原渲染器状态(目标、清屏色、autoClear)。
  render() {
    if (this._pq.length) this._portraitStep();
    const r = this.r, mobileBoss = !!globalThis.inkwaveMobile && !!G.match?.boss && G.mode === 'match';
    let W, H;
    // 手机Boss实战通常没有展台；先确认需要绘制，再读取会触发布局的窗口尺寸。
    if (!mobileBoss) { W = innerWidth; H = innerHeight; }
    this._fdt = 1 / 60;
    const L = this.lob, setA = L && L.ready && L.set ? L.k : 0;
    const om = OVERLAY.has(this.mode) ? this.mode : this._out > 0 ? this._lastMode : null;
    const ov = !!(om && this.chars.length);
    if (setA <= 0 && !ov) return;
    if (mobileBoss) { W = innerWidth; H = innerHeight; }
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear, prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clr);
    r.autoClear = false;
    const target = this._target();
    if (setA > 0) {
      this._lobCamera(W, H);
      this._lobEnv(L);
      r.shadowMap.needsUpdate = true;
      r.setRenderTarget(target);
      r.setClearColor(L.bg, 1);
      r.clear(true, true, false);
      r.render(L.scene, L.cam);
      r.setRenderTarget(prevRT);
      const covered = this._ffFrame;   // nothing was drawn under us this frame
      if (covered) { r.setClearColor(0x000000, 1); r.clear(true, false, false); }
      this.compMat.uniforms.tMap.value = target.texture;
      this.compMat.uniforms.uOpacity.value = covered ? 1 : eInOut(setA);
      r.render(this.compScene, this.compCam);
    }
    if (ov) {
      if (PEDESTAL.has(om)) this._cameraPedestal(om, W, H); else this._cameraResults(W, H);
      this.scene.environment = G.env?.envMap || null;
      this.scene.environmentIntensity = (this.mood || MOODS.loadout).env;
      const opacity = OVERLAY.has(this.mode) ? eOut3(this.fadeIn) : c01(this._out / (this._outDur || 0.2));
      r.shadowMap.needsUpdate = true;
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(this.scene, this.camera);
      r.setRenderTarget(prevRT);
      this.compMat.uniforms.tMap.value = target.texture;
      this.compMat.uniforms.uOpacity.value = opacity;
      r.render(this.compScene, this.compCam);
    }
    this.compMat.uniforms.tMap.value = null;
    r.setClearColor(this._clr, prevAlpha);
    r.autoClear = prevAuto;
  }
}
const _c1 = new THREE.Color();
// 【DOM 量框】取选择器最后一个匹配元素的布局盒(沿 offsetParent 累加,不含 transform——
// 动画中的面板量到的是它最终要落的位置)。供 UI 空白区测量。
// a live layout box (offset chain: transform-free, so mid-animation panels measure where they will rest)
function domBox(sel) {
  const list = document.querySelectorAll(sel);
  const el = list[list.length - 1];
  if (!el || !el.offsetParent) return null;
  let x = 0, y = 0;
  for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
  return { l: x, t: y, r: x + el.offsetWidth, b: y + el.offsetHeight };
}
// 【外观指纹】style 对象排序序列化,用于快速比较两次换装是否同款。
const styleKey = (st) => (st && typeof st === 'object' ? Object.keys(st).sort().map((k) => `${k}:${st[k]}`).join('|') : '');
// 【武器归类】WEAPONS 表查武器大类(如 shooter/roller),查不到就用原 id 兜底。
const weaponKind = (id) => (WEAPONS[id] && WEAPONS[id].kind) || id || 'shooter';
// 【画布深拷贝】缓存的头像只发副本,调用方随便改。
function copyCanvas(src) {
  const d = document.createElement('canvas');
  d.width = src.width; d.height = src.height;
  d.getContext('2d').drawImage(src, 0, 0);
  return d;
}
