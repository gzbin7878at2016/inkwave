// 检查交付产物而非仅检查开关值：测试入口、采样器与诊断页面不能进入手动包。
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root = resolve('dist-mobile');
const stamp = JSON.parse(await readFile(resolve(root, 'build-info.json'), 'utf8'));
assert.equal(stamp.diagnostics, false);
assert.equal(stamp.distribution, 'manual');
const forbidden = ['inkwave-android-diagnostics-v1', 'GameDiagnostics', 'inkwave.diagnostics.last',
  '__inkwave', '__G', 'paintRandom', 'freezeBots', 'netlag', 'netjitter', 'netspike',
  'mobile-log-upload', 'mobile-log-export', 'data-mobile="stats"', 'data-mobile="export"'];
let count = 0;
async function scan(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, file.name);
    if (file.isDirectory()) await scan(p);
    else if (/\.(js|html)$/.test(file.name)) {
      const name = relative(root, p).replaceAll('\\', '/');
      assert.ok(!/diagnostics|mobileProfiler|net\/mock|probe\.html/i.test(name), name);
      const text = await readFile(p, 'utf8');
      for (const token of forbidden) assert.ok(!text.includes(token), `${name}残留测试入口：${token}`);
      count++;
    }
  }
}
await scan(root);
console.log(`通过：${count}份手动网页代码/页面不含诊断模块、采样器及列出的测试入口`);
