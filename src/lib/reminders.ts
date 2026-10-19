import type { Task } from "./types";
import { expandOccurrences } from "./recurrence";
import { Solar } from "lunar-typescript";
import { addDays, fmtDate, parseDate } from "./date";

/** 前端算好未来这段时间的提醒交给后端；长期不打开应用，重复任务的提醒会在这之后停止 */
export const REMINDER_HORIZON_DAYS = 35;
const ALLDAY_HOUR = 9;
/** 与后端校验一致：提前最多 365 天，到期后最多 30 天 */
export const REMIND_OFFSET_MIN = -30 * 1440;
export const REMIND_OFFSET_MAX = 365 * 1440;

export interface ReminderEntry {
  taskId: number;
  date: string;
  fireAt: string;
  body: string;
}

/** 提醒的基准时刻：有时间用时间，全天任务用当天 09:00 */
export function reminderBase(date: string, dueTime: string): Date {
  const d = parseDate(date);
  const [h, m] = dueTime ? dueTime.split(":").map(Number) : [ALLDAY_HOUR, 0];
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * 任务只有日期：快速添加解析出的“下午3点”或旧数据里的时间，折成以 09:00 为基准的提醒提前量。
 * 已有提醒时保持提醒时刻不变；没有提醒时把这个时间当作提醒时间。
 */
export function foldTimeIntoReminder<T extends Pick<Task, "dueDate" | "dueTime" | "remindOffset">>(task: T): T {
  if (!task.dueTime) return task;
  const [h, m] = task.dueTime.split(":").map(Number);
  const shift = h * 60 + m - ALLDAY_HOUR * 60;
  const remindOffset = !task.dueDate ? null : task.remindOffset == null ? -shift : task.remindOffset - shift;
  return { ...task, dueTime: "", remindOffset };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 列表、日历上显示的提醒时间：与任务同一天只写时刻，否则带上今天/明天或月日 */
export function reminderLabel(task: Pick<Task, "dueTime" | "remindOffset">, date: string, today: string): string {
  if (task.remindOffset == null || !date) return "";
  const fire = reminderTime(date, task.dueTime, task.remindOffset);
  const day = fmtDate(fire);
  const time = `${pad2(fire.getHours())}:${pad2(fire.getMinutes())}`;
  if (day === date) return time;
  const relative = RELATIVE_DAYS[Math.round((parseDate(day).getTime() - parseDate(today).getTime()) / 86400_000)];
  return `${relative ?? `${fire.getMonth() + 1}月${fire.getDate()}日`} ${time}`;
}

/** 某次实例的提醒时刻（本地时区） */
export function reminderTime(date: string, dueTime: string, offset: number): Date {
  return new Date(reminderBase(date, dueTime).getTime() - offset * 60_000);
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const RELATIVE_DAYS: Record<number, string> = { [-1]: "昨天", 0: "今天", 1: "明天", 2: "后天" };
const NOTES_PREVIEW_MAX = 60;

/** 备注第一行非空文字，去掉 Markdown 的标题、列表、勾选框前缀 */
function notesPreview(notes: string): string {
  const line = notes
    .split("\n")
    .map((l) => l.replace(/^\s*(#+|[-*+]|\d+\.)?\s*(\[[ xX]\])?\s*/, "").trim())
    .find(Boolean);
  if (!line) return "";
  return line.length > NOTES_PREVIEW_MAX ? `${line.slice(0, NOTES_PREVIEW_MAX)}…` : line;
}

/** 通知正文：明天 10月21日 周二（九月初一）14:30，第二行是备注首行；“明天”按提醒那一刻来说 */
export function reminderBody(task: Pick<Task, "dueTime" | "notes">, date: string, fire: Date): string {
  const d = parseDate(date);
  const diff = Math.round((d.getTime() - parseDate(fmtDate(fire)).getTime()) / 86400_000);
  const lunar = Solar.fromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()).getLunar();
  const relative = RELATIVE_DAYS[diff] ? `${RELATIVE_DAYS[diff]} ` : "";
  const when = `${relative}${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}（${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}）${task.dueTime}`;
  const notes = notesPreview(task.notes);
  return notes ? `${when}\n${notes}` : when;
}

export function buildReminderSchedule(tasks: Task[], completions: Set<string>, now = new Date()): ReminderEntry[] {
  const withReminder = tasks.filter((t) => !t.deletedAt && t.dueDate && t.remindOffset != null);
  if (!withReminder.length) return [];
  // 提前量可长达一年、也可在到期后，展开范围要按最大提前量/延后量放宽
  const today = fmtDate(now);
  const maxEarly = Math.max(0, ...withReminder.map((t) => t.remindOffset!));
  const maxLate = Math.max(0, ...withReminder.map((t) => -t.remindOffset!));
  const occurrences = expandOccurrences(
    withReminder,
    completions,
    addDays(today, -Math.ceil(maxLate / 1440) - 1),
    addDays(today, REMINDER_HORIZON_DAYS + Math.ceil(maxEarly / 1440) + 1),
  );
  const earliest = now.getTime() - 10 * 60_000;
  const latest = now.getTime() + REMINDER_HORIZON_DAYS * 86400_000;
  const out: ReminderEntry[] = [];
  for (const o of occurrences) {
    if (o.completed) continue;
    const fire = reminderTime(o.date, o.task.dueTime, o.task.remindOffset!);
    if (fire.getTime() < earliest || fire.getTime() > latest) continue;
    out.push({ taskId: o.task.id, date: o.date, fireAt: fire.toISOString(), body: reminderBody(o.task, o.date, fire) });
  }
  return out;
}
