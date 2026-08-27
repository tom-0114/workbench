import { fmtDate, parseDate } from "./date";

/**
 * 中国法定节假日 / 调休数据表。
 * 无规律可算，需每年 11 月国务院发布次年安排后手动补充。
 * 2026: 国办发明电〔2025〕7号  2025: 国办发明电〔2024〕17号
 */
export type DayMarkType = "holiday" | "workday"; // 休 / 班

export interface DayMark {
  type: DayMarkType;
  name: string;
}

/** [起始日, 结束日(含), 节日名] */
type HolidayRange = [string, string, string];

const HOLIDAYS: HolidayRange[] = [
  // 2025
  ["2025-01-01", "2025-01-01", "元旦"],
  ["2025-01-28", "2025-02-04", "春节"],
  ["2025-04-04", "2025-04-06", "清明"],
  ["2025-05-01", "2025-05-05", "劳动节"],
  ["2025-05-31", "2025-06-02", "端午"],
  ["2025-10-01", "2025-10-08", "国庆中秋"],
  // 2026
  ["2026-01-01", "2026-01-03", "元旦"],
  ["2026-02-15", "2026-02-23", "春节"],
  ["2026-04-04", "2026-04-06", "清明"],
  ["2026-05-01", "2026-05-05", "劳动节"],
  ["2026-06-19", "2026-06-21", "端午"],
  ["2026-09-25", "2026-09-27", "中秋"],
  ["2026-10-01", "2026-10-07", "国庆"],
];

/** [调休上班日, 对应节日名] */
const WORKDAYS: [string, string][] = [
  // 2025
  ["2025-01-26", "春节"],
  ["2025-02-08", "春节"],
  ["2025-04-27", "劳动节"],
  ["2025-09-28", "国庆中秋"],
  ["2025-10-11", "国庆中秋"],
  // 2026
  ["2026-01-04", "元旦"],
  ["2026-02-14", "春节"],
  ["2026-02-28", "春节"],
  ["2026-05-09", "劳动节"],
  ["2026-09-20", "国庆"],
  ["2026-10-10", "国庆"],
];

const MARKS = new Map<string, DayMark>();
for (const [start, end, name] of HOLIDAYS) {
  const cur = parseDate(start);
  const endD = parseDate(end);
  while (cur <= endD) {
    MARKS.set(fmtDate(cur), { type: "holiday", name });
    cur.setDate(cur.getDate() + 1);
  }
}
for (const [date, name] of WORKDAYS) {
  MARKS.set(date, { type: "workday", name });
}

/** 查询某天的 休/班 标记，普通日返回 undefined */
export function getDayMark(date: string): DayMark | undefined {
  return MARKS.get(date);
}
