// 自装文件拖拽：绕开 wry 的注册竞态与 WebView2 新版运行时的兼容问题。
// 直接在 WebView2 内层窗口（Chrome_WidgetWin_1）上 Revoke + Register 自己的 IDropTarget。
// 事件经 channel 转给中继线程，由中继线程派发（拖拽上下文里绝不做重活）。
#![allow(non_snake_case)]

#[cfg(windows)]
pub mod win {
    use std::sync::mpsc::{channel, Sender};
    use std::sync::OnceLock;
    use std::time::Duration;

    use windows::core::{implement, Ref};
    use windows::Win32::Foundation::{HWND, LPARAM, POINT, POINTL};
use windows::core::BOOL;
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_HGLOBAL};
    use windows::Win32::System::Ole::{
        IDropTarget, IDropTarget_Impl, RegisterDragDrop, RevokeDragDrop, CF_HDROP, DROPEFFECT,
        DROPEFFECT_COPY, DROPEFFECT_NONE,
    };
    use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
    use windows::Win32::UI::Shell::{DragFinish, DragQueryFileW, HDROP};
    use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW};

    pub enum DropEvent {
        Enter(Vec<String>, i32, i32),
        Leave,
        Drop(Vec<String>, i32, i32),
    }

    // 标题探针通道：COM 回调里不动 UI，借全局转发给中继线程
    static TITLE_TX: OnceLock<Sender<String>> = OnceLock::new();

    #[implement(IDropTarget)]
    pub struct OwnDropTarget {
        pub hwnd: isize,
        pub tx: Sender<DropEvent>,
        pub enter_valid: std::cell::UnsafeCell<bool>,
    }

    impl OwnDropTarget {
        fn iterate_filenames(data_obj: Ref<'_, IDataObject>) -> Option<Vec<String>> {
            let drop_format = FORMATETC {
                cfFormat: CF_HDROP.0,
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            };
            unsafe {
                let medium: STGMEDIUM = match data_obj.as_ref() {
                    Some(obj) => match obj.GetData(&drop_format) {
                        Ok(m) => m,
                        Err(e) => {
                            if let Some(t) = TITLE_TX.get() { let _ = t.send(format!("<GetData失败:{:08x}>", e.code().0)); }
                            return None;
                        }
                    },
                    None => {
                        if let Some(t) = TITLE_TX.get() { let _ = t.send("<数据对象为空>".into()); }
                        return None;
                    }
                };
                let hdrop = HDROP(medium.u.hGlobal.0 as _);
                let mut out = Vec::new();
                let item_count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
                for i in 0..item_count {
                    let char_count = DragQueryFileW(hdrop, i, None) as usize;
                    let mut buf = vec![0u16; char_count + 1];
                    DragQueryFileW(hdrop, i, Some(&mut buf));
                    out.push(String::from_utf16_lossy(&buf[..char_count]));
                }
                let _ = DragFinish(hdrop);
                if out.is_empty() { None } else { Some(out) }
            }
        }
    }

    #[allow(non_snake_case)]
    impl IDropTarget_Impl for OwnDropTarget_Impl {
        fn DragEnter(
            &self,
            pDataObj: Ref<'_, IDataObject>,
            _grfKeyState: MODIFIERKEYS_FLAGS,
            pt: &POINTL,
            pdwEffect: *mut DROPEFFECT,
        ) -> windows::core::Result<()> {
            let mut pt = POINT { x: pt.x, y: pt.y };
            unsafe {
                let _ = ScreenToClient(HWND(self.hwnd as *mut _), &mut pt);
            }
            let paths = OwnDropTarget::iterate_filenames(pDataObj);
            unsafe {
                if paths.is_some() {
                    *self.enter_valid.get() = true;
                    *pdwEffect = DROPEFFECT_COPY;
                    let _ = self.tx.send(DropEvent::Enter(paths.unwrap(), pt.x, pt.y));
                    if let Some(t) = TITLE_TX.get() { let _ = t.send(format!("enter@{},{}", pt.x, pt.y)); }
                } else {
                    *self.enter_valid.get() = false;
                    *pdwEffect = DROPEFFECT_NONE;
                    if let Some(t) = TITLE_TX.get() { let _ = t.send("enter:无效数据".into()); }
                }
            }
            Ok(())
        }

        fn DragOver(
            &self,
            _grfKeyState: MODIFIERKEYS_FLAGS,
            _pt: &POINTL,
            pdwEffect: *mut DROPEFFECT,
        ) -> windows::core::Result<()> {
            unsafe {
                if *self.enter_valid.get() {
                    *pdwEffect = DROPEFFECT_COPY;
                } else {
                    *pdwEffect = DROPEFFECT_NONE;
                }
            }
            Ok(())
        }

        fn DragLeave(&self) -> windows::core::Result<()> {
            unsafe {
                if *self.enter_valid.get() {
                    *self.enter_valid.get() = false;
                    let _ = self.tx.send(DropEvent::Leave);
                    if let Some(t) = TITLE_TX.get() { let _ = t.send("leave".into()); }
                }
            }
            Ok(())
        }

        fn Drop(
            &self,
            pDataObj: Ref<'_, IDataObject>,
            _grfKeyState: MODIFIERKEYS_FLAGS,
            _pt: &POINTL,
            _pdwEffect: *mut DROPEFFECT,
        ) -> windows::core::Result<()> {
            let paths = OwnDropTarget::iterate_filenames(pDataObj);
            unsafe {
                *self.enter_valid.get() = false;
            }
            if let Some(paths) = paths {
                let _ = self.tx.send(DropEvent::Drop(paths, 0, 0));
            }
            Ok(())
        }
    }

    // 收集主窗口的全部子窗口（OLE 命中哪层都由我们接管）
    unsafe fn collect_children(root: HWND) -> Vec<isize> {
        let mut found: Vec<isize> = Vec::new();
        unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let out = &mut *(lparam.0 as *mut Vec<isize>);
            out.push(hwnd.0 as isize);
            BOOL(1)
        }
        let _ = EnumChildWindows(Some(root), Some(cb), LPARAM(&mut found as *mut Vec<isize> as _));
        found
    }

    #[allow(dead_code)]
    unsafe fn find_inner_chrome(root: HWND) -> Option<isize> {
        let mut found: Option<isize> = None;
        unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let out = &mut *(lparam.0 as *mut Option<isize>);
            let mut cls = [0u16; 64];
            let n = GetClassNameW(hwnd, &mut cls);
            let name = String::from_utf16_lossy(&cls[..n as usize]);
            if name == "Chrome_WidgetWin_1" {
                *out = Some(hwnd.0 as isize);
            }
            BOOL(1)
        }
        let _ = EnumChildWindows(Some(root), Some(cb), LPARAM(&mut found as *mut Option<isize> as _));
        found
    }

    /// 安装：等待子窗口出现 → 调度到主线程 Revoke + Register（RegisterDragDrop 必须由窗口所属线程调用）
    pub fn install(
        root_hwnd: isize,
        schedule_on_main: impl Fn(Box<dyn FnOnce() + Send>) + Send + 'static,
        on_event: impl Fn(DropEvent) + Send + 'static,
        on_probe: impl Fn(String) + Send + 'static,
    ) {
        std::thread::spawn(move || {
            let (tx, rx) = channel::<DropEvent>();
            let (ttx, trx) = channel::<String>();
            let _ = TITLE_TX.set(ttx);

            std::thread::spawn(move || {
                while let Ok(ev) = rx.recv() {
                    on_event(ev);
                }
            });
            std::thread::spawn(move || {
                while let Ok(s) = trx.recv() {
                    on_probe(s);
                }
            });

            let root = HWND(root_hwnd as *mut _);
            let mut children: Vec<isize> = Vec::new();
            for _ in 0..120 {
                unsafe {
                    children = collect_children(root);
                }
                if !children.is_empty() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            if children.is_empty() {
                if let Some(t) = TITLE_TX.get() { let _ = t.send("<无子窗口>".into()); }
                return;
            }
            // 注册必须在窗口所属主线程上执行
            schedule_on_main(Box::new(move || {
                let mut ok = 0usize;
                let mut forgotten = Vec::new();
                for child in &children {
                    let target: IDropTarget = OwnDropTarget {
                        hwnd: *child,
                        tx: tx.clone(),
                        enter_valid: std::cell::UnsafeCell::new(false),
                    }
                    .into();
                    unsafe {
                        let _ = RevokeDragDrop(HWND(*child as *mut _));
                        if RegisterDragDrop(HWND(*child as *mut _), &target).is_ok() {
                            ok += 1;
                            forgotten.push(target);
                        }
                    }
                }
                if let Some(t) = TITLE_TX.get() { let _ = t.send(format!("installed:{}/{}", ok, children.len())); }
                std::mem::forget(forgotten); // COM 对象常驻
            }));
        });
    }
}
