import type { Task } from "./types";
import { expandOccurrences } from "./recurrence";
import { addDays, fmtDate, parseDate } from "./date";

/** 前端算好未来这段时间的提醒交给后端；长期不打开应用，重复任务的提醒会在这之后停止 */
export const REMINDER_HORIZON_DAYS = 35;
const ALLDAY_HOUR = 9;

export interface ReminderEntry {
  taskId: number;
  date: string;
  fireAt: string;
  body: string;
}

/** 某次实例的提醒时刻（本地时区）；全天任务以当天 09:00 为基准 */
export function reminderTime(date: string, dueTime: string, offset: number): Date {
  const d = parseDate(date);
  const [h, m] = dueTime ? dueTime.split(":").map(Number) : [ALLDAY_HOUR, 0];
  d.setHours(h, m, 0, 0);
  return new Date(d.getTime() - offset * 60_000);
}

/** 通知正文按“提醒那一刻”来说：今天 14:30 / 明天的待办 */
function reminderBody(date: string, dueTime: string, fire: Date): string {
  const fireDay = fmtDate(fire);
  const d = parseDate(date);
  const day = date === fireDay ? "今天" : date === addDays(fireDay, 1) ? "明天" : `${d.getMonth() + 1}月${d.getDate()}日`;
  return dueTime ? `${day} ${dueTime}` : `${day}的待办`;
}

export function buildReminderSchedule(tasks: Task[], completions: Set<string>, now = new Date()): ReminderEntry[] {
  const withReminder = tasks.filter((t) => !t.deletedAt && t.dueDate && t.remindOffset != null);
  if (!withReminder.length) return [];
  const start = fmtDate(now);
  const occurrences = expandOccurrences(withReminder, completions, start, addDays(start, REMINDER_HORIZON_DAYS));
  const earliest = now.getTime() - 10 * 60_000;
  const out: ReminderEntry[] = [];
  for (const o of occurrences) {
    if (o.completed) continue;
    const fire = reminderTime(o.date, o.task.dueTime, o.task.remindOffset!);
    if (fire.getTime() < earliest) continue;
    out.push({ taskId: o.task.id, date: o.date, fireAt: fire.toISOString(), body: reminderBody(o.date, o.task.dueTime, fire) });
  }
  return out;
}
