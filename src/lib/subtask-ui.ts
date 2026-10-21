import { reactive } from "vue";

/** 列表里展开了子任务的行（任务 id:日期），切换清单后保持展开 */
export const expandedSubtasks = reactive(new Set<string>());
