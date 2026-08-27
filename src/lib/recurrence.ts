import type { Occurrence, Task } from "./types";
import { fmtDate, parseDate } from "./date";

export function completionKey(taskId: number, date: string): string {
  return `${taskId}:${date}`;
}

/**
 * 把任务展开为 [start, end]（含端点）范围内的可渲染实例。
 * - 非重复任务：dueDate 落在范围内则输出一条
 * - 重复任务：从 dueDate（锚点）起，按规则在范围内逐日匹配
 */
export function expandOccurrences(
  tasks: Task[],
  completions: Set<string>,
  start: string,
  end: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const t of tasks) {
    if (!t.dueDate) continue; // 收集箱事项（无日期）不进日历
    if (t.repeatRule === "none") {
      if (t.dueDate >= start && t.dueDate <= end) {
        out.push({ task: t, date: t.dueDate, completed: t.completed, isVirtual: false });
      }
      continue;
    }

    const anchor = parseDate(t.dueDate);
    const from = t.dueDate > start ? t.dueDate : start;
    if (from > end) continue;

    const cur = parseDate(from);
    const endDate = parseDate(end);
    while (cur <= endDate) {
      let match = false;
      switch (t.repeatRule) {
        case "daily":
          match = true;
          break;
        case "weekly":
          match = cur.getDay() === anchor.getDay();
          break;
        case "monthly":
          match = cur.getDate() === anchor.getDate();
          break;
      }
      if (match) {
        const ds = fmtDate(cur);
        out.push({
          task: t,
          date: ds,
          completed: completions.has(completionKey(t.id, ds)),
          isVirtual: true,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return out;
}
