#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Pi Web 桌面壳：窗口 + 本地服务器(30142)生命周期管理 + 拖拽真路径桥接
// 服务器永远是用户已安装的网页版（.next/standalone 或外部启动的 next start），壳不内置副本。

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

// 关闭 DWM 系统边框环（透明边缝外围那圈框）+ 显式声明窗口圆角（Win11）
#[cfg(windows)]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(hwnd: isize, attr: u32, value: *const u32, size: u32) -> i32;
}

#[cfg(windows)]
fn polish_window_frame(hwnd: isize) {
    unsafe {
        let color_none: u32 = 0xFFFF_FFFE; // DWMWA_COLOR_NONE：边框全透明
        DwmSetWindowAttribute(hwnd, 34, &color_none as *const u32, 4); // DWMWA_BORDER_COLOR
        let round: u32 = 2; // DWMWCP_ROUND：窗口矩形本身圆角
        DwmSetWindowAttribute(hwnd, 33, &round as *const u32, 4); // DWMWA_WINDOW_CORNER_PREFERENCE
        let nc_disabled: u32 = 1; // DWMNCRP_DISABLED：彻底关闭 DWM 非客户区渲染（含系统投影）
        DwmSetWindowAttribute(hwnd, 2, &nc_disabled as *const u32, 4); // DWMWA_NCRENDERING_POLICY
    }
}

const PORT: u16 = 30142;
const APP_URL: &str = "http://127.0.0.1:30142";
const READY_TIMEOUT_SECS: u64 = 90;

// ──────────── 网页预览：主窗口内多 webview（真内核渲染外部网址）────────────
// 坐标一律用物理像素：前端把面板 getBoundingClientRect() × devicePixelRatio 传进来。
const PREVIEW_LABEL: &str = "preview";

