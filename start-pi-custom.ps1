# Pi Custom 启动器：已在跑就直接开浏览器，没跑就先启动再开
$port = 30142
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-Process -WindowStyle Hidden powershell -ArgumentList '-NoProfile', '-Command', "Set-Location 'C:\Users\Admin\pi-web-custom'; npx next dev -H 127.0.0.1 -p $port"
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
}
Start-Process "http://127.0.0.1:$port"
