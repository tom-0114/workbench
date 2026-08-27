export type RepeatRule = "none" | "daily" | "weekly" | "monthly";

export type Priority = 0 | 1 | 2 | 3; // 0无 1低 2中 3高

export interface Task {
  id: number;
  title: string;
  notes: string;
  dueDate: string; // YYYY-MM-DD
  priority: Priority;
  tags: string[];
  repeatRule: RepeatRule;
  completed: boolean; // 仅非重复任务使用
  createdAt: string;
  updatedAt: string;
}

export type NewTask = Omit<Task, "id" | "createdAt" | "updatedAt">;

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
  weekly: "每周",
  monthly: "每月",
};
