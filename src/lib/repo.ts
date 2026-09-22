import type { NewTask, Task } from "./types";

/** REST API 见 server/index.mjs；BASE_URL 由 vite 注入，部署在 /workbench/ 子路径时为 "/workbench/" */
const BASE = `${import.meta.env.BASE_URL}api`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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

export const taskRepo = {
  listTasks: () => request<Task[]>("/tasks"),
  createTask: (input: NewTask) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(input) }),
  updateTask: (task: Task) =>
    request<void>(`/tasks/${task.id}`, { method: "PUT", body: JSON.stringify(task) }),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
  restoreTask: (id: number) => request<void>(`/tasks/${id}/restore`, { method: "POST" }),
  permanentlyDeleteTask: (id: number) =>
    request<void>(`/tasks/${id}/permanent`, { method: "DELETE" }),
  /** 重复任务打卡记录，"taskId:date" 集合 */
  listCompletions: async () => new Set(await request<string[]>("/completions")),
  setCompletion: (taskId: number, date: string, done: boolean) =>
    request<void>("/completions", { method: "POST", body: JSON.stringify({ taskId, date, done }) }),
};
