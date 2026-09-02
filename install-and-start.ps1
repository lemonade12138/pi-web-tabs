# Pi Web 标签页版 · 一键安装+启动
# 第一次运行会自动下载依赖（需要几分钟+联网），之后秒开
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 1. 检查 Node.js
try { $nodeVersion = node -v } catch {
    Write-Host "没检测到 Node.js！请先去 https://nodejs.org 下载安装（选 LTS 版，一路下一步），装完再双击本脚本。" -ForegroundColor Red
    Read-Host "装好后按回车关闭"
    exit 1
}
Write-Host "Node.js $nodeVersion OK"

# 2. 首次运行：下载依赖
if (-not (Test-Path "$root\node_modules")) {
    Write-Host "第一次运行，正在下载依赖（几分钟），请别关窗口……" -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "依赖下载失败，多半是网络问题，重新双击本脚本再试一次。" -ForegroundColor Red
        Read-Host "按回车关闭"
        exit 1
    }
}

# 3. 启动（已在跑就直接开浏览器）
$port = 30142
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile', '-Command', "Set-Location '$root'; npx next dev -H 127.0.0.1 -p $port"
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
}
Start-Process "http://127.0.0.1:$port"
Write-Host "已打开浏览器。没弹出来的话，手动访问 http://127.0.0.1:$port"
Start-Sleep -Seconds 3
