"use client";
import { useCallback, useEffect, useRef } from "react";

/**
 * 反馈类定时器（复制成功提示、保存成功提示等）统一入口：
 * 组件卸载时自动清掉所有未到期回调，避免对已卸载组件 setState。
 * 用法：const feedback = useFeedbackTimers(); feedback(() => setCopied(false), 1500);
 */
export function useFeedbackTimers() {
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);
  return useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  }, []);
}
