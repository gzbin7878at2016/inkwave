# 中文说明：更新固定手机下载入口；仅发布已构建APK，不重新编译。
param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [string]$BuildInfoPath = (Join-Path $PSScriptRoot '../releases/android-build-info.json')
)
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
$mobileInfo = Get-Content -LiteralPath $BuildInfoPath -Raw | ConvertFrom-Json
$mobileApk = Get-Item -LiteralPath $ApkPath
$mobileHash = (Get-FileHash -LiteralPath $mobileApk.FullName -Algorithm SHA256).Hash.ToLower()
if ($mobileHash -ne $mobileInfo.sha256) { throw 'APK哈希与构建记录不一致，拒绝更新下载入口' }
$mobileDirectory = Join-Path $mobileRoot 'releases/mobile-install'
New-Item -ItemType Directory -Path $mobileDirectory -Force | Out-Null
$mobileTemporary = Join-Path $mobileDirectory ('latest-' + [guid]::NewGuid().ToString('N') + '.part')
Copy-Item -LiteralPath $mobileApk.FullName -Destination $mobileTemporary
Move-Item -LiteralPath $mobileTemporary -Destination (Join-Path $mobileDirectory 'INKWAVE-latest.apk') -Force
$mobileVersion = [System.Net.WebUtility]::HtmlEncode([string]$mobileInfo.version)
$mobileTest = [int]$mobileInfo.versionCode
$mobileCommit = [System.Net.WebUtility]::HtmlEncode(([string]$mobileInfo.sourceCommit).Substring(0, 7))
$mobileDate = [System.Net.WebUtility]::HtmlEncode([string]$mobileInfo.builtAt)
$mobileSize = '{0:N1}' -f ($mobileApk.Length / 1MB)
$mobileLabel = if ($mobileInfo.distribution -eq 'manual') { '手动游玩版' } else { '测试版' }
$mobileNote = if ($mobileInfo.distribution -eq 'manual') { '本包供手动游玩，不含诊断报告导出或上传。' } else { '下载和上传日志时，电脑需保持开机，手机与电脑连接同一 Wi-Fi。' }
$mobileHtml = @"
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>INKWAVE 手机$mobileLabel</title>
<style>body{margin:0;background:#111827;color:#f8fafc;font:16px/1.7 system-ui,sans-serif}main{max-width:480px;margin:8vh auto;padding:28px}h1{font-size:30px;line-height:1.2}p{color:#cbd5e1;overflow-wrap:anywhere}.download,button{display:block;box-sizing:border-box;width:100%;padding:14px 18px;border-radius:12px;text-align:center;font:600 17px system-ui}.download{background:#38bdf8;color:#082f49;text-decoration:none;margin:24px 0 12px}button{border:1px solid #475569;background:transparent;color:white}.meta{font-size:14px}.note{margin-top:24px}</style></head>
<body><main><h1>INKWAVE<br>手机$mobileLabel</h1><p>收藏本页。以后刷新这里，就能下载最新安装包。</p>
<p class="meta">当前版本：v$mobileVersion · $mobileLabel · code$mobileTest<br>源码：$mobileCommit · $mobileSize MB<br>打包时间：$mobileDate</p>
<a class="download" href="INKWAVE-latest.apk?v=$mobileHash" download="INKWAVE-latest.apk">下载并安装最新版</a>
<button type="button" onclick="location.reload()">刷新版本</button>
<p class="note">下载后点击 APK 安装；若提示签名冲突，请先联系开发者，不要直接卸载旧版丢失进度。$mobileNote</p>
</main></body></html>
"@
$mobileHtml | Set-Content -LiteralPath (Join-Path $mobileDirectory 'index.html.part') -Encoding utf8
Move-Item -LiteralPath (Join-Path $mobileDirectory 'index.html.part') -Destination (Join-Path $mobileDirectory 'index.html') -Force
Write-Host '固定下载入口已更新：/ 和 /INKWAVE-latest.apk'
