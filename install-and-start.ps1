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

# 3. 首次运行：构建正式版（仅一次）
if (-not (Test-Path "$root\.next\BUILD_ID")) {
    Write-Host "正在构建正式版（仅此一次，几分钟）……" -ForegroundColor Yellow
    npx next build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "构建失败，多半是网络或 Node 版本问题，重新双击再试。" -ForegroundColor Red
        Read-Host "按回车关闭"
        exit 1
    }
}

# 4. 在桌面创建 Pi Web Tabs 快捷方式（已存在就跳过）
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "Pi Web Tabs.lnk"
$icoFile = Join-Path $root "app\pi-tabs.ico"
$vbsFile = Join-Path $root "launch-hidden.vbs"
if (-not (Test-Path $lnkPath) -and (Test-Path $icoFile) -and (Test-Path $vbsFile)) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($lnkPath)
    $lnk.TargetPath = "C:\Windows\System32\wscript.exe"
    $lnk.Arguments = "`"$vbsFile`""
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = "$icoFile,0"
    $lnk.Description = "Pi Web Tabs"
    $lnk.Save()
    Write-Host "已在桌面创建 Pi Web Tabs 快捷方式" -ForegroundColor Green
}

# 5. 启动（正式模式，已在跑就直接开浏览器）
$port = 30142
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile', '-Command', "Set-Location '$root'; npx next start -H 127.0.0.1 -p $port"
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
}
# 打开应用窗口：Edge 应用模式优先，其次 Chrome，最后默认浏览器
$appUrl = "http://127.0.0.1:$port"
$edge = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$chrome = @("C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
    Start-Process $edge -ArgumentList "--app=$appUrl"
} elseif ($chrome) {
    Start-Process $chrome -ArgumentList "--app=$appUrl"
} else {
    Start-Process $appUrl
}
Write-Host "已打开应用窗口。没弹出来的话，手动访问 $appUrl"
Start-Sleep -Seconds 3
