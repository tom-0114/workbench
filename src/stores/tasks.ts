import { defineStore } from "pinia";
import type { NewTask, Occurrence, Task } from "@/lib/types";
import { createRepo } from "@/lib/repo";
import { completionKey, expandOccurrences } from "@/lib/recurrence";
import { today } from "@/lib/date";

const repo = createRepo();

export const useTaskStore = defineStore("tasks", {
  state: () => ({
    tasks: [] as Task[],
    completions: new Set<string>(),
    ready: false,
    /** 响应式的“今天”：应用常驻运行时跨零点自动滚动 */
    currentDate: today(),
  }),

  getters: {
    /** 今日清单（含重复任务当日实例） */
    todayOccurrences(state): Occurrence[] {
      const d = state.currentDate;
      return expandOccurrences(state.tasks, state.completions, d, d).sort(
        (a, b) => b.task.priority - a.task.priority || a.task.id - b.task.id,
      );
    },
    /** 逾期：仅非重复任务，截止日期早于今天且未完成 */
    overdueTasks(state): Task[] {
      const d = state.currentDate;
      return state.tasks
        .filter((t) => t.repeatRule === "none" && !t.completed && !!t.dueDate && t.dueDate < d)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    },
    /** 收集箱：无日期的未完成事项 */
    inboxTasks(state): Task[] {
      return state.tasks
        .filter((t) => !t.dueDate && !t.completed)
        .sort((a, b) => a.id - b.id);
    },
  },

  actions: {
    async init() {
      await repo.init();
      this.tasks = await repo.listTasks();
      this.completions = await repo.listCompletions();
      this.ready = true;
      this.startDateClock();
    },

    refreshDate() {
      const d = today();
      if (d !== this.currentDate) this.currentDate = d;
    },

    /** 每分钟检查一次日期滚动；窗口重新可见时立即刷新（应对系统睡眠期间定时器不走） */
    startDateClock() {
      setInterval(() => this.refreshDate(), 60_000);
      window.addEventListener("focus", () => this.refreshDate());
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.refreshDate();
      });
    },

    occurrencesInRange(start: string, end: string): Occurrence[] {
      return expandOccurrences(this.tasks, this.completions, start, end);
    },

    async addTask(input: Partial<NewTask> & { title: string; dueDate: string }) {
      const task = await repo.createTask({
        notes: "",
        priority: 0,
        tags: [],
        repeatRule: "none",
        completed: false,
        ...input,
      });
      this.tasks.push(task);
      return task;
    },

    async updateTask(task: Task) {
      await repo.updateTask(task);
      const i = this.tasks.findIndex((t) => t.id === task.id);
      if (i >= 0) this.tasks[i] = { ...task };
    },

    async deleteTask(id: number) {
      await repo.deleteTask(id);
      this.tasks = this.tasks.filter((t) => t.id !== id);
      this.completions = new Set([...this.completions].filter((k) => !k.startsWith(`${id}:`)));
    },

    async moveTask(id: number, newDate: string) {
      const task = this.tasks.find((t) => t.id === id);
      if (!task) return;
      await this.updateTask({ ...task, dueDate: newDate });
    },

    /** 切换完成状态：非重复任务改 completed；重复任务写当日打卡 */
    async toggleOccurrence(occ: Occurrence) {
      if (occ.isVirtual) {
        const done = !occ.completed;
        await repo.setCompletion(occ.task.id, occ.date, done);
        const key = completionKey(occ.task.id, occ.date);
        const next = new Set(this.completions);
        if (done) next.add(key);
        else next.delete(key);
        this.completions = next;
      } else {
        await this.updateTask({ ...occ.task, completed: !occ.task.completed });
      }
    },
  },
});
