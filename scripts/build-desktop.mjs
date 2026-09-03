// 桌面版一键构建：PI_DESKTOP_BUILD=1 next build + standalone 静态资源合并
// 用法：npm run build:desktop
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const result = spawnSync(process.execPath, [
  path.join(root, "node_modules", "next", "dist", "bin", "next"), "build",
], {
  stdio: "inherit",
  env: { ...process.env, PI_DESKTOP_BUILD: "1" },
  cwd: root,
  shell: process.platform === "win32",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const standalone = path.join(root, ".next-desktop", "standalone");
const distDirName = ".next-desktop";
// Next standalone 不包含静态资源与 public，需手动并入（官方文档步骤）
fs.cpSync(
  path.join(root, ".next-desktop", "static"),
  path.join(standalone, distDirName, "static"),
  { recursive: true },
);
fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
console.log("桌面版构建完成：.next-desktop/standalone/server.js（构建后可用 Tauri 壳拉起）");
