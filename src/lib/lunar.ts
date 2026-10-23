import { Solar } from "lunar-typescript";
import { parseDate } from "./date";

// 换算较重，大清单每行都要用，按日期缓存
const cache = new Map<string, ReturnType<Solar["getLunar"]>>();
function lunarOf(date: string) {
  let lunar = cache.get(date);
  if (!lunar) {
    const d = parseDate(date);
    lunar = Solar.fromYmd(d.getFullYear(), d.getMonth() + 1, d.getDate()).getLunar();
    cache.set(date, lunar);
  }
  return lunar;
}

/** 农历月日，如「九月十三」「闰六月初一」「腊月三十」 */
export function lunarText(date: string): string {
  if (!date) return "";
  const l = lunarOf(date);
  return `${l.getMonthInChinese()}月${l.getDayInChinese()}`;
}

/** 日历格子里的短标签：传统节日 > 节气 > 初一显示月份 > 日；special 表示节日或节气 */
export function lunarCellText(date: string): { text: string; special: boolean } {
  const l = lunarOf(date);
  const festival = l.getFestivals()[0];
  if (festival) return { text: festival, special: true };
  const jieQi = l.getJieQi();
  if (jieQi) return { text: jieQi, special: true };
  if (l.getDay() === 1) return { text: `${l.getMonthInChinese()}月`, special: false };
  return { text: l.getDayInChinese(), special: false };
}
