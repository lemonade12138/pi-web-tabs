import { useEffect } from "react";

interface TauriWindow {
  outerPosition: () => Promise<{ x: number; y: number }>;
  setPosition: (pos: { x: number; y: number }) => Promise<void>;
  toggleMaximize: () => Promise<void>;
}
interface TauriWindowModule {
  getCurrentWindow: () => TauriWindow;
  PhysicalPosition: new (x: number, y: number) => { x: number; y: number };
}

/**
 * 自定义窗口拖拽。
 *
 * 为什么不用 Tauri 内置的 data-tauri-drag-region：它走 Windows 系统模态拖拽
 * 循环（SC_MOVE），期间 WebView2 合成器被挂起，拖动时窗口只剩黑框/残影，
 * 松手才渲染 —— 用户明确不要这种体验。
 *
 * 这里改为纯 JS 逐帧 setPosition：不进系统循环，WebView2 每帧照常渲染，
 * 拖到哪内容跟到哪，实时跟手。
 */
export function useWindowDrag(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const tauri = (window as unknown as { __TAURI__?: { window?: TauriWindowModule } }).__TAURI__;
    const win = tauri?.window;
    if (!win) return;

    let dragging = false;
    let raf = 0;
    let startX = 0;
    let startY = 0;
    let winX = 0;
    let winY = 0;
    let lastX = 0;
    let lastY = 0;

    const isInteractive = (el: Element | null): boolean =>
      !!el?.closest(
        'button, a, input, textarea, select, [contenteditable], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [data-no-drag], label, [data-tab-id]',
      );

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as Element;
      const onRegion = !!target.closest?.("[data-custom-drag-region]");
      const onMargin = target === document.body || target.id === "__next";
      if (!onRegion && !onMargin) return;
      if (isInteractive(target)) return;
      event.preventDefault();
      dragging = true;
      startX = event.screenX;
      startY = event.screenY;
      try {
        target.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      void win
        .getCurrentWindow()
        .outerPosition()
        .then((pos) => {
          winX = pos.x;
          winY = pos.y;
        })
        .catch(() => {
          dragging = false;
        });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      lastX = event.screenX;
      lastY = event.screenY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        void win
          .getCurrentWindow()
          .setPosition(new win.PhysicalPosition(winX + (lastX - startX), winY + (lastY - startY)))
          .catch(() => {});
      });
    };

    const onPointerUp = () => {
      dragging = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    // 双击可拖动区域的空白处 = 全屏/还原（Windows 惯例：双击标题栏最大化）
    const onDblClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest?.("[data-custom-drag-region]")) return;
      if (isInteractive(target)) return;
      event.preventDefault();
      void win.getCurrentWindow().toggleMaximize().catch(() => {});
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("dblclick", onDblClick, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("dblclick", onDblClick, true);
    };
  }, [enabled]);
}
