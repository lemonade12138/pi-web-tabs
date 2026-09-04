"use client";

import { memo, useState, useRef, useCallback, useEffect } from "react";
import type { SessionInfo } from "@/lib/types";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  onSelect: (session: SessionInfo) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, newName: string) => void;
  onReorder: (sessionIds: string[]) => void;
  runningSessionIds: Set<string>;
  attentionSessionIds: Set<string>;
}

// Same spinner as the sidebar's RunningSessionIndicator, kept in sync visually
function TabRunningIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function cwdLabel(cwd: string): string {
  if (!cwd) return "";
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

function getTitle(session: SessionInfo): string {
  const collapsed = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name?.trim() || collapsed.slice(0, 50) || "新会话";
}

function WorktreeSessionTabsImpl({ sessions, selectedSessionId, onSelect, onCreate, onDelete, onRename, onReorder, runningSessionIds, attentionSessionIds }: Props) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragDx, setDragDx] = useState(0);
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const justDraggedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEdit = useCallback((session: SessionInfo) => {
    if (session.transient) return;
    setEditValue(getTitle(session));
    setEditingId(session.id);
    setConfirmDeleteId(null);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const trimmed = editValue.trim();
    const session = sessions.find((s) => s.id === editingId);
    if (session && trimmed && trimmed !== (session.name ?? "")) {
      // No-op if user didn't change the derived title fallback
      const fallback = getTitle({ ...session, name: undefined });
      if (trimmed !== fallback || session.name) {
        onRename(editingId, trimmed);
      }
    }
    setEditingId(null);
  }, [editingId, editValue, sessions, onRename]);

  // Auto scroll selected tab into view
  useEffect(() => {
    if (!selectedSessionId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-tab-id="${selectedSessionId}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedSessionId]);

  // Pointer-based drag: the pressed tab follows the cursor; neighbors slide aside smoothly
  const handleTabPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, session: SessionInfo, index: number) => {
    if (editingId !== null || confirmDeleteId !== null || e.button !== 0) return;
    // 只有真正的草稿标签（从未发过消息）禁止拖拽；已转正的会话（含等待模型响应中）允许拖
    const isTrueDraft = session.transient && session.messageCount === 0 && !session.firstMessage;
    if (isTrueDraft) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const els = Array.from(scrollEl.querySelectorAll<HTMLElement>("[data-tab-id]"));
    const ids = els.map((el) => el.dataset.tabId ?? "");
    const fromIndex = ids.indexOf(session.id);
    if (fromIndex === -1) return;
    // 统一用屏幕坐标（getBoundingClientRect），否则窗口不在屏幕原点时 clientX 与布局坐标存在偏差，
    // 往前拖永远够不到前面标签的中点，前面的标签不会避让
    const rects = els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, width: r.width }; });
    const gap = rects.length > 1 ? Math.max(0, rects[1].left - rects[0].left - rects[0].width) : 6;
    const draggedWidth = rects[fromIndex].width;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let toIndex = fromIndex;

    const applyShifts = () => {
      const next: Record<string, number> = {};
      const step = draggedWidth + gap;
      if (toIndex > fromIndex) {
        for (let i = fromIndex + 1; i <= toIndex && i < ids.length; i++) next[ids[i]] = -step;
      } else if (toIndex < fromIndex) {
        for (let i = toIndex; i < fromIndex; i++) next[ids[i]] = step;
      }
      setShifts(next);
    };

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.abs(ev.clientX - startX) < 6 && Math.abs(ev.clientY - startY) < 6) return;
        active = true;
        justDraggedRef.current = true;
        setDragId(session.id);
        setDragDx(0);
        document.body.style.userSelect = "none";
      }
      setDragDx(ev.clientX - startX);
      let count = 0;
      for (let i = 0; i < rects.length; i++) {
        if (i === fromIndex) continue;
        if (ev.clientX > rects[i].left + rects[i].width / 2) count++;
      }
      const target = Math.max(0, Math.min(ids.length - 1, count));
      if (target !== toIndex) {
        toIndex = target;
        applyShifts();
      }
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.style.userSelect = "";
      els.forEach((el) => { el.style.transform = ""; });
      if (active && commit) {
        const next = ids.filter((id) => id !== session.id);
        const insertAt = Math.max(0, Math.min(next.length, toIndex));
        next.splice(insertAt, 0, session.id);
        if (insertAt !== fromIndex) onReorder(next);
      }
      // Release after the click event so a real drag doesn't trigger selection
      setTimeout(() => {
        setDragId(null);
        setShifts({});
        justDraggedRef.current = false;
      }, 0);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, [editingId, confirmDeleteId, onReorder]);

  // Order is maintained by the caller (most recently opened tab first)
  const sorted = sessions;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        flexShrink: 0,
        minHeight: 38,
      }}
    >
      <button
        type="button"
        onClick={onCreate}
        title={t("sidebar.new")}
        aria-label={t("sidebar.new")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          flexShrink: 0,
          background: "var(--bg-hover)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          color: "var(--text-muted)",
          cursor: "pointer",
          position: "sticky",
          left: 0,
          zIndex: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-selected)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="11" />
          <line x1="1" y1="6" x2="11" y2="6" />
        </svg>
      </button>

      <div
        ref={scrollRef}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
          scrollbarWidth: "thin",
        }}
      >
        {sorted.map((session, index) => {
          const isSelected = session.id === selectedSessionId;
          const isEditing = editingId === session.id;
          const isConfirming = confirmDeleteId === session.id;
          const title = getTitle(session);
          const displayTitle = session.transient && !session.name && !session.firstMessage ? "新会话 · 未开始" : title;

          return (
            <div
              key={session.id}
              data-tab-id={session.id}
              className={attentionSessionIds.has(session.id) ? "session-tab-attention" : undefined}
              tabIndex={isEditing ? -1 : 0}
              onClick={() => {
                if (justDraggedRef.current) return;
                if (isEditing || isConfirming) return;
                onSelect(session);
              }}
              onKeyDown={(e) => {
                if (isEditing || isConfirming) return;
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  startEdit(session);
                }
              }}
              onPointerDown={(e) => handleTabPointerDown(e, session, index)}
              title={title}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 28,
                padding: "0 8px",
                borderRadius: 6,
                border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: isSelected ? "var(--bg-selected)" : "var(--bg-hover)",
                color: isSelected ? "var(--text)" : "var(--text-muted)",
                cursor: isEditing ? "default" : "pointer",
                flexShrink: 0,
                maxWidth: 200,
                minWidth: 80,
                fontSize: 12,
                whiteSpace: "nowrap",
                opacity: session.transient ? 0.7 : 1,
                position: "relative",
                transition: dragId === session.id ? "none" : "transform 180ms ease",
                transform: dragId === session.id
                  ? `translateX(${dragDx}px) scale(1.03)`
                  : shifts[session.id]
                    ? `translateX(${shifts[session.id]}px)`
                    : undefined,
                zIndex: dragId === session.id ? 20 : undefined,
                boxShadow: dragId === session.id ? "0 4px 14px rgba(0,0,0,0.3)" : undefined,
              }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    padding: "2px 4px",
                    border: "1px solid var(--accent)",
                    borderRadius: 4,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                  }}
                />
              ) : (
                <>
                  {runningSessionIds.has(session.id) ? (
                    <TabRunningIndicator />
                  ) : attentionSessionIds.has(session.id) ? (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        flexShrink: 0,
                      }}
                    />
                  ) : null}
                  {!session.transient && session.cwd ? (
                    <span
                      title={session.cwd}
                      style={{
                        flexShrink: 0,
                        maxWidth: 72,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 10,
                        lineHeight: "16px",
                        padding: "0 4px",
                        borderRadius: 3,
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        color: "var(--text-dim)",
                        userSelect: "none",
                      }}
                    >
                      {cwdLabel(session.cwd)}
                    </span>
                  ) : null}
                  <span
                    onDoubleClick={(e) => {
                      if (isConfirming) return;
                      e.stopPropagation();
                      startEdit(session);
                    }}
                    onTouchStart={() => {
                      if (isConfirming || session.transient) return;
                      const id = session.id;
                      const timer = setTimeout(() => startEdit(session), 500);
                      const cancel = () => clearTimeout(timer);
                      const el = document.querySelector(`[data-tab-id="${id}"]`) as HTMLElement | null;
                      el?.addEventListener("touchend", cancel, { once: true });
                      el?.addEventListener("touchmove", cancel, { once: true });
                    }}
                    title={`${title} — 双击重命名`}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      flex: 1,
                      minWidth: 0,
                      fontStyle: session.transient && !session.name && !session.firstMessage ? "italic" : undefined,
                      color: session.transient && !session.name && !session.firstMessage ? "var(--text-dim)" : undefined,
                      userSelect: "none",
                    }}
                  >
                    {displayTitle}
                  </span>
                  {session.transient ? null : isConfirming ? (
                    <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                          onDelete(session.id);
                        }}
                        title={t("sidebar.delete")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          padding: 0,
                          background: "#ef4444",
                          border: "none",
                          borderRadius: 4,
                          color: "#fff",
                          cursor: "pointer",
                          fontSize: 10,
                        }}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                        title={t("sidebar.cancel")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                          padding: 0,
                          background: "var(--bg)",
                          border: "1px solid var(--border)",
                          borderRadius: 4,
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: 10,
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(null);
                        onDelete(session.id);
                      }}
                      title={t("chat.close")}
                      aria-label={t("chat.close")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                        padding: 0,
                        background: "none",
                        border: "none",
                        color: "var(--text-dim)",
                        cursor: "pointer",
                        borderRadius: 4,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <line x1="2" y1="2" x2="8" y2="8" />
                        <line x1="8" y1="2" x2="2" y2="8" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 免打扰外套：props 不变时跳过重算，避免外壳高频渲染（如流式输出）连带标签条空转
export const WorktreeSessionTabs = memo(WorktreeSessionTabsImpl);
