"use client";

import { useCallback, useEffect, useState } from "react";
import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem, ExtensionWidgetItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";
import { ExtensionWidgets } from "./ExtensionWidgets";

const COLLAPSED_KEY = "pi-web:extension-bar-collapsed";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/ +/g, " ").trim())
    .join("\n")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

export function ExtensionStatusBar({
  statuses,
  widgets = [],
}: {
  statuses: ExtensionStatusItem[];
  widgets?: ExtensionWidgetItem[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // hydrate after mount（localStorage 仅客户端可用，避免水合不一致）
    try { setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1"); } catch {}
  }, []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  if (statuses.length === 0 && widgets.length === 0) return null;

  const statusLine = formatExtensionStatusLine(statuses);
  const plainStatusLine = stripAnsi(statusLine);

  if (collapsed) {
    // 收起态：零占位 —— 高度 0，只留一个悬浮小咬标在右下角，不占任何竖向空间
    return (
      <div
        className={`extension-status-shelf extension-status-collapsed${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}`}
        style={{ position: "relative", height: 0, zIndex: 5 }}
      >
        <div
          onClick={toggleCollapsed}
          title="展开扩展状态栏"
          style={{
            position: "absolute",
            right: 10,
            bottom: 2,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "2px 9px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            boxShadow: "0 1px 5px rgba(0,0,0,0.15)",
            fontSize: 10,
            lineHeight: "14px",
            color: "var(--text-muted)",
            cursor: "pointer",
            userSelect: "none",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          ▴ 状态栏
        </div>
      </div>
    );
  }

  return (
    <div
      className={`extension-status-shelf${widgets.length > 0 ? " has-widgets" : ""}${statuses.length > 0 ? " has-status" : ""}`}
      style={{ display: "flex", alignItems: "center" }}
    >
      {widgets.length > 0 && <ExtensionWidgets widgets={widgets} />}
      {statuses.length > 0 && (
        <div
          role="status"
          className="extension-status-line"
          aria-label={plainStatusLine}
          title={plainStatusLine}
          style={{ flex: 1, minWidth: 0 }}
        >
          <span className="extension-status-text">
            <AnsiText text={statusLine} />
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={toggleCollapsed}
        title="收起扩展状态栏"
        aria-label="收起扩展状态栏"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          flexShrink: 0,
          marginRight: 4,
          padding: 0,
          background: "none",
          border: "none",
          borderRadius: 4,
          color: "var(--text-dim)",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <polyline points="2,3 5,7 8,3" />
        </svg>
      </button>
    </div>
  );
}
