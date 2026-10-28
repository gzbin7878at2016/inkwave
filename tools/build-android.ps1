# 中文说明：生成可侧载测试 APK。只为本次进程设置工具链，不修改用户 Java/UE4 环境。
param(
    [string]$JdkPath = "$env:USERPROFILE/.cache/demoink-android/ms-jdk/jdk-21.0.12.1+1",
    [string]$SdkPath = "$env:USERPROFILE/.cache/demoink-android/sdk",
    [switch]$Manual
)
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
Push-Location $mobileRoot
$previousManualBuild = $env:INKWAVE_MANUAL_BUILD
try {
    $env:INKWAVE_MANUAL_BUILD = if ($Manual) { '1' } else { '0' }
    if (!(Test-Path -LiteralPath "$JdkPath/bin/java.exe")) { throw '未找到 JDK 21，请用 -JdkPath 指定路径' }
    if (!(Test-Path -LiteralPath "$SdkPath/platforms/android-36/android.jar")) { throw '未找到 API 36，请用 -SdkPath 指定 SDK 根目录' }
    $env:JAVA_HOME = (Resolve-Path -LiteralPath $JdkPath).Path
    $env:ANDROID_HOME = (Resolve-Path -LiteralPath $SdkPath).Path
    $env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
    $mobileSdkForward = $env:ANDROID_HOME.Replace('\', '/')
    "sdk.dir=$mobileSdkForward" | Set-Content -LiteralPath android/local.properties -Encoding ascii
    & npm.cmd run check
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript 语法检查失败' }
    & node tools/check-mobile-network.mjs
    if ($LASTEXITCODE -ne 0) { throw '移动网络回归失败' }
    & npm.cmd run sync:android
    if ($LASTEXITCODE -ne 0) { throw '移动资产构建/同步失败' }
    if ($Manual) {
        # 手动包关闭WebView远程调试；配置只写入本次同步产物。
        $manualConfigPath = Join-Path $mobileRoot 'android/app/src/main/assets/capacitor.config.json'
        $manualConfig = Get-Content -LiteralPath $manualConfigPath -Raw | ConvertFrom-Json
        $manualConfig.android | Add-Member -NotePropertyName webContentsDebuggingEnabled -NotePropertyValue $false -Force
        $manualConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manualConfigPath -Encoding utf8
        & node tools/check-manual-build.mjs
        if ($LASTEXITCODE -ne 0) { throw '手动包测试功能排除检查失败' }
        & ./android/gradlew.bat -p android assembleRelease -PinkwaveManual=true --console=plain
    } else {
        & ./android/gradlew.bat -p android assembleDebug --console=plain
    }
    if ($LASTEXITCODE -ne 0) { throw 'APK 构建失败' }
    $mobileApk = Join-Path $mobileRoot $(if ($Manual) { 'android/app/build/outputs/apk/release/app-release.apk' } else { 'android/app/build/outputs/apk/debug/app-debug.apk' })
    $mobileSigner = Get-ChildItem -LiteralPath "$SdkPath/build-tools" -Filter apksigner.bat -Recurse | Sort-Object FullName -Descending | Select-Object -First 1
    if (!$mobileSigner) { throw 'SDK 缺少 apksigner' }
    & $mobileSigner.FullName verify --verbose $mobileApk
    if ($LASTEXITCODE -ne 0) { throw 'APK 签名校验失败' }
    New-Item -ItemType Directory -Path releases -Force | Out-Null
    $mobileCommit = (& git rev-parse --short HEAD).Trim()
    $mobileGradle = Get-Content -LiteralPath android/app/build.gradle -Raw
    $mobileVersionCode = [regex]::Match($mobileGradle, 'versionCode\s+(\d+)').Groups[1].Value
    $mobileVersion = [regex]::Match($mobileGradle, 'versionName\s+"([^"]+)"').Groups[1].Value
    $mobileKind = if ($Manual) { 'manual' } else { 'test' }
    $mobileOutput = Join-Path $mobileRoot "releases/INKWAVE-android-$mobileKind$mobileVersionCode-$mobileCommit.apk"
    Copy-Item -LiteralPath $mobileApk -Destination $mobileOutput -Force
    $mobileHash = (Get-FileHash -LiteralPath $mobileOutput -Algorithm SHA256).Hash.ToLower()
    "$mobileHash  $(Split-Path -Leaf $mobileOutput)" | Set-Content -LiteralPath "$mobileOutput.sha256" -Encoding ascii
    # Capacitor重写文件可能仅改变换行；以Git实际内容差异判断源码是否修改。
    & git diff --quiet HEAD --
    if ($LASTEXITCODE -gt 1) { throw '无法核对源码修改状态' }
    $mobileTrackedChanges = $LASTEXITCODE -eq 1
    [ordered]@{
        sourceCommit = (& git rev-parse HEAD).Trim()
        trackedChanges = $mobileTrackedChanges
        builtAt = (Get-Date).ToString('o')
        apk = Split-Path -Leaf $mobileOutput
        bytes = (Get-Item -LiteralPath $mobileOutput).Length
        sha256 = $mobileHash
        version = $mobileVersion
        versionCode = [int]$mobileVersionCode
        distribution = $mobileKind
        diagnostics = !$Manual
        deviceTested = $false
    } | ConvertTo-Json | Set-Content -LiteralPath releases/android-build-info.json -Encoding utf8
    & "$PSScriptRoot/publish-android.ps1" -ApkPath $mobileOutput
    Write-Host "测试 APK：$mobileOutput"
    Write-Host "SHA-256：$mobileHash"
} finally { $env:INKWAVE_MANUAL_BUILD = $previousManualBuild; Pop-Location }
