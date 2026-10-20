// 安卓网页构建：保留模块目录，动态入口与资源 URL 不再依赖开发服务器。
import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-mobile');
if (relative(root, out) !== 'dist-mobile') throw new Error('拒绝清理非移动产物目录');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const entries = [];
async function scan(dir) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, f.name);
    if (f.isDirectory()) await scan(p);
    else if (f.name.endsWith('.js')) entries.push(p);
  }
}
await scan(resolve(root, 'src'));
// 所有入口保留 src 层级；共享块也放在两层目录，兼容既有 ../../assets URL。
await build({
  absWorkingDir: root, entryPoints: [...entries, 'mobile-entry.js'], outbase: root,
  outdir: out, bundle: true, splitting: true, format: 'esm', target: 'chrome110',
  entryNames: '[dir]/[name]', chunkNames: 'src/chunks/[name]-[hash]',
  alias: { 'three/addons': resolve(root, 'vendor/three/jsm'), three: resolve(root, 'vendor/three/build/three.module.js') },
  minify: false, legalComments: 'eof', logLevel: 'warning',
});
for (const dir of ['assets', 'styles']) await cp(resolve(root, dir), resolve(out, dir), { recursive: true });
// 私人音乐不打包，提供空清单以免启动产生无意义的 404。
await mkdir(resolve(out, 'songs'), { recursive: true });
await writeFile(resolve(out, 'songs/manifest.json'), '{}\n');
let html = await readFile(resolve(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '')
  .replace('src="./src/main.js"', 'src="./mobile-entry.js"')
  .replace('</head>', '<link rel="stylesheet" href="styles/mobile.css">\n</head>')
  .replace('user-scalable=no', 'user-scalable=no, viewport-fit=cover');
await writeFile(resolve(out, 'index.html'), html);
console.log('移动网页已生成：dist-mobile（全部资源内置）');
