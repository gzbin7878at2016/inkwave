# 中文说明：生成可侧载测试 APK。只为本次进程设置工具链，不修改用户 Java/UE4 环境。
param(
    [string]$JdkPath = "$env:USERPROFILE/.cache/demoink-android/ms-jdk/jdk-21.0.12.1+1",
    [string]$SdkPath = "$env:USERPROFILE/.cache/demoink-android/sdk"
)
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
Push-Location $mobileRoot
try {
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
    & ./android/gradlew.bat -p android assembleDebug --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'APK 构建失败' }
    $mobileApk = Join-Path $mobileRoot 'android/app/build/outputs/apk/debug/app-debug.apk'
    $mobileSigner = Get-ChildItem -LiteralPath "$SdkPath/build-tools" -Filter apksigner.bat -Recurse | Sort-Object FullName -Descending | Select-Object -First 1
    if (!$mobileSigner) { throw 'SDK 缺少 apksigner' }
    & $mobileSigner.FullName verify --verbose $mobileApk
    if ($LASTEXITCODE -ne 0) { throw 'APK 签名校验失败' }
    New-Item -ItemType Directory -Path releases -Force | Out-Null
    $mobileCommit = (& git rev-parse --short HEAD).Trim()
    $mobileOutput = Join-Path $mobileRoot "releases/INKWAVE-android-test1-$mobileCommit.apk"
    Copy-Item -LiteralPath $mobileApk -Destination $mobileOutput -Force
    $mobileHash = (Get-FileHash -LiteralPath $mobileOutput -Algorithm SHA256).Hash.ToLower()
    "$mobileHash  $(Split-Path -Leaf $mobileOutput)" | Set-Content -LiteralPath "$mobileOutput.sha256" -Encoding ascii
    [ordered]@{
        sourceCommit = (& git rev-parse HEAD).Trim()
        trackedChanges = [bool](& git status --porcelain --untracked-files=no)
        builtAt = (Get-Date).ToString('o')
        apk = Split-Path -Leaf $mobileOutput
        bytes = (Get-Item -LiteralPath $mobileOutput).Length
        sha256 = $mobileHash
        version = '1.1.0-android-test.1'
        deviceTested = $false
    } | ConvertTo-Json | Set-Content -LiteralPath releases/android-build-info.json -Encoding utf8
    Write-Host "测试 APK：$mobileOutput"
    Write-Host "SHA-256：$mobileHash"
} finally { Pop-Location }
