# Pi Custom 启动器：正式模式，已在跑就直接开应用窗口，没跑就先启动再开
$port = 30142
$root = $PSScriptRoot
# 生产包检查：首次或代码更新后未重新构建时自动补构建
if (-not (Test-Path "$root\.next\BUILD_ID")) {
    Write-Host "首次启动：正在构建正式版（仅此一次较慢）……" -ForegroundColor Yellow
    Set-Location $root
    npx next build
}
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile', '-Command', "Set-Location '$root'; npx next start -H 127.0.0.1 -p $port"
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
}
# 预热：先把关键页面和接口拉一遍，首次打开也秒开
$appUrl = "http://127.0.0.1:$port"
foreach ($p in @("/", "/api/home", "/api/sessions", "/api/agent/running")) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "$appUrl$p" -TimeoutSec 120 | Out-Null } catch {}
}

# 打开应用窗口：Edge 应用模式优先（无地址栏无标签页，像原生软件），其次 Chrome，最后默认浏览器
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
