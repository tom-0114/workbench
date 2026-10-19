import type { Task } from "./types";
import { nowIso, today } from "./date";

/** 备份文件结构；新增字段（时间、提醒、完成时间）对旧备份是可选的，版本号不变 */
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

/** 读取备份文件；不合法时返回给用户看的错误文案。逐项校验交给后端 */
export function parseTaskBackup(text: string): TaskBackup | string {
  let data: Partial<TaskBackup>;
  try {
    data = JSON.parse(text);
  } catch {
    return "文件不是有效的 JSON";
  }
  if (data?.app !== "workbench") return "这不是 Workbench 导出的备份文件";
  if (data.version !== 1) return "备份文件版本不受支持";
  if (!Array.isArray(data.tasks) || !Array.isArray(data.completions)) return "备份文件内容不完整";
  return { app: "workbench", version: 1, exportedAt: data.exportedAt ?? "", tasks: data.tasks, completions: data.completions };
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
