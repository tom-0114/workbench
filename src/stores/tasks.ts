import { defineStore } from "pinia";
import type { NewTask, Occurrence, Task } from "@/lib/types";
import { taskRepo as repo } from "@/lib/repo";
import { completionKey, expandOccurrences } from "@/lib/recurrence";
import { addDays, nowIso, parseDate, today } from "@/lib/date";
import { buildReminderSchedule, foldTimeIntoReminder } from "@/lib/reminders";
import type { TaskBackup } from "@/lib/backup";

let reminderTimer: ReturnType<typeof setTimeout> | undefined;

/** 顶层任务：清单、日历、回收站只显示这些，子任务挂在父任务下面 */
const isTopLevel = (task: Task) => !task.parentId;
let lastReminderCount = 0;
let hiddenAt = 0;

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
      return state.tasks.filter((task) => !task.deletedAt && isTopLevel(task));
    },
    /** 父任务 id → 未删除的子任务（按创建顺序） */
    subtasksByParent(state): Map<number, Task[]> {
      const map = new Map<number, Task[]>();
      for (const task of state.tasks) {
        if (!task.parentId || task.deletedAt) continue;
        const list = map.get(task.parentId);
        if (list) list.push(task);
        else map.set(task.parentId, [task]);
      }
      for (const list of map.values()) list.sort((a, b) => a.id - b.id);
      return map;
    },
    /** 今日清单（含重复任务当日实例） */
    todayOccurrences(state): Occurrence[] {
      const d = state.currentDate;
      return expandOccurrences(state.tasks.filter((task) => !task.deletedAt && isTopLevel(task)), state.completions, d, d).sort(
        (a, b) => b.task.priority - a.task.priority || a.task.id - b.task.id,
      );
    },
    /** 逾期：仅非重复任务，截止日期早于今天且未完成 */
    overdueTasks(state): Task[] {
      const d = state.currentDate;
      return state.tasks
        .filter((t) => !t.deletedAt && isTopLevel(t) && t.repeatRule === "none" && !t.completed && !!t.dueDate && t.dueDate < d)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    },
    /** 收集箱：无日期的未完成事项 */
    inboxTasks(state): Task[] {
      return state.tasks
        .filter((t) => !t.deletedAt && isTopLevel(t) && !t.dueDate && !t.completed)
        .sort((a, b) => a.id - b.id);
    },
    /**
     * 重复任务的连续完成次数：从最近一次实例往回数。今天的还没打卡不算断，
     * 一直数到第一个没完成的实例为止。
     */
    streaks(state): Map<number, number> {
      const result = new Map<number, number>();
      const d = state.currentDate;
      const recurring = state.tasks.filter((t) => !t.deletedAt && isTopLevel(t) && t.repeatRule !== "none" && t.dueDate && t.dueDate <= d);
      for (const task of recurring) {
        const from = task.dueDate > addDays(d, -730) ? task.dueDate : addDays(d, -730);
        const occ = expandOccurrences([task], state.completions, from, d);
        let i = occ.length - 1;
        if (i >= 0 && occ[i].date === d && !occ[i].completed) i -= 1;
        let n = 0;
        while (i >= 0 && occ[i].completed) {
          n += 1;
          i -= 1;
        }
        if (n) result.set(task.id, n);
      }
      return result;
    },
    /** 回收站：最近删除的排在最前 */
    recycleBinTasks(state): Task[] {
      return state.tasks
        .filter((task) => !!task.deletedAt && isTopLevel(task))
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
        this.scheduleReminderSync(0);
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
      if (d !== this.currentDate) {
        this.currentDate = d;
        this.scheduleReminderSync(0);
      }
    },

    /** 静默重新拉取：别的设备改过数据时，回到页面能看到最新状态，也避免用旧数据覆盖提醒排程 */
    async refresh() {
      if (!this.ready) return;
      try {
        const [tasks, completions] = await Promise.all([repo.listTasks(), repo.listCompletions()]);
        this.tasks = tasks;
        this.completions = completions;
        this.scheduleReminderSync(0);
      } catch {
        // 网络抖动时保留现有数据，下次切回页面再试。
      }
    },

    /** 任何改动后把未来的提醒重新交给后端；连续操作合并成一次 */
    scheduleReminderSync(delay = 1500) {
      clearTimeout(reminderTimer);
      reminderTimer = setTimeout(async () => {
        const list = buildReminderSchedule(this.tasks, this.completions);
        if (!list.length && !lastReminderCount) return;
        try {
          await repo.syncReminders(list);
          lastReminderCount = list.length;
        } catch {
          // 同步失败只影响推送，不打扰用户；下次改动或切回页面会重试。
        }
      }, delay);
    },

    /** 每分钟检查一次日期滚动；窗口重新可见时立即刷新（应对系统睡眠期间定时器不走） */
    startDateClock() {
      if (this.clockStarted) return;
      this.clockStarted = true;
      setInterval(() => this.refreshDate(), 60_000);
      window.addEventListener("focus", () => this.refreshDate());
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          hiddenAt = Date.now();
          return;
        }
        this.refreshDate();
        if (hiddenAt && Date.now() - hiddenAt > 60_000) void this.refresh();
      });
    },

    occurrencesInRange(start: string, end: string): Occurrence[] {
      return expandOccurrences(this.activeTasks, this.completions, start, end);
    },

    async addTask(input: Partial<NewTask> & { title: string; dueDate: string }) {
      this.operationError = "";
      try {
        const task = await repo.createTask(
          foldTimeIntoReminder({
            notes: "",
            dueTime: "",
            remindOffset: null,
            priority: 0,
            tags: [],
            repeatRule: "none",
            completed: false,
            ...input,
          }),
        );
        this.tasks.push(task);
        this.scheduleReminderSync();
        return task;
      } catch (error) {
        this.operationError = "新建失败，请检查网络后重试";
        throw error;
      }
    },

    async updateTask(task: Task) {
      this.operationError = "";
      try {
        const prev = this.tasks.find((t) => t.id === task.id);
        const next = foldTimeIntoReminder({ ...task });
        if (prev && prev.completed !== task.completed) next.completedAt = task.completed ? nowIso() : null;
        if (!next.dueDate) {
          next.dueTime = "";
          next.remindOffset = null;
        }
        if (next.repeatRule === "none") next.repeatUntil = "";
        const saved = await repo.updateTask(next);
        const i = this.tasks.findIndex((t) => t.id === task.id);
        if (i >= 0) this.tasks[i] = saved?.id === next.id ? saved : next;
        this.scheduleReminderSync();
      } catch (error) {
        this.operationError = "保存失败，请检查网络后重试";
        throw error;
      }
    },

    async deleteTask(id: number) {
      this.operationError = "";
      try {
        await repo.deleteTask(id);
        // 子任务跟着父任务进回收站
        const deletedAt = new Date().toISOString();
        this.tasks = this.tasks.map((task) =>
          task.id === id || task.parentId === id ? { ...task, deletedAt, updatedAt: deletedAt } : task,
        );
        this.scheduleReminderSync();
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

    /**
     * 行内快捷改期：重复任务可选作用范围。
     * - once（仅这一次）：写 dateOverrides 例外，把该次实例移到新日期；空串表示该次移除
     * - series（整个系列）：改锚点 dueDate 并清空旧例外——整体改期即重定义排期，
     *   保留旧例外会以“幽灵实例”的形式出现在新排期里
     */
    async rescheduleOccurrence(occ: Occurrence, newDate: string, scope: "once" | "series" = "series") {
      const task = occ.task;
      // 原生日历输入框可以被清空；重复任务没有锚点日期就无法展开，这里明确拒绝
      if (!newDate && task.repeatRule !== "none") {
        this.operationError = "重复任务需要保留日期，可在详情里改为不重复";
        return;
      }
      if (occ.isVirtual && task.repeatRule !== "none" && scope === "once") {
        const overrides = { ...(task.dateOverrides ?? {}) };
        if (newDate === occ.date) delete overrides[occ.date];
        else overrides[occ.date] = newDate;
        await this.updateTask({ ...task, dateOverrides: overrides });
        return;
      }
      if (newDate === task.dueDate) return;
      // 截止日跟着平移，保持系列的跨度不变
      let repeatUntil = task.repeatUntil ?? "";
      if (repeatUntil && task.dueDate && newDate) {
        const shift = Math.round((parseDate(newDate).getTime() - parseDate(task.dueDate).getTime()) / 86_400_000);
        repeatUntil = addDays(repeatUntil, shift);
      }
      await this.updateTask({ ...task, dueDate: newDate, repeatUntil, dateOverrides: {} });
    },

    /** 行内快捷调整优先级（0-3） */
    async setPriority(occ: Occurrence, priority: Occurrence["task"]["priority"]) {
      const task = occ.task;
      if (task.priority === priority) return;
      await this.updateTask({ ...task, priority });
    },

    /** 切换完成状态：非重复任务改 completed；重复任务写当日打卡。完成父任务时子任务一起完成 */
    async toggleOccurrence(occ: Occurrence) {
      this.operationError = "";
      try {
        const done = !occ.completed;
        await this.setOccurrenceDone(occ.task, occ.date, done);
        if (done) {
          const open = (this.subtasksByParent.get(occ.task.id) ?? []).filter((sub) => !this.isSubtaskDone(sub, occ.task, occ.date));
          for (const sub of open) await this.setOccurrenceDone(sub, occ.date, true, occ.task);
        }
      } catch (error) {
        if (!this.operationError) this.operationError = "更新状态失败，请检查网络后重试";
        throw error;
      }
    },

    /** 重复任务（含其子任务）按这一天打卡，其余改 completed */
    async setOccurrenceDone(task: Task, date: string, done: boolean, parent?: Task) {
      const recurring = (parent ?? task).repeatRule !== "none";
      if (!recurring) {
        const latest = this.tasks.find((t) => t.id === task.id) ?? task;
        if (latest.completed !== done) await this.updateTask({ ...latest, completed: done });
        return;
      }
      await repo.setCompletion(task.id, date, done);
      const key = completionKey(task.id, date);
      const next = new Set(this.completions);
      if (done) next.add(key);
      else next.delete(key);
      this.completions = next;
      this.scheduleReminderSync();
    },

    /** 子任务在父任务某次实例上的完成状态：重复父任务按天记录 */
    isSubtaskDone(sub: Task, parent: Task, date: string): boolean {
      return parent.repeatRule === "none" ? sub.completed : this.completions.has(completionKey(sub.id, date));
    },

    isParentDone(parent: Task, date: string): boolean {
      return parent.repeatRule === "none" ? parent.completed : this.completions.has(completionKey(parent.id, date));
    },

    /** 勾选子任务：全部完成时父任务自动完成；取消任一子任务时父任务重新打开 */
    async toggleSubtask(sub: Task, parentId: number, date: string) {
      this.operationError = "";
      const parent = this.tasks.find((t) => t.id === parentId);
      if (!parent) return;
      try {
        const done = !this.isSubtaskDone(sub, parent, date);
        await this.setOccurrenceDone(sub, date, done, parent);
        const latestParent = this.tasks.find((t) => t.id === parentId) ?? parent;
        const subs = this.subtasksByParent.get(parentId) ?? [];
        const allDone = subs.every((s) => this.isSubtaskDone(s, latestParent, date));
        const parentDone = this.isParentDone(latestParent, date);
        if (done && allDone && !parentDone) await this.setOccurrenceDone(latestParent, date, true);
        if (!done && parentDone) await this.setOccurrenceDone(latestParent, date, false);
      } catch (error) {
        if (!this.operationError) this.operationError = "更新状态失败，请检查网络后重试";
        throw error;
      }
    },

    /** 新加的子任务还没做，已完成的父任务随之重新打开 */
    async addSubtask(parentId: number, title: string, date: string) {
      this.operationError = "";
      const parent = this.tasks.find((t) => t.id === parentId);
      if (!parent || !title.trim()) return;
      try {
        const sub = await repo.createTask({
          title: title.trim(), notes: "", dueDate: "", dueTime: "", remindOffset: null, priority: 0, tags: [],
          repeatRule: "none", completed: false, parentId,
        });
        this.tasks.push(sub);
        if (this.isParentDone(parent, date)) await this.setOccurrenceDone(parent, date, false);
        return sub;
      } catch (error) {
        if (!this.operationError) this.operationError = "添加子任务失败，请检查网络后重试";
        throw error;
      }
    },

    /** 子任务是清单项，删除即永久删除，不进回收站 */
    async removeSubtask(sub: Task) {
      await this.permanentlyDeleteTask(sub.id);
    },

    async restoreTask(id: number) {
      this.operationError = "";
      try {
        await repo.restoreTask(id);
        this.tasks = this.tasks.map((task) =>
          task.id === id || task.parentId === id ? { ...task, deletedAt: null } : task,
        );
        this.scheduleReminderSync();
      } catch (error) {
        this.operationError = "恢复失败，请检查网络后重试";
        throw error;
      }
    },

    /** 覆盖式恢复备份；成功后整体重新载入，id 已由后端重新分配 */
    async importBackup(backup: TaskBackup) {
      const result = await repo.importBackup(backup);
      this.tasks = await repo.listTasks();
      this.completions = await repo.listCompletions();
      this.scheduleReminderSync(0);
      return result;
    },

    async permanentlyDeleteTask(id: number) {
      this.operationError = "";
      try {
        await repo.permanentlyDeleteTask(id);
        const removed = new Set(this.tasks.filter((t) => t.id === id || t.parentId === id).map((t) => `${t.id}:`));
        this.tasks = this.tasks.filter((task) => task.id !== id && task.parentId !== id);
        this.scheduleReminderSync();
        this.completions = new Set([...this.completions].filter((key) => !removed.has(key.slice(0, key.indexOf(":") + 1))));
      } catch (error) {
        this.operationError = "永久删除失败，请检查网络后重试";
        throw error;
      }
    },
  },
});
