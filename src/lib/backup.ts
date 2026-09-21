import type { Task } from "./types";
import { nowIso, today } from "./date";

/** 备份文件结构；version 留给以后做导入兼容 */
export interface TaskBackup {
  app: "workbench";
  version: 1;
  exportedAt: string;
  tasks: Task[];
  completions: string[];
}

export function buildTaskBackup(tasks: Task[], completions: Set<string>): TaskBackup {
  return {
    app: "workbench",
    version: 1,
    exportedAt: nowIso(),
    tasks,
    completions: [...completions].sort(),
  };
}

/** 浏览器端下载 JSON 备份（含回收站与重复任务打卡记录） */
export function downloadTaskBackup(tasks: Task[], completions: Set<string>): void {
  const json = JSON.stringify(buildTaskBackup(tasks, completions), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `workbench-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
