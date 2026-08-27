import type { NewTask, Task } from "./types";
import { nowIso } from "./date";

export interface TaskRepository {
  init(): Promise<void>;
  listTasks(): Promise<Task[]>;
  createTask(input: NewTask): Promise<Task>;
  updateTask(task: Task): Promise<void>;
  deleteTask(id: number): Promise<void>;
  /** 重复任务打卡记录，返回 "taskId:date" 集合 */
  listCompletions(): Promise<Set<string>>;
  setCompletion(taskId: number, date: string, done: boolean): Promise<void>;
}

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    repeat_rule TEXT NOT NULL DEFAULT 'none',
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS task_completions (
    task_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    PRIMARY KEY (task_id, date)
  )`,
];

interface TaskRow {
  id: number;
  title: string;
  notes: string;
  due_date: string;
  priority: number;
  tags: string;
  repeat_rule: string;
  completed: number;
  created_at: string;
  updated_at: string;
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueDate: r.due_date,
    priority: (r.priority ?? 0) as Task["priority"],
    tags: JSON.parse(r.tags || "[]"),
    repeatRule: (r.repeat_rule || "none") as Task["repeatRule"],
    completed: !!r.completed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Tauri 环境：SQLite（应用数据目录 workspace.db） */
class SqliteRepo implements TaskRepository {
  private db: import("@tauri-apps/plugin-sql").default | null = null;

  async init(): Promise<void> {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    this.db = await Database.load("sqlite:workspace.db");
    for (const sql of SCHEMA) await this.db.execute(sql);
  }

  async listTasks(): Promise<Task[]> {
    const rows = await this.db!.select<TaskRow[]>("SELECT * FROM tasks ORDER BY id");
    return rows.map(rowToTask);
  }

  async createTask(input: NewTask): Promise<Task> {
    const now = nowIso();
    const res = await this.db!.execute(
      `INSERT INTO tasks (title, notes, due_date, priority, tags, repeat_rule, completed, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.title,
        input.notes,
        input.dueDate,
        input.priority,
        JSON.stringify(input.tags),
        input.repeatRule,
        input.completed ? 1 : 0,
        now,
        now,
      ],
    );
    return { ...input, id: res.lastInsertId ?? 0, createdAt: now, updatedAt: now };
  }

  async updateTask(task: Task): Promise<void> {
    const now = nowIso();
    await this.db!.execute(
      `UPDATE tasks SET title=$1, notes=$2, due_date=$3, priority=$4, tags=$5, repeat_rule=$6, completed=$7, updated_at=$8 WHERE id=$9`,
      [
        task.title,
        task.notes,
        task.dueDate,
        task.priority,
        JSON.stringify(task.tags),
        task.repeatRule,
        task.completed ? 1 : 0,
        now,
        task.id,
      ],
    );
  }

  async deleteTask(id: number): Promise<void> {
    await this.db!.execute("DELETE FROM tasks WHERE id=$1", [id]);
    await this.db!.execute("DELETE FROM task_completions WHERE task_id=$1", [id]);
  }

  async listCompletions(): Promise<Set<string>> {
    const rows = await this.db!.select<{ task_id: number; date: string }[]>(
      "SELECT task_id, date FROM task_completions",
    );
    return new Set(rows.map((r) => `${r.task_id}:${r.date}`));
  }

  async setCompletion(taskId: number, date: string, done: boolean): Promise<void> {
    if (done) {
      await this.db!.execute(
        "INSERT OR IGNORE INTO task_completions (task_id, date) VALUES ($1, $2)",
        [taskId, date],
      );
    } else {
      await this.db!.execute("DELETE FROM task_completions WHERE task_id=$1 AND date=$2", [
        taskId,
        date,
      ]);
    }
  }
}

/** 浏览器开发环境：localStorage，字段语义与 SQLite 版一致 */
class LocalRepo implements TaskRepository {
  private tasksKey = "workbench.tasks";
  private completionsKey = "workbench.completions";

  private readTasks(): Task[] {
    return JSON.parse(localStorage.getItem(this.tasksKey) || "[]");
  }
  private writeTasks(tasks: Task[]): void {
    localStorage.setItem(this.tasksKey, JSON.stringify(tasks));
  }

  async init(): Promise<void> {}

  async listTasks(): Promise<Task[]> {
    return this.readTasks();
  }

  async createTask(input: NewTask): Promise<Task> {
    const tasks = this.readTasks();
    const now = nowIso();
    const task: Task = {
      ...input,
      id: tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    this.writeTasks(tasks);
    return task;
  }

  async updateTask(task: Task): Promise<void> {
    const tasks = this.readTasks();
    const i = tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) {
      tasks[i] = { ...task, updatedAt: nowIso() };
      this.writeTasks(tasks);
    }
  }

  async deleteTask(id: number): Promise<void> {
    this.writeTasks(this.readTasks().filter((t) => t.id !== id));
    const set = await this.listCompletions();
    const kept = [...set].filter((k) => !k.startsWith(`${id}:`));
    localStorage.setItem(this.completionsKey, JSON.stringify(kept));
  }

  async listCompletions(): Promise<Set<string>> {
    return new Set(JSON.parse(localStorage.getItem(this.completionsKey) || "[]"));
  }

  async setCompletion(taskId: number, date: string, done: boolean): Promise<void> {
    const set = await this.listCompletions();
    const key = `${taskId}:${date}`;
    if (done) set.add(key);
    else set.delete(key);
    localStorage.setItem(this.completionsKey, JSON.stringify([...set]));
  }
}

export function createRepo(): TaskRepository {
  return isTauri ? new SqliteRepo() : new LocalRepo();
}
