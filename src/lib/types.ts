export type RepeatRule = "none" | "daily" | "workday" | "weekly" | "monthly" | "yearly" | "yearly-lunar";

export type Priority = 0 | 1 | 2 | 3; // 0无 1低 2中 3高

export interface Task {
  id: number;
  title: string;
  notes: string;
  dueDate: string; // YYYY-MM-DD
  /** HH:mm，空串表示全天 */
  dueTime: string;
  /** 提前多少分钟提醒，null 不提醒；全天任务以当天 09:00 为基准 */
  remindOffset: number | null;
  priority: Priority;
  tags: string[];
  repeatRule: RepeatRule;
  /** 重复截止日（含当天），空串或缺省表示一直重复 */
  repeatUntil?: string;
  completed: boolean; // 仅非重复任务使用
  completedAt: string | null; // 非重复任务的完成时间；旧数据为空
  /** 重复任务的单次改期例外：锚点展开日期 -> 新日期；空串表示该次不出现 */
  dateOverrides?: Record<string, string>;
  deletedAt: string | null; // 软删除时间；非空时只在回收站显示
  /** 子任务指向父任务（只有一层）；子任务没有日期，只在父任务下面显示 */
  parentId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type NewTask = Omit<Task, "id" | "deletedAt" | "createdAt" | "updatedAt" | "completedAt">;

/** 日历/列表上实际渲染的一条：非重复任务本身，或重复任务在某天的实例 */
export interface Occurrence {
  task: Task;
  date: string; // YYYY-MM-DD
  completed: boolean;
  isVirtual: boolean; // true = 重复任务展开出的实例
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: "无",
  1: "低",
  2: "中",
  3: "高",
};

export const REPEAT_LABELS: Record<RepeatRule, string> = {
  none: "不重复",
  daily: "每天",
  workday: "每个工作日",
  weekly: "每周",
  monthly: "每月",
  yearly: "每年",
  "yearly-lunar": "每年·农历",
};

