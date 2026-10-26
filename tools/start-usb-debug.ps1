# 中文说明：建立手机到当前电脑的USB日志通道；断线重连/换电脑后重新运行。
param([string]$AdbPath = "$env:USERPROFILE/.cache/demoink-android/sdk/platform-tools/adb.exe", [string]$Serial = '')
$ErrorActionPreference = 'Stop'
$usbProject = Split-Path -Parent $PSScriptRoot
if (!(Test-Path -LiteralPath $AdbPath)) { throw '未找到adb，请通过-AdbPath指定Android SDK platform-tools/adb.exe' }
$usbTarget = if ($Serial) { @('-s', $Serial) } else { @('-d') }
$usbState = & $AdbPath @usbTarget get-state
if ($LASTEXITCODE -ne 0 -or $usbState -ne 'device') { throw '请连接一台USB手机，开启USB调试并允许电脑授权；多台设备用-Serial指定' }
New-Item -ItemType Directory -Path "$usbProject/releases/logs" -Force | Out-Null
$usbListener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if (!$usbListener) {
    Start-Process -FilePath (Get-Command python).Source -ArgumentList 'tools/log_receiver.py' -WorkingDirectory $usbProject -WindowStyle Hidden -RedirectStandardOutput "$usbProject/releases/usb-receiver.stdout.log" -RedirectStandardError "$usbProject/releases/usb-receiver.stderr.log"
    Start-Sleep -Milliseconds 700
}
$usbHealth = Invoke-RestMethod 'http://127.0.0.1:8765/api/usb' -TimeoutSec 3
if ($usbHealth.service -ne 'inkwave-log-receiver' -or $usbHealth.usbProtocol -ne 1) { throw '8765端口不是新版日志接收器，请先停止旧服务并重新运行' }
& $AdbPath @usbTarget reverse tcp:18765 tcp:8765
if ($LASTEXITCODE -ne 0) { throw '建立USB反向端口失败' }
Write-Host "USB日志通道已建立，手机点击上传日志，保存到：$usbProject/releases/logs"