#[tauri::command]
async fn open_external_preview(
    app: tauri::AppHandle,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    // 命令本身就在异步运行时调度：这里直接创建/导航即可，避免 Windows 同步创建死锁
    let parsed = url.parse::<url::Url>().map_err(|e| e.to_string())?;
    let window = app.get_window("main").ok_or("主窗口不存在")?;
    if let Some(webview) = app.get_webview(PREVIEW_LABEL) {
        webview.navigate(parsed).map_err(|e| e.to_string())?;
    } else {
        window
            .add_child(
                tauri::WebviewBuilder::new(PREVIEW_LABEL, WebviewUrl::External(parsed)),
                Position::Physical(PhysicalPosition::new(x as i32, y as i32)),
                Size::Physical(PhysicalSize::new(w as u32, h as u32)),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_external_preview(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(PREVIEW_LABEL) {
        webview
            .set_position(PhysicalPosition::new(x as i32, y as i32))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(PhysicalSize::new(w as u32, h as u32))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_external_preview(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(PREVIEW_LABEL) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ───────────────────────── 服务器状态 ─────────────────────────

struct ServerState {
    // 自己拉起的子进程；外部启动的服务器不在此列，退出时不动它
    child: Mutex<Option<Child>>,
    spawned: AtomicBool,
}

fn port_open(port: u16) -> bool {
    use std::net::SocketAddr;
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_ok()
}

fn http_ok(port: u16) -> bool {
    use std::net::SocketAddr;
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    if let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) {
        let req = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n", port);
        if s.write_all(req.as_bytes()).is_ok() {
            let mut buf = [0u8; 64];
            let n = s.read(&mut buf).unwrap_or(0);
            let head = String::from_utf8_lossy(&buf[..n]);
            // 接受 2xx/3xx：首页将来加重定向（如登录跳转）也不影响就绪判定
            let code = head.get(9..12).and_then(|c| c.trim().parse::<u16>().ok()).unwrap_or(0);
            return (200..400).contains(&code);
        }
    }
    false
}

// ───────────────────────── 安装目录定位 ─────────────────────────

#[derive(Deserialize, Default)]
struct AppConfig {
    #[serde(default)]
    install_dir: Option<String>,
}

fn config_path() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("pi-web-desktop").join("config.json")
}

fn read_config_install_dir() -> Option<PathBuf> {
    let text = std::fs::read_to_string(config_path()).ok()?;
    let cfg: AppConfig = serde_json::from_str(&text).ok()?;
    cfg.install_dir.map(PathBuf::from)
}

fn looks_like_install(dir: &PathBuf) -> bool {
    dir.join(".next").join("BUILD_ID").is_file()
}

fn find_install_dir() -> Option<PathBuf> {
    // 1. 配置文件（用户手动指定过）
    if let Some(dir) = read_config_install_dir() {
        if looks_like_install(&dir) {
            return Some(dir);
        }
    }
    // 2. 默认位置：%USERPROFILE%\pi-web-custom（install-and-start.ps1 的默认安装位）
    if let Ok(home) = std::env::var("USERPROFILE") {
        let dir = PathBuf::from(home).join("pi-web-custom");
        if looks_like_install(&dir) {
            return Some(dir);
        }
    }
    // 3. exe 同级的 pi-web-custom
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for candidate in [parent.join("pi-web-custom"), parent.join("../pi-web-custom")] {
                if looks_like_install(&candidate) {
                    return Some(candidate.canonicalize().unwrap_or(candidate));
                }
            }
        }
    }
    None
}

fn spawn_server(dir: &PathBuf) -> Result<Child, String> {
    // 优先桌面独立构建（.next-desktop/standalone，自带静态资源），退回普通 standalone
    let standalone_candidates = [
        dir.join(".next-desktop").join("standalone"),
        dir.join(".next").join("standalone"),
    ];
    for standalone in &standalone_candidates {
        if standalone.join("server.js").is_file() {
            return Command::new("node")
                .arg("server.js")
                .current_dir(standalone)
                .env("PORT", PORT.to_string())
                .env("HOSTNAME", "127.0.0.1")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| format!("启动 node 失败: {}", e));
        }
    }
    // 未构建 standalone → 回退到 node_modules 的 next start（老版本安装目录兼容）
    let next_bin = dir.join("node_modules").join("next").join("dist").join("bin").join("next");
    if !next_bin.is_file() {
        return Err("目录里既没有 standalone 产物也没有 next".into());
    }
    Command::new("node")
        .arg(next_bin)
        .args(["start", "-H", "127.0.0.1", "-p", &PORT.to_string()])
        .current_dir(dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 node 失败: {}", e))
}

// ───────────────────────── 启动流程 ─────────────────────────

fn main() {
    let state = ServerState {
        child: Mutex::new(None),
        spawned: AtomicBool::new(false),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            open_external_preview,
            resize_external_preview,
            close_external_preview,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // 创建窗口（先显示启动画面，服务器后台就绪后跳转）
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("startup.html".into()),
            )
            .title("Pi Web")
            .inner_size(1280.0, 840.0)
            .min_inner_size(900.0, 600.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .build()?;

            // 去掉系统边框环，让透明边缝真透明
            #[cfg(windows)]
            {
                if let Ok(hwnd) = window.hwnd() {
                    polish_window_frame(hwnd.0 as isize);
                }
            }

            // 服务器管理线程
            std::thread::spawn(move || {
                let status = |tip: &str, error: &str| {
                    let payload = serde_json::json!({ "tip": tip, "error": error });
                    // 纯拼接避免 format! 花括号转义歧义：渲染结果 …{detail:<payload>}))
                    let js = String::from("window.dispatchEvent(new CustomEvent('pi-web:desktop-status',{detail:")
                        + payload.to_string().as_str()
                        + "}))";
                    let _ = window.eval(&js);
                };

                let _ = window.eval(
                    "window.dispatchEvent(new CustomEvent('pi-web:desktop-status',{detail:{tip:'正在启动本地服务…'}}))",
                );

                let state: tauri::State<ServerState> = handle.state();
                if port_open(PORT) {
                    // 端口有人监听：先确认它是不是能用的 Pi Web 服务器，
                    // 否则超时后的提示会误导成"构建可能仍在进行"
                    if !http_ok(PORT) {
                        std::thread::sleep(Duration::from_millis(1500));
                    }
                    if !http_ok(PORT) {
                        status("", &format!("端口 {} 已被其他程序占用，Pi Web 无法启动。请关闭占用该端口的程序后重开本应用。", PORT));
                        return;
                    }
                }
                if !port_open(PORT) {
                    match find_install_dir() {
                        Some(dir) => match spawn_server(&dir) {
                            Ok(child) => {
                                state.spawned.store(true, Ordering::SeqCst);
                                *state.child.lock().unwrap() = Some(child);
                                status("本地服务启动中…", "");
                            }
                            Err(e) => {
                                status("", &format!("启动服务器失败：{}。可把安装目录写入 %APPDATA%\\pi-web-desktop\\config.json（{{\"installDir\":\"...\"}}）后重试。", e));
                                return;
                            }
                        },
                        None => {
                            status("", "未找到 Pi Web 安装目录。请先完成网页版安装（含一次构建），或把安装目录写入 %APPDATA%\\pi-web-desktop\\config.json（{\"installDir\":\"...\"}）后重启本应用。");
                            return;
                        }
                    }
                }

                let deadline = Instant::now() + Duration::from_secs(READY_TIMEOUT_SECS);
                loop {
                    if http_ok(PORT) {
                        let _ = window.eval(&format!(
                            "window.dispatchEvent(new CustomEvent('pi-web:desktop-status',{{detail:{{ready:true}}}}))",
                        ));
                        let _ = window.eval(&format!("location.replace('{}')", APP_URL));
                        return;
                    }
                    if Instant::now() > deadline {
                        status("", &format!("服务器在 {} 秒内未就绪。若是首次启动，构建可能仍在进行，稍后重开本应用即可。", READY_TIMEOUT_SECS));
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(300));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 拖拽真路径：Tauri 原生拿到完整路径，转事件给网页
            if let WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                if let (Some(webview), Ok(json)) = (window.get_webview_window("main"), serde_json::to_string(&paths)) {
                    let _ = webview.eval(&format!(
                        "window.dispatchEvent(new CustomEvent('pi-web:external-file-paths',{{detail:{{paths:{} }}}}))",
                        json
                    ));
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state: tauri::State<ServerState> = app_handle.state();
                if state.spawned.load(Ordering::SeqCst) {
                    if let Some(mut child) = state.child.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
