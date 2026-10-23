import { reactive } from "vue";
import { settingsRepo } from "./repo";

/** 日历视图的显示偏好，只影响日历页 */
export interface CalendarPrefs {
  lunar: boolean;
  /** 法定节假日“休/班”标签和底色 */
  holidayMarks: boolean;
  /** 0 周日，1 周一 */
  firstDay: 0 | 1;
  showCompleted: boolean;
  /** 年视图格子里是否画任务 */
  yearTasks: boolean;
}

const DEFAULTS: CalendarPrefs = { lunar: true, holidayMarks: true, firstDay: 1, showCompleted: true, yearTasks: true };

/** 按账号存在后端；日历页打开时载入 */
export const calendarPrefs = reactive<CalendarPrefs>({ ...DEFAULTS });

export async function loadCalendarPrefs() {
  try {
    Object.assign(calendarPrefs, DEFAULTS, (await settingsRepo.getCalendarPrefs()) ?? {});
  } catch {
    // 读取失败沿用当前值，下次打开日历再试
  }
}

export async function saveCalendarPrefs(value: CalendarPrefs) {
  Object.assign(calendarPrefs, await settingsRepo.putCalendarPrefs(value));
}
