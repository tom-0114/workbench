import { Lunar, Solar } from "lunar-typescript";
import type { Occurrence, Task } from "./types";
import { daysInMonth, fmtDate, parseDate } from "./date";

export function completionKey(taskId: number, date: string): string {
  return `${taskId}:${date}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 公历每年：锚点月日在各年份的日期（2/29 平年顺延为 2/28） */
function yearlySolarDates(anchor: Date, startYear: number, endYear: number): string[] {
  const m = anchor.getMonth() + 1;
  const d = anchor.getDate();
  const out: string[] = [];
  for (let y = startYear; y <= endYear; y++) {
    let day = d;
    if (m === 2 && d === 29 && !isLeapYear(y)) day = 28;
    out.push(`${y}-${pad(m)}-${pad(day)}`);
  }
  return out;
}

/** 农历每年：锚点的农历月日在各农历年对应的公历日期（腊月三十缺失时退到廿九；闰月锚点按普通月） */
function yearlyLunarDates(anchor: Date, startYear: number, endYear: number): string[] {
  const anchorLunar = Solar.fromYmd(
    anchor.getFullYear(),
    anchor.getMonth() + 1,
    anchor.getDate(),
  ).getLunar();
  const lm = Math.abs(anchorLunar.getMonth());
  const ld = anchorLunar.getDay();

  const out: string[] = [];
  // 农历年与公历年错位，两端各扩一年再按公历范围过滤
  for (let ly = startYear - 1; ly <= endYear + 1; ly++) {
    for (const day of ld === 30 ? [30, 29] : [ld]) {
      try {
        const s = Lunar.fromYmd(ly, lm, day).getSolar();
        out.push(`${s.getYear()}-${pad(s.getMonth())}-${pad(s.getDay())}`);
        break;
      } catch {
        // 该农历年没有这一天，尝试退一天
      }
    }
  }
  return out;
}

/**
 * 把任务展开为 [start, end]（含端点）范围内的可渲染实例。
 * - 非重复任务：dueDate 落在范围内则输出一条
 * - 重复任务：从 dueDate（锚点）起到 repeatUntil 为止，按规则在范围内展开；
 *   dateOverrides 记录的单次改期例外会把原日期的实例移到新日期（空串 = 该次不出现）
 */
export function expandOccurrences(
  tasks: Task[],
  completions: Set<string>,
  start: string,
  end: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  const startDate = parseDate(start);
  const endDate = parseDate(end);

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
    const until = t.repeatUntil || "9999-12-31";

    const overrides = t.dateOverrides ?? {};
    // 改期例外：原日期 -> 新日期（空串 = 该次移除）；targets 反查“新日期 -> 原日期”
    // 截止日按原日期判断：截止前的实例改期到截止后仍然有效
    const targets = new Map<string, string>();
    for (const [origin, target] of Object.entries(overrides)) {
      if (target && origin <= until) targets.set(target, origin);
    }
    const hasOverrides = Object.keys(overrides).length > 0;
    const last = targets.size ? [...targets.keys()].reduce((a, b) => (b > a ? b : a), until) : until;
    const stop = last < end ? last : end;
    if (from > stop) continue;

    // 每年（公历/农历）：直接计算目标日期，不逐日扫描
    if (t.repeatRule === "yearly" || t.repeatRule === "yearly-lunar") {
      const dates = new Set(
        t.repeatRule === "yearly"
          ? yearlySolarDates(anchor, startDate.getFullYear(), endDate.getFullYear())
          : yearlyLunarDates(anchor, startDate.getFullYear(), endDate.getFullYear()),
      );
      if (hasOverrides) {
        for (const target of targets.keys()) {
          if (target >= from && target <= end) dates.add(target);
        }
      }
      for (const ds of dates) {
        if (ds < from || ds > end) continue;
        if (ds > until && !targets.has(ds)) continue;
        if (hasOverrides && overrides[ds] !== undefined) continue; // 原日期已改期，在新日期出现
        out.push({
          task: t,
          date: ds,
          completed: completions.has(completionKey(t.id, ds)),
          isVirtual: true,
        });
      }
      continue;
    }

    // 每天/每周/每月：逐日匹配
    const cur = parseDate(from);
    const stopDate = parseDate(stop);
    while (cur <= stopDate) {
      if (hasOverrides) {
        const ds = fmtDate(cur);
        if (overrides[ds] !== undefined) {
          // 改期的原日期：实例移到新日期，这里不再出现
          cur.setDate(cur.getDate() + 1);
          continue;
        }
        if (targets.has(ds)) {
          // 被改期实例的新落点（不一定仍符合重复规则）
          out.push({
            task: t,
            date: ds,
            completed: completions.has(completionKey(t.id, ds)),
            isVirtual: true,
          });
          cur.setDate(cur.getDate() + 1);
          continue;
        }
      }
      let match = false;
      if (fmtDate(cur) > until) {
        cur.setDate(cur.getDate() + 1);
        continue;
      }
      switch (t.repeatRule) {
        case "daily":
          match = true;
          break;
        case "weekly":
          match = cur.getDay() === anchor.getDay();
          break;
        case "monthly": {
          // 锚点日超过当月天数时落到月末，否则 31 号的任务会跳过所有小月
          const last = daysInMonth(cur.getFullYear(), cur.getMonth() + 1);
          match = cur.getDate() === Math.min(anchor.getDate(), last);
          break;
        }
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
