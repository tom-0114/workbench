import { defineStore } from "pinia";
import type { NewTask, Occurrence, Task } from "@/lib/types";
import { taskRepo as repo } from "@/lib/repo";
import { completionKey, expandOccurrences } from "@/lib/recurrence";
import { today } from "@/lib/date";

export const useTaskStore = defineStore("tasks", {
  state: () => ({
    tasks: [] as Task[],
    completions: new Set<string>(),
    ready: false,
    /** 数据层初始化错误（诊断用） */
    initError: "",
    /** 最近一次写操作错误，用于界面即时反馈 */
    operationError: "",
    /** 响应式的“今天”：应用常驻运行时跨零点自动滚动 */
    currentDate: today(),
    clockStarted: false,
  }),

  getters: {
    /** 未删除任务：供所有正常视图与搜索使用 */
    activeTasks(state): Task[] {
      return state.tasks.filter((task) => !task.deletedAt);
    },
    /** 今日清单（含重复任务当日实例） */
    todayOccurrences(state): Occurrence[] {
      const d = state.currentDate;
      return expandOccurrences(state.tasks.filter((task) => !task.deletedAt), state.completions, d, d).sort(
        (a, b) => b.task.priority - a.task.priority || a.task.id - b.task.id,
      );
    },
    /** 逾期：仅非重复任务，截止日期早于今天且未完成 */
    overdueTasks(state): Task[] {
      const d = state.currentDate;
      return state.tasks
        .filter((t) => !t.deletedAt && t.repeatRule === "none" && !t.completed && !!t.dueDate && t.dueDate < d)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    },
    /** 收集箱：无日期的未完成事项 */
    inboxTasks(state): Task[] {
      return state.tasks
        .filter((t) => !t.deletedAt && !t.dueDate && !t.completed)
        .sort((a, b) => a.id - b.id);
    },
    /** 回收站：最近删除的排在最前 */
    recycleBinTasks(state): Task[] {
      return state.tasks
        .filter((task) => !!task.deletedAt)
        .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
    },
  },

  actions: {
    async init() {
      this.ready = false;
      this.initError = "";
      try {
        this.tasks = await repo.listTasks();
        this.completions = await repo.listCompletions();
        this.ready = true;
        return true;
      } catch (e) {
        this.initError = String(e);
        return false;
      } finally {
        this.startDateClock();
      }
    },

    resetData() {
      this.tasks = [];
      this.completions = new Set();
      this.ready = false;
      this.initError = "";
      this.operationError = "";
    },

    clearOperationError() {
      this.operationError = "";
    },

    refreshDate() {
      const d = today();
      if (d !== this.currentDate) this.currentDate = d;
    },

    /** 每分钟检查一次日期滚动；窗口重新可见时立即刷新（应对系统睡眠期间定时器不走） */
    startDateClock() {
      if (this.clockStarted) return;
      this.clockStarted = true;
      setInterval(() => this.refreshDate(), 60_000);
      window.addEventListener("focus", () => this.refreshDate());
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.refreshDate();
      });
    },

    occurrencesInRange(start: string, end: string): Occurrence[] {
      return expandOccurrences(this.activeTasks, this.completions, start, end);
    },

    async addTask(input: Partial<NewTask> & { title: string; dueDate: string }) {
      this.operationError = "";
      try {
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
      } catch (error) {
        this.operationError = "新建失败，请检查网络后重试";
        throw error;
      }
    },

    async updateTask(task: Task) {
      this.operationError = "";
      try {
        await repo.updateTask(task);
        const i = this.tasks.findIndex((t) => t.id === task.id);
        if (i >= 0) this.tasks[i] = { ...task };
      } catch (error) {
        this.operationError = "保存失败，请检查网络后重试";
        throw error;
      }
    },

    async deleteTask(id: number) {
      this.operationError = "";
      try {
        await repo.deleteTask(id);
        const index = this.tasks.findIndex((task) => task.id === id);
        if (index >= 0) {
          const deletedAt = new Date().toISOString();
          this.tasks[index] = { ...this.tasks[index], deletedAt, updatedAt: deletedAt };
        }
      } catch (error) {
        this.operationError = "删除失败，请检查网络后重试";
        throw error;
      }
    },

    async moveTask(id: number, newDate: string) {
      const task = this.tasks.find((t) => t.id === id);
      if (!task) return;
      // 拖拽的是重复任务的某天实例；改 dueDate 会移动整个系列的锚点。
      // 系列日期只允许在编辑弹窗里调整，这里明确拒绝并提示。
      if (task.repeatRule !== "none") {
        this.operationError = "重复任务请在编辑中调整日期，拖拽会影响整个系列";
        return;
      }
      await this.updateTask({ ...task, dueDate: newDate });
    },

    /** 切换完成状态：非重复任务改 completed；重复任务写当日打卡 */
    async toggleOccurrence(occ: Occurrence) {
      this.operationError = "";
      try {
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
      } catch (error) {
        if (!this.operationError) this.operationError = "更新状态失败，请检查网络后重试";
        throw error;
      }
    },

    async restoreTask(id: number) {
      this.operationError = "";
      try {
        await repo.restoreTask(id);
        const index = this.tasks.findIndex((task) => task.id === id);
        if (index >= 0) this.tasks[index] = { ...this.tasks[index], deletedAt: null };
      } catch (error) {
        this.operationError = "恢复失败，请检查网络后重试";
        throw error;
      }
    },

    async permanentlyDeleteTask(id: number) {
      this.operationError = "";
      try {
        await repo.permanentlyDeleteTask(id);
        this.tasks = this.tasks.filter((task) => task.id !== id);
        this.completions = new Set([...this.completions].filter((key) => !key.startsWith(`${id}:`)));
      } catch (error) {
        this.operationError = "永久删除失败，请检查网络后重试";
        throw error;
      }
    },
  },
});
