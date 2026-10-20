// 【中文导读】跨平台 JavaScript 语法检查入口；Windows 不依赖 Bash 的 for/find。
// 只使用 Node 内置模块，不执行游戏代码、不访问网络、不生成构建文件。
// 显式扫描项目源码目录，排除 vendor/node_modules，避免把第三方代码混入维护范围。
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['src', 'electron', 'build', 'tools', 'server/src'];
const files = [];

// 不依赖调用者当前目录；按名称排序，让本机和 CI 的错误输出保持稳定。
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', 'vendor', '.git'].includes(entry.name)) collect(path);
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path);
  }
}

try {
  for (const directory of roots) collect(join(root, directory));
  // 用参数数组调用当前 Node，路径中的空格不会被 shell 再次解释；首个失败即返回非零。
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(`syntax failed: ${relative(root, file)}`);
      process.exitCode = result.status || 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`syntax ok (${files.length} files)`);
} catch (error) {
  // 目录缺失或子进程启动失败同样是检查失败，不允许输出一个误导性的“通过”。
  console.error(error.message);
  process.exitCode = 1;
}
