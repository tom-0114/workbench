import type { Task } from "./types";

/** 字符按序出现即视为命中（宽松模糊匹配） */
function isSubsequence(needle: string, hay: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (const c of hay) {
    if (c === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

/**
 * 模糊搜索全部任务。
 * - 多关键词（空格分隔）需全部命中
 * - 权重：标题子串 > 标签 > 备注 > 标题字符按序模糊
 * - 排序：得分降序 → 未完成在前 → 日期新的在前
 */
export function searchTasks(tasks: Task[], rawQuery: string, limit = 100): Task[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);

  const hits: { t: Task; s: number }[] = [];
  for (const t of tasks) {
    const title = t.title.toLowerCase();
    const notes = t.notes.toLowerCase();
    const tags = t.tags.join(" ").toLowerCase();
    let score = 0;
    let ok = true;
    for (const tok of tokens) {
      let s = 0;
      if (title.includes(tok)) s = 100;
      else if (tags.includes(tok)) s = 40;
      else if (notes.includes(tok)) s = 20;
      else if (isSubsequence(tok, title)) s = 10;
      if (s === 0) {
        ok = false;
        break;
      }
      score += s;
    }
    if (ok) hits.push({ t, s: score });
  }

  hits.sort(
    (a, b) =>
      b.s - a.s ||
      (a.t.completed ? 1 : 0) - (b.t.completed ? 1 : 0) ||
      (b.t.dueDate || "").localeCompare(a.t.dueDate || ""),
  );
  return hits.slice(0, limit).map((h) => h.t);
}
