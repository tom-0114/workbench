import type { NewTask, Task } from "./types";
import { nowIso } from "./date";

export interface TaskRepository {
  init(): Promise<void>;
  listTasks(): Promise<Task[]>;
  createTask(input: NewTask): Promise<Task>;
  updateTask(task: Task): Promise<void>;
  deleteTask(id: number): Promise<void>;
  restoreTask(id: number): Promise<void>;
  permanentlyDeleteTask(id: number): Promise<void>;
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
    deleted_at TEXT,
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
  deleted_at: string | null;
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
    deletedAt: r.deleted_at ?? null,
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
    const columns = await this.db.select<{ name: string }[]>("PRAGMA table_info(tasks)");
    if (!columns.some((column) => column.name === "deleted_at")) {
      await this.db.execute("ALTER TABLE tasks ADD COLUMN deleted_at TEXT");
    }
    await this.checkpoint();
  }

  /**
   * 每次写入后把 WAL 落入主文件。应用内更新会强杀进程，
   * 未 checkpoint 的 WAL 会丢（2026-08-27 数据丢失事故的根因）。
   * 注：改 journal_mode=DELETE 无效——sqlx 连接池的新连接会把模式重置回 WAL。
   */
  private async checkpoint(): Promise<void> {
    try {
      await this.db!.select("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // checkpoint 失败不影响业务写入本身
    }
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
    await this.checkpoint();
    return { ...input, id: res.lastInsertId ?? 0, deletedAt: null, createdAt: now, updatedAt: now };
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
    await this.checkpoint();
  }

  async deleteTask(id: number): Promise<void> {
    const now = nowIso();
    await this.db!.execute("UPDATE tasks SET deleted_at=$1, updated_at=$1 WHERE id=$2", [now, id]);
    await this.checkpoint();
  }

  async restoreTask(id: number): Promise<void> {
    await this.db!.execute("UPDATE tasks SET deleted_at=NULL, updated_at=$1 WHERE id=$2", [nowIso(), id]);
    await this.checkpoint();
  }

  async permanentlyDeleteTask(id: number): Promise<void> {
    await this.db!.execute("DELETE FROM task_completions WHERE task_id=$1", [id]);
    await this.db!.execute("DELETE FROM tasks WHERE id=$1", [id]);
    await this.checkpoint();
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
    await this.checkpoint();
  }
}

/** 浏览器 Web 版：PostgreSQL REST API（见 server/index.mjs），与桌面版数据语义一致 */
class RestRepo implements TaskRepository {
  /** vite 注入：部署在 /workbench/ 子路径时为 "/workbench/"，本地开发为 "/" */
  private base = `${import.meta.env.BASE_URL}api`;

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("wb:auth-required"));
      throw new Error("登录已失效，请重新登录");
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async init(): Promise<void> {}

  async listTasks(): Promise<Task[]> {
    return this.request<Task[]>("/tasks");
  }

  async createTask(input: NewTask): Promise<Task> {
    return this.request<Task>("/tasks", { method: "POST", body: JSON.stringify(input) });
  }

  async updateTask(task: Task): Promise<void> {
    await this.request(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(task) });
  }

  async deleteTask(id: number): Promise<void> {
    await this.request(`/tasks/${id}`, { method: "DELETE" });
  }

  async restoreTask(id: number): Promise<void> {
    await this.request(`/tasks/${id}/restore`, { method: "POST" });
  }

  async permanentlyDeleteTask(id: number): Promise<void> {
    await this.request(`/tasks/${id}/permanent`, { method: "DELETE" });
  }

  async listCompletions(): Promise<Set<string>> {
    const keys = await this.request<string[]>("/completions");
    return new Set(keys);
  }

  async setCompletion(taskId: number, date: string, done: boolean): Promise<void> {
    await this.request("/completions", { method: "POST", body: JSON.stringify({ taskId, date, done }) });
  }
}

export function createRepo(): TaskRepository {
  return isTauri ? new SqliteRepo() : new RestRepo();
}
