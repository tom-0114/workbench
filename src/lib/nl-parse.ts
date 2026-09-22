import type { RepeatRule } from "./types";
import { daysInMonth, fmtDate } from "./date";

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

const WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 末: 6 };

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

/** 从 base 起往后找第一个"该日号存在且不早于 today"的月份；31 号在小月不能溢出到下月 1 号 */
function nextMonthDay(today: Date, day: number): Date | undefined {
  for (let i = 0; i <= 12; i++) {
    const y = today.getFullYear();
    const m = today.getMonth() + i;
    const d = new Date(y, m, 1);
    if (day > daysInMonth(d.getFullYear(), d.getMonth() + 1)) continue;
    d.setDate(day);
    if (d >= today) return d;
  }
  return undefined;
}

/** 指定月日在今年及之后的首个有效日期（2月29日只落在闰年） */
function nextYearMonthDay(today: Date, month: number, day: number): Date | undefined {
  for (let y = today.getFullYear(); y <= today.getFullYear() + 8; y++) {
    if (day > daysInMonth(y, month)) continue;
    const d = new Date(y, month - 1, day);
    if (d >= today) return d;
  }
  return undefined;
}

/**
 * Todoist 式自然语言快速添加（中文）：
 * - 日期：今天/明天/后天/大后天、周X/下周X/星期X、周末/下周末、X月X日/号、X号
 * - 重复：每天(每日)/每周(X)/每月/每年
 * 关键词从标题中剥离；未命中任何关键词时原样返回。
 */
export function parseQuickAdd(raw: string, base: Date = new Date()): ParsedQuickAdd {
  let text = ` ${raw.trim()} `;
  let dueDate: string | undefined;
  let repeatRule: RepeatRule | undefined;
  const hints: string[] = [];

  const consume = (re: RegExp, apply: (m: RegExpMatchArray) => boolean | void): void => {
    const m = text.match(re);
    if (!m || m.index === undefined) return;
    // apply 返回 false 表示无法解析（如 2月30日），保留原文不剥离
    if (apply(m) === false) return;
    text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
  };

  const today = startOfDay(base);

  // 重复规则：「每周X」同时把锚点定到最近的该周X
  const repeatMatch = text.match(/每天|每日|每周([一二三四五六日天末])?|每月|每年/);
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

  // 周末：本周六（今天已是周末则为今天）；下周末：下周六。需先于「下周」匹配
  consume(/下(?:周|星期|礼拜)末/, () => {
    dueDate = fmtDate(weekdayOf(addDays(today, 7), 6, false));
    hints.push("下周末");
  });
  consume(/(?:这|本)?(?:周|星期|礼拜)末/, () => {
    const dow = today.getDay();
    dueDate = fmtDate(dow === 0 || dow === 6 ? today : weekdayOf(today, 6, false));
    hints.push("周末");
  });

  // 下周X / 周X / 星期X / 礼拜X
  consume(/下(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
    const w = WEEKDAYS[m[1]];
    if (w === undefined) return false;
    dueDate = fmtDate(weekdayOf(addDays(today, 7), w, false));
    hints.push("下周" + m[1]);
  });
  consume(/下(?:周|星期|礼拜)(?![一二三四五六日天])/, () => {
    dueDate = fmtDate(weekdayOf(addDays(today, 7), 1, false));
    hints.push("下周");
  });
  consume(/(?:周|星期|礼拜)([一二三四五六日天])/, (m) => {
    const w = WEEKDAYS[m[1]];
    if (w === undefined) return false;
    dueDate = fmtDate(weekdayOf(today, w, false));
    hints.push("周" + m[1]);
  });

  // X月X日 / X月X号：已过则落到明年
  consume(/(\d{1,2})月(\d{1,2})[日号]/, (m) => {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const d = nextYearMonthDay(today, month, day);
    if (!d) return false;
    dueDate = fmtDate(d);
    hints.push(`${month}月${day}日`);
  });

  // X号（本月/下月）；不吃掉上面没解析成功的「2月30日」里的「30日」
  consume(/(?<![\d月])(\d{1,2})[日号]/, (m) => {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return false;
    const d = nextMonthDay(today, day);
    if (!d) return false;
    dueDate = fmtDate(d);
    hints.push(`${d.getMonth() + 1}月${day}日`);
  });

  const title = text.replace(/\s+/g, " ").trim();
  return { title: title || raw.trim(), dueDate, repeatRule, hint: hints.join(" · ") };
}
