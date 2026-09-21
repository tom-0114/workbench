// 一次性视觉验收用 mock API：按 src/lib/repo.ts 的 RestRepo 契约返回内存样例数据。
// 不参与构建与部署，验收完即可删除。
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.env.PORT || 3002);
const TODAY = "2026-09-03";
const now = "2026-09-03T08:00:00.000Z";

let nextId = 100;
const tasks = [
  { id: 1, title: "回复评审意见", notes: "优先处理登录模块的两条意见", dueDate: TODAY, priority: 1, tags: ["工作"], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 2, title: "整理周报", notes: "", dueDate: TODAY, priority: 0, tags: [], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 3, title: "下单采购清单", notes: "打印纸、咖啡豆", dueDate: TODAY, priority: 2, tags: ["生活"], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 4, title: "更新设计系统", notes: "", dueDate: TODAY, priority: 0, tags: [], repeatRule: "none", completed: true, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 5, title: "提交报销单", notes: "", dueDate: "2026-09-01", priority: 3, tags: [], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 6, title: "预约牙医", notes: "", dueDate: "2026-08-30", priority: 0, tags: [], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 7, title: "团队周会", notes: "", dueDate: "2026-09-07", priority: 1, tags: ["工作"], repeatRule: "weekly", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 8, title: "版本发布", notes: "v0.1.9", dueDate: "2026-09-15", priority: 1, tags: ["工作"], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 9, title: "体检预约", notes: "", dueDate: "2026-09-21", priority: 0, tags: [], repeatRule: "yearly", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 10, title: "月度复盘", notes: "", dueDate: "2026-09-28", priority: 0, tags: [], repeatRule: "monthly", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 11, title: "读书笔记素材", notes: "", dueDate: "", priority: 0, tags: [], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 12, title: "给妈妈买生日礼物", notes: "", dueDate: "", priority: 2, tags: ["生活"], repeatRule: "none", completed: false, deletedAt: null, createdAt: now, updatedAt: now },
  { id: 13, title: "废弃草稿", notes: "", dueDate: "2026-08-20", priority: 0, tags: [], repeatRule: "none", completed: false, deletedAt: now, createdAt: now, updatedAt: now },
];
const completions = new Set([`4:${TODAY}`, `7:2026-08-31`, `7:2026-08-24`]);

const json = (res, code, body, headers = {}) => {
  res.writeHead(code, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body ?? null));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "") || "/";
  const method = req.method;

  if (path === "/api/auth/session") return json(res, 200, { authenticated: true, username: "demo" });
  if (path === "/api/auth/login") return json(res, 200, { authenticated: true, username: "demo" });
  if (path === "/api/auth/logout") return json(res, 204);
  if (path === "/api/tasks" && method === "GET") return json(res, 200, tasks);
  if (path === "/api/tasks" && method === "POST") {
    const input = await readBody(req);
    const task = { notes: "", priority: 0, tags: [], repeatRule: "none", completed: false, ...input, id: nextId++, deletedAt: null, createdAt: now, updatedAt: now };
    tasks.push(task);
    return json(res, 201, task);
  }
  let m = path.match(/^\/api\/tasks\/(\d+)$/);
  if (m && method === "PUT") {
    const t = tasks.find((t) => t.id === Number(m[1]));
    Object.assign(t, await readBody(req));
    return json(res, 204);
  }
  if (m && method === "DELETE") {
    const t = tasks.find((t) => t.id === Number(m[1]));
    if (t) t.deletedAt = now;
    return json(res, 204);
  }
  m = path.match(/^\/api\/tasks\/(\d+)\/restore$/);
  if (m && method === "POST") {
    const t = tasks.find((t) => t.id === Number(m[1]));
    if (t) t.deletedAt = null;
    return json(res, 204);
  }
  m = path.match(/^\/api\/tasks\/(\d+)\/permanent$/);
  if (m && method === "DELETE") {
    const i = tasks.findIndex((t) => t.id === Number(m[1]));
    if (i >= 0) tasks.splice(i, 1);
    return json(res, 204);
  }
  if (path === "/api/completions" && method === "GET") return json(res, 200, [...completions]);
  if (path === "/api/completions" && method === "POST") {
    const { taskId, date, done } = await readBody(req);
    const key = `${taskId}:${date}`;
    done ? completions.add(key) : completions.delete(key);
    return json(res, 204);
  }
  return json(res, 404, { error: "not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`[mock] listening on 127.0.0.1:${PORT}`));
