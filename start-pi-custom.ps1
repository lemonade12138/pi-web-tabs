# Pi Custom 启动器：已在跑就直接开应用窗口，没跑就先启动再开
$port = 30142
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile', '-Command', "Set-Location 'C:\Users\Admin\pi-web-custom'; npx next dev -H 127.0.0.1 -p $port"
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
}
# 打开应用窗口：Edge 应用模式优先（无地址栏无标签页，像原生软件），其次 Chrome，最后默认浏览器
$appUrl = "http://127.0.0.1:$port"
$edge = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$chrome = @("C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", "D:\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
    Start-Process $edge -ArgumentList "--app=$appUrl"
} elseif ($chrome) {
    Start-Process $chrome -ArgumentList "--app=$appUrl"
} else {
    Start-Process $appUrl
}
