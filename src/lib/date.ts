/** 本地时区的 YYYY-MM-DD */
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 解析 YYYY-MM-DD 为本地时区 Date */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return fmtDate(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD 加减天数 */
export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/** month 为 1-12 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
