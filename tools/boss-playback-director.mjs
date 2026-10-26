// 仅测试输入生成器。可toString交给手机；只写input.keys/mouse和rig瞄准角，绝不写Actor/Boss物理或战斗状态。
export function createBossPlaybackDirector(game, G, actions) {
  let enabled = true, match = null, actor = null, vectors = null, target = null, route = null, ri = 1;
  let nextTarget = 0, nextPlan = 0, nextThreat = 0, lastCheck = 0, checkX = 0, checkZ = 0, recovering = 0, side = 1;
  let refill = false, nextSpecial = 0, lastPos = null, wasAlive = false, threatJump = false, threatDive = false, stationarySince = 0;
  const stats = { revision: 1, steps: 0, pathPlans: 0, pathSuccess: 0, pathFallbacks: 0, targetSamples: 0, targetChanges: 0,
    stuckRecoveries: 0, movedFrames: 0, distanceTravelled: 0, weakAimFrames: 0, refillFrames: 0, phaseMask: 0,
    minBossDistance: 1e9, bossDamage: 0, weakHits: 0, maxStillSeconds: 0 };
  let startDamage = 0, startWeak = 0;
  const stop = () => { game.input.keys.clear(); game.input.mouse.left = false; };
  const bind = next => {
    match = next; actor = next?.local; route = target = null; ri = 1; nextTarget = nextPlan = nextThreat = 0;
    lastPos = null; wasAlive = false; refill = false; recovering = 0; lastCheck = 0;
    if (actor) {
      vectors = [actor.pos.clone(), actor.pos.clone(), actor.pos.clone()];
      startDamage = actor.stats?.bossDmg || 0; startWeak = actor.stats?.weakHits || 0;
    }
  };
  const chooseTarget = boss => {
    const eye = vectors[0].copy(actor.pos); eye.y += 1.2;
    let chosen = null, best = 1e9;
    for (const crab of boss.crabs?.values?.() || []) {
      if (crab.dead) continue;
      const distance = Math.hypot(crab.x - actor.pos.x, crab.z - actor.pos.z);
      if (distance < 4 && distance < best && (!G.physics?.los || G.physics.los(eye, vectors[1].set(crab.x, crab.y + .35, crab.z)))) {
        chosen = { crab, weak: false, name: 'crablet', los: true }; best = distance;
      }
    }
    if (!chosen && boss.visible && !boss.dead) {
      const shapes = (boss.model?.hitShapes || []).filter(shape => shape.active);
      const score = shape => (shape.socket === 'belly' && shape.weak ? -200 : shape.weak ? -100 : 0) + eye.distanceTo(shape.pos);
      shapes.sort((a, b) => score(a) - score(b));
      // 与原Bot相同的启用形体/视线语义；额外确认弱点没被本体或小怪挡住。
      for (const shape of shapes) {
        if (G.physics?.los && !G.physics.los(eye, shape.pos)) continue;
        const hit = boss.segHit?.(eye, shape.pos, 0);
        if (shape.weak && hit && !hit.weak) continue;
        chosen = { shape, weak: !!shape.weak, name: shape.socket, los: true }; break;
      }
      chosen ||= shapes.length ? { shape: shapes.find(shape => !shape.weak) || shapes[0], weak: false, name: 'blocked-body', los: false } : null;
    }
    stats.targetSamples++;
    if ((chosen?.shape || chosen?.crab) !== (target?.shape || target?.crab)) stats.targetChanges++;
    target = chosen;
  };
  const plan = (boss, radius) => {
    route = null; ri = 1; stats.pathPlans++;
    const nav = G.nav; if (!nav?.nearest || !nav.path) return;
    const start = nav.nearest(actor.pos, .8, true); if (start < 0) return;
    const candidates = [];
    for (const offset of [-1.2, 1.2, -2.2, 2.2, Math.PI, 0]) {
      const angle = boss.yaw + offset;
      const point = vectors[1].set(boss.pos.x + Math.sin(angle) * radius, boss.pos.y + .5, boss.pos.z + Math.cos(angle) * radius);
      const id = nav.nearest(point, 2.5), node = nav.nodes[id];
      if (!node || node.wet === 2 || node.zone >= 0 && node.zone !== actor.team) continue;
      candidates.push({ id, score: Math.hypot(node.x - actor.pos.x, node.z - actor.pos.z) + (node.wet ? 3 : 0) });
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const candidate of candidates) {
      const path = nav.path(start, candidate.id, actor.team, 2000, true);
      if (path?.length > 1) { route = path; stats.pathSuccess++; break; }
    }
    if (!route) {
      const neighbours = (nav.nodes[start]?.nb || []).filter(edge => {
        const n = nav.nodes[edge.to]; return edge.type !== 'climb' && n && n.wet !== 2 && (n.zone < 0 || n.zone === actor.team);
      });
      neighbours.sort((a, b) => Math.hypot(nav.nodes[a.to].x - boss.pos.x, nav.nodes[a.to].z - boss.pos.z) - Math.hypot(nav.nodes[b.to].x - boss.pos.x, nav.nodes[b.to].z - boss.pos.z));
      if (neighbours.length) { route = [start, neighbours[0].to]; stats.pathFallbacks++; }
    }
  };
  const step = (activeMs, dt) => {
    const m = game.match, a = m?.local, boss = m?.boss;
    if (!enabled || activeMs === null || G.mode !== 'match' || !boss || m.attract || m.state !== 'playing' || m.paused) { stop(); return; }
    if (m !== match || a !== actor) bind(m);
    const phase = boss.phase; if (phase >= 1 && phase <= 3) stats.phaseMask |= 1 << phase;
    if (!a?.alive || !vectors) { stop(); wasAlive = false; lastPos = null; route = null; return; }
    const t = activeMs / 1000; stats.steps++; stop();
    if (!wasAlive) { lastCheck = stationarySince = t; checkX = a.pos.x; checkZ = a.pos.z; nextPlan = nextTarget = 0; }
    wasAlive = true;
    if (lastPos) {
      const distance = Math.hypot(a.pos.x - lastPos.x, a.pos.z - lastPos.z);
      // 排除复活跨图跳变；真实移动/击退仍来自原模拟，不由工具写位置。
      if (distance < 4) { stats.distanceTravelled += distance; if (distance > .025) { stats.movedFrames++; stationarySince = t; } }
    }
    stats.maxStillSeconds = Math.max(stats.maxStillSeconds, t - stationarySince);
    lastPos ||= { x: a.pos.x, z: a.pos.z }; lastPos.x = a.pos.x; lastPos.z = a.pos.z;
    stats.bossDamage = Math.max(0, (a.stats?.bossDmg || 0) - startDamage);
    stats.weakHits = Math.max(0, (a.stats?.weakHits || 0) - startWeak);
    const dx = boss.pos.x - a.pos.x, dz = boss.pos.z - a.pos.z, distance = Math.hypot(dx, dz);
    stats.minBossDistance = Math.min(stats.minBossDistance, distance);
    const reach = Math.max(7, Math.min(12, (a.weapon?.range || 12.5) * .65 + 2));
    if (t >= nextTarget || target?.shape && !target.shape.active || target?.crab?.dead) { chooseTarget(boss); nextTarget = t + .25; }
    const aim = vectors[2];
    if (target?.crab) aim.set(target.crab.x, target.crab.y + .35, target.crab.z);
    else if (target?.shape) aim.copy(target.shape.pos);
    else aim.copy(boss.pos).setY(boss.pos.y + 2.5);
    const cam = game.rig.gameCam || G.camera;
    const cameraNear = cam?.position && Math.hypot(cam.position.x - a.pos.x, cam.position.z - a.pos.z) < 12;
    const origin = cameraNear ? cam.position : vectors[0].copy(a.pos).setY(a.pos.y + 1.2);
    const ax = aim.x - origin.x, ay = aim.y - origin.y, az = aim.z - origin.z;
    const yaw = Math.atan2(ax, az), pitch = Math.atan2(ay, Math.max(.001, Math.hypot(ax, az)));
    const delta = Math.atan2(Math.sin(yaw - game.rig.yaw), Math.cos(yaw - game.rig.yaw)), turn = Math.max(.01, Math.min(.05, dt)) * 9;
    game.rig.yaw += Math.max(-turn, Math.min(turn, delta));
    game.rig.pitch += Math.max(-turn, Math.min(turn, Math.max(-1.05, Math.min(1.15, pitch)) - game.rig.pitch));
    if (target?.weak) stats.weakAimFrames++;
    if (t - lastCheck >= 1.2) {
      const travelled = Math.hypot(a.pos.x - checkX, a.pos.z - checkZ);
      if (travelled < .3 && distance > 5) { stats.stuckRecoveries++; recovering = t + 1.1; side *= -1; nextPlan = recovering; route = null; stats.maxStillSeconds = Math.max(stats.maxStillSeconds, t - lastCheck); }
      checkX = a.pos.x; checkZ = a.pos.z; lastCheck = t;
    }
    if (t >= nextPlan && t >= recovering) { plan(boss, reach); nextPlan = t + 2; }
    let mx, mz, edge = null;
    if (recovering > t) {
      mx = -dz * side; mz = dx * side;
    } else if (route && ri < route.length) {
      const nav = G.nav;
      while (ri < route.length - 1 && Math.hypot(nav.nodes[route[ri]].x - a.pos.x, nav.nodes[route[ri]].z - a.pos.z) < .9 && Math.abs(nav.nodes[route[ri]].y - a.pos.y) < 1) ri++;
      const next = nav.nodes[route[ri]]; mx = next.x - a.pos.x; mz = next.z - a.pos.z; edge = nav.edge?.(route[ri - 1], route[ri]);
      if (Math.hypot(mx, mz) < .9 && ri === route.length - 1) route = null;
    } else if (distance > reach + 2) { mx = dx; mz = dz; }
    else { const orbit = Math.floor(t / 4) % 2 ? -1 : 1; mx = -dz * orbit; mz = dx * orbit; if (distance < 6) { mx -= dx; mz -= dz; } }
    if (t >= nextThreat) {
      const threat = boss.hz?.threat?.(a.pos.x, a.pos.y, a.pos.z, 1.4);
      threatJump = !!threat && threat.ringIn >= 0 && threat.ringIn < .45;
      threatDive = !!threat?.beam && a.groundTeam === a.team + 1;
      nextThreat = t + .1;
    }
    const length = Math.hypot(mx, mz) || 1, sy = Math.sin(game.rig.yaw), cy = Math.cos(game.rig.yaw);
    const forward = (mx * sy + mz * cy) / length, right = (-mx * cy + mz * sy) / length;
    if (forward > .35) game.input.keys.add('KeyW'); if (forward < -.35) game.input.keys.add('KeyS');
    if (right > .35) game.input.keys.add('KeyD'); if (right < -.35) game.input.keys.add('KeyA'); actions.move++;
    if (a.ink < 18) refill = true; if (a.ink > 85) refill = false;
    if (refill || threatDive) { game.input.keys.add('ShiftLeft'); actions.squid++; stats.refillFrames++; }
    else if (target && (target.crab || boss.visible) && target.los
      && Math.hypot(aim.x - a.pos.x, aim.z - a.pos.z) - (target.shape?.r || .5) <= (a.weapon?.range || 12.5) + .5) { game.input.mouse.left = true; actions.fire++; }
    if (threatJump || recovering > t || edge?.type === 'jump' || t % 5 < .2) { game.input.keys.add('Space'); actions.jump++; }
    if (!refill && distance < 16 && a.ink > 65 && t % 12 > 8 && t % 12 < 8.15) { game.input.keys.add('KeyE'); actions.sub++; }
    const cost = a.specialCost?.() || 1000;
    if (!refill && !a.specialActive && a.special >= cost && t >= nextSpecial) { game.input.keys.add('KeyQ'); actions.special++; nextSpecial = t + 3; }
  };
  return { bind, step, info: () => ({ ...stats,
    bossDamage: Math.max(0, (actor?.stats?.bossDmg || 0) - startDamage), weakHits: Math.max(0, (actor?.stats?.weakHits || 0) - startWeak),
    phases: [1, 2, 3].filter(phase => stats.phaseMask & 1 << phase),
    refill, target: target?.name || null, routeRemaining: route ? route.length - ri : 0 }), dispose() { enabled = false; stop(); } };
}
