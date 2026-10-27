// 预先排期三个互不重叠的1秒Trace，避免交互调用延迟将“移除”误采成“恢复”。只附着现有转发。
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const rows = await Promise.all([['original', 9], ['removed', 22], ['restored', 35]].map(([phase, start]) => new Promise(resolve => {
  const child = spawn(process.execPath, ['tools/trace-phone-boss.mjs'], { windowsHide: true, env: { ...process.env,
    BOSS_TRACE_MAIN_STAGES: '1', BOSS_TRACE_INVALIDATIONS: '1', BOSS_TRACE_RENDERING: '0', BOSS_TRACE_SECONDS: '1',
    BOSS_TRACE_START_SECONDS: String(start), BOSS_TRACE_STYLE_PHASE: phase } });
  let out = '', error = '';
  child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { error += b; });
  child.on('error', e => { error += String(e); });
  child.on('close', async code => {
    await writeFile(`releases/investigation/style-window-${phase}.run.log`, out + error);
    let result; try { result = JSON.parse(out); } catch { result = { error: error || '未生成JSON' }; }
    resolve({ phase, code, path: result.path, status: result.status, stylePhase: result.stylePhase, startState: result.startState, endState: result.endState, eventsTruncated: result.eventsTruncated, dataLossOccurred: result.dataLossOccurred, error: result.error });
  });
})));
await writeFile('releases/investigation/style-windows.json', JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows));
if (rows.some(r => r.code !== 0 || r.status !== 'collected' || r.stylePhase !== r.phase || r.eventsTruncated || r.dataLossOccurred !== false)) process.exitCode = 1;
