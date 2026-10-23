import { reactive } from "vue";
import { settingsRepo } from "./repo";

export interface SchoolBreak {
  name: string;
  start: string;
  /** 空串表示结束日还没公布，只标开始那天 */
  end: string;
}

export interface SchoolBreakSettings {
  enabled: boolean;
  breaks: SchoolBreak[];
}

/** 没配置过时的默认值：苏州 2026—2027 学年第一学期校历只公布了寒假从 1 月 27 日开始 */
const DEFAULTS: SchoolBreakSettings = {
  enabled: true,
  breaks: [{ name: "寒假", start: "2027-01-27", end: "" }],
};

/** 按账号存在后端；日历页打开时载入 */
export const schoolBreaks = reactive<SchoolBreakSettings & { loaded: boolean }>({
  ...structuredClone(DEFAULTS),
  loaded: false,
});

export async function loadSchoolBreaks() {
  try {
    const saved = await settingsRepo.getSchoolBreaks();
    Object.assign(schoolBreaks, saved ?? structuredClone(DEFAULTS), { loaded: true });
  } catch {
    // 读取失败沿用当前值，下次打开日历再试
  }
}

export async function saveSchoolBreaks(value: SchoolBreakSettings) {
  const saved = await settingsRepo.putSchoolBreaks(value);
  Object.assign(schoolBreaks, saved, { loaded: true });
}

/** 某天落在哪个假期里；关闭显示时返回 undefined */
export function getSchoolBreak(date: string): SchoolBreak | undefined {
  if (!schoolBreaks.enabled) return undefined;
  return schoolBreaks.breaks.find((b) => date >= b.start && date <= (b.end || b.start));
}
