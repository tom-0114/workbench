import type { RepeatRule } from "./types";
import { fmtDate } from "./date";

export interface ParsedQuickAdd {
  /** 剥离日期/重复关键词后的纯标题 */
  title: string;
  /** 解析出的日期（YYYY-MM-DD），未命中则不设置 */
  dueDate?: string;
  /** 解析出的重复规则，未命中则不设置 */
  repeatRule?: RepeatRule;
  /** 命中的关键词，用于输入时的实时预览（如 "明天 · 每天"） */
  hint: string;
}

const WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** 本周的周X；forceNextWeek 时若今天恰为该 weekday 则顺延到下周 */
function weekdayOf(base: Date, weekday: number, forceNextWeek: boolean): Date {
  const out = startOfDay(base);
  let delta = (weekday - out.getDay() + 7) % 7;
  if (delta === 0 && forceNextWeek) delta = 7;
  out.setDate(out.getDate() + delta);
  return out;
}

/**
 * Todoist 式自然语言快速添加（中文）：
 * - 日期：今天/明天/后天/大后天、周X/下周X/星期X、X月X日/号、X号
 * - 重复：每天(每日)/每周/每月/每年
 * 关键词从标题中剥离；未命中任何关键词时原样返回。
 */
export function parseQuickAdd(raw: string, base: Date = new Date()): ParsedQuickAdd {
  let text = ` ${raw.trim()} `;
  let dueDate: string | undefined;
  let repeatRule: RepeatRule | undefined;
  const hints: string[] = [];

  const consume = (re: RegExp, apply: (m: RegExpMatchArray) => void): void => {
    const m = text.match(re);
    if (!m || m.index === undefined) return;
    apply(m);
    text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
  };

  const today = startOfDay(base);

  // 重复规则：「每周X」同时把锚点定到最近的该周X
  const repeatMatch = text.match(/每天|每日|每周([一二三四五六日天])?|每月|每年/);
  if (repeatMatch && repeatMatch.index !== undefined) {
    const token = repeatMatch[0];
    repeatRule = token.startsWith("每周")
      ? "weekly"
      : token.startsWith("每月")
        ? "monthly"
        : token.startsWith("每年")
          ? "yearly"
          : "daily";
    hints.push(token);
    text = text.slice(0, repeatMatch.index) + " " + text.slice(repeatMatch.index + token.length);
    if (repeatRule === "weekly" && repeatMatch[1] && WEEKDAYS[repeatMatch[1]] !== undefined) {
      dueDate = fmtDate(weekdayOf(today, WEEKDAYS[repeatMatch[1]], false));
    }
  }

  // 相对日期
  consume(/大后天/, () => {
    dueDate = fmtDate(addDays(today, 3));
    hints.push("大后天");
  });
  consume(/后天/, () => {
    dueDate = fmtDate(addDays(today, 2));
    hints.push("后天");
  });
  consume(/明天/, () => {
    dueDate = fmtDate(addDays(today, 1));
    hints.push("明天");
  });
  consume(/今天|今日/, () => {
    dueDate = fmtDate(today);
    hints.push("今天");
  });

  // 下周X / 周X / 星期X / 礼拜X
  consume(/下(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
    const w = WEEKDAYS[m[1]];
    if (w === undefined) return;
    dueDate = fmtDate(weekdayOf(addDays(today, 7), w, false));
    hints.push("下周" + m[1]);
  });
  consume(/下(?:周|星期|礼拜)(?![一二三四五六日天])/, () => {
    dueDate = fmtDate(weekdayOf(addDays(today, 7), 1, false));
    hints.push("下周");
  });
  consume(/(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
    const w = WEEKDAYS[m[1]];
    if (w === undefined) return;
    dueDate = fmtDate(weekdayOf(today, w, false));
    hints.push("周" + m[1]);
  });

  // X月X日 / X月X号
  consume(/(\d{1,2})月(\d{1,2})[日号]/, (m) => {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    const d = new Date(base.getFullYear(), month - 1, day);
    if (d < today) d.setFullYear(d.getFullYear() + 1); // 已过则默认明年
    dueDate = fmtDate(d);
    hints.push(`${month}月${day}日`);
  });

  // X号（本月/下月）
  consume(/(\d{1,2})[日号]/, (m) => {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return;
    let d = new Date(base.getFullYear(), base.getMonth(), day);
    if (d < today) d = new Date(base.getFullYear(), base.getMonth() + 1, day);
    dueDate = fmtDate(d);
    hints.push(`${d.getMonth() + 1}月${day}日`);
  });

  const title = text.replace(/\s+/g, " ").trim();
  return { title: title || raw.trim(), dueDate, repeatRule, hint: hints.join(" · ") };
}
