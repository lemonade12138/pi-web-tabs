"use client";

import { useEffect, useRef } from "react";

interface TauriCore {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauriInvoke(): TauriCore["invoke"] | undefined {
  return (window as unknown as { __TAURI__?: { core?: TauriCore } }).__TAURI__?.core?.invoke;
}

interface Props {
  url: string;
  onClose: () => void;
}

/**
 * 右侧面板内的真实浏览器预览（Tauri 多 webview）：
 * 在主窗口里叠第二个 WebView2 渲染外部网址，位置/尺寸跟随右侧面板内容区。
 *
 * 对齐策略：不用一堆事件（resize/缩放/面板开关/断点切换），改用 rAF 每帧轮询
 * 对比物理 bounds，变了就同步。任何导致面板位置/尺寸/缩放变化的操作下一帧必然
 * 被捕获——全屏/非全屏/窄窗/缩放/收放面板都不会脱位。
 */
export function WebPreviewPanel({ url, onClose }: Props) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  const bounds = () => {
    const el = contentRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: Math.round(r.left * dpr),
      y: Math.round(r.top * dpr),
      w: Math.round(r.width * dpr),
      h: Math.round(r.height * dpr),
    };
  };

  // 打开 / 换网址：创建或导航预览 webview
  useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    const b = bounds();
    if (!b) return;
    void invoke("open_external_preview", { url, ...b });
    return () => {
      // 组件卸载（关闭预览/清空URL/切走）时销毁预览 webview，避免残影覆盖
      void invoke("close_external_preview");
    };
  }, [url]);

  // 每帧对齐：物理 bounds 变化就同步（覆盖窗口拖动/resize/缩放/面板开关/断点切换）
  useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    let raf = 0;
    let lastKey = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const b = bounds();
      if (!b) return;
      const key = `${b.x},${b.y},${b.w},${b.h}`;
      if (key !== lastKey) {
        lastKey = key;
        void invoke("resize_external_preview", b);
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [url]);

  const close = () => {
    void tauriInvoke()?.("close_external_preview");
    onClose();
  };
  const reload = () => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    const b = bounds();
    if (b) void invoke("open_external_preview", { url, ...b });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={url}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z" />
          </svg>
          {url}
        </span>
        <button
          type="button"
          onClick={reload}
          title="重新加载"
          aria-label="重新加载"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            padding: 0,
            background: "none",
            border: "none",
            borderRadius: 4,
            color: "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={close}
          title="关闭网页预览"
          aria-label="关闭网页预览"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            padding: 0,
            background: "none",
            border: "none",
            borderRadius: 4,
            color: "#f87171",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        </button>
      </div>
      {/* 内容区：被真实浏览器 webview 覆盖 */}
      <div ref={contentRef} style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--bg-panel)" }} />
    </div>
  );
}
