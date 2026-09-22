// 个人工作台后端：PostgreSQL REST API。
// 数据语义见 src/lib/types.ts：
//   Task: { id, title, notes, dueDate, priority, tags, repeatRule, completed, deletedAt, createdAt, updatedAt }
//   completions: "taskId:date" 集合（重复任务按天打卡）
// 单用户个人应用；Web API 使用签名 HttpOnly Cookie 鉴权，表结构在启动时自动创建。
import { Pool } from "pg";
import { createServer } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 3002);
const AUTH_USERNAME = process.env.AUTH_USERNAME || "admin";
const AUTH_PASSWORD_HASH =
  process.env.AUTH_PASSWORD_SHA256 ||
  (process.env.AUTH_PASSWORD
    ? createHash("sha256").update(process.env.AUTH_PASSWORD).digest("hex")
    : "");
const AUTH_SECRET = process.env.AUTH_SECRET;
const AUTH_COOKIE_PATH = process.env.AUTH_COOKIE_PATH || "/";
const SESSION_COOKIE = "wb_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

if (!/^[a-f0-9]{64}$/i.test(AUTH_PASSWORD_HASH) || !AUTH_SECRET || AUTH_SECRET.length < 32) {
  throw new Error("AUTH_PASSWORD_SHA256 与至少 32 字符的 AUTH_SECRET 必须配置");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  notes       TEXT NOT NULL DEFAULT '',
  due_date    TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 0,
  tags        JSONB NOT NULL DEFAULT '[]',
  repeat_rule TEXT NOT NULL DEFAULT 'none',
  completed   BOOLEAN NOT NULL DEFAULT false,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_completions (
  task_id BIGINT NOT NULL,
  date    TEXT NOT NULL,
  PRIMARY KEY (task_id, date)
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TEXT;
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const PROJECT_ID_RE = /^[a-z0-9]{2,20}-[a-z0-9]{2,12}$/;

function isValidProject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 80) return false;
  if (typeof data.description !== "string" || data.description.length > 500) return false;
  return true;
}

function rowToProject(r) {
  return { ...r.data, id: r.id, createdAt: r.created_at, updatedAt: r.updated_at };
}

async function listProjects() {
  const { rows } = await pool.query("SELECT * FROM projects");
  return rows.map(rowToProject);
}

async function upsertProject(id, data) {
  const now = new Date().toISOString();
  const createdAt =
    typeof data.createdAt === "string" && !Number.isNaN(Date.parse(data.createdAt)) ? data.createdAt : now;
  await pool.query(
    `INSERT INTO projects (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (id) DO UPDATE SET data = $2::jsonb, updated_at = $4`,
    [id, JSON.stringify(data), createdAt, now],
  );
}

async function deleteProject(id) {
  await pool.query("DELETE FROM projects WHERE id = $1", [id]);
}

async function init() {
  await pool.query(SCHEMA);
}

function rowToTask(r) {
  return {
    id: Number(r.id),
    title: r.title,
    notes: r.notes,
    dueDate: r.due_date,
    priority: r.priority,
    tags: r.tags ?? [],
    repeatRule: r.repeat_rule,
    completed: !!r.completed,
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function listTasks() {
  const { rows } = await pool.query("SELECT * FROM tasks ORDER BY id");
  return rows.map(rowToTask);
}

async function createTask(input) {
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, notes, due_date, priority, tags, repeat_rule, completed, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING *`,
    [
      input.title,
      input.notes ?? "",
      input.dueDate,
      input.priority ?? 0,
      JSON.stringify(input.tags ?? []),
      input.repeatRule ?? "none",
      !!input.completed,
      now,
      now,
    ],
  );
  return rowToTask(rows[0]);
}

async function updateTask(task) {
  await pool.query(
    `UPDATE tasks SET title=$1, notes=$2, due_date=$3, priority=$4, tags=$5::jsonb,
       repeat_rule=$6, completed=$7, updated_at=$8 WHERE id=$9`,
    [
      task.title,
      task.notes ?? "",
      task.dueDate,
      task.priority ?? 0,
      JSON.stringify(task.tags ?? []),
      task.repeatRule ?? "none",
      !!task.completed,
      new Date().toISOString(),
      task.id,
    ],
  );
}

async function deleteTask(id) {
  const now = new Date().toISOString();
  await pool.query("UPDATE tasks SET deleted_at=$1, updated_at=$1 WHERE id=$2", [now, id]);
}

async function restoreTask(id) {
  await pool.query("UPDATE tasks SET deleted_at=NULL, updated_at=$1 WHERE id=$2", [new Date().toISOString(), id]);
}

async function permanentlyDeleteTask(id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM task_completions WHERE task_id=$1", [id]);
    await client.query("DELETE FROM tasks WHERE id=$1", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listCompletions() {
  const { rows } = await pool.query("SELECT task_id, date FROM task_completions");
  return rows.map((r) => `${r.task_id}:${r.date}`);
}

async function setCompletion(taskId, date, done) {
  if (done) {
    await pool.query("INSERT INTO task_completions (task_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      taskId,
      date,
    ]);
  } else {
    await pool.query("DELETE FROM task_completions WHERE task_id=$1 AND date=$2", [taskId, date]);
  }
}

function json(res, status, data, headers = {}) {
  const body = data === undefined ? "" : JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1024 * 1024) throw new Error("request body too large");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeEqual(left, right) {
  const a = createHash("sha256").update(String(left)).digest();
  const b = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function passwordMatches(password) {
  const digest = createHash("sha256").update(String(password)).digest("hex");
  return safeEqual(digest, AUTH_PASSWORD_HASH);
}

function sign(value) {
  return createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ username: AUTH_USERNAME, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  const cookies = {};
  for (const item of String(req.headers.cookie || "").split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    cookies[item.slice(0, index).trim()] = item.slice(index + 1).trim();
  }
  return cookies;
}

function hasValidSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.username === AUTH_USERNAME && Number(parsed.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function isHttps(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

function sessionCookie(req, token, maxAge = SESSION_MAX_AGE) {
  return [
    `${SESSION_COOKIE}=${token}`,
    `Path=${AUTH_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    isHttps(req) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clientIp(req) {
  return String(req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown").trim();
}

const loginAttempts = new Map();

function getLoginAttempt(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(ip, fresh);
    return fresh;
  }
  return current;
}

function isCrossSiteMutation(req, method) {
  return !["GET", "HEAD", "OPTIONS"].includes(method) && req.headers["sec-fetch-site"] === "cross-site";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method || "GET";

  try {
    if (path === "/api/health") {
      await pool.query("SELECT 1");
      return json(res, 200, { ok: true });
    }
    if (path === "/api/auth/session" && method === "GET") {
      return json(res, 200, { authenticated: hasValidSession(req), username: AUTH_USERNAME });
    }
    if (path === "/api/auth/login" && method === "POST") {
      if (isCrossSiteMutation(req, method)) return json(res, 403, { error: "请求来源无效" });
      const ip = clientIp(req);
      const attempt = getLoginAttempt(ip);
      if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
        const retryAfter = Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 1000));
        return json(
          res,
          429,
          { error: "尝试次数过多，请稍后再试", retryAfter },
          { "retry-after": String(retryAfter) },
        );
      }
      const { username, password } = await readBody(req);
      if (!safeEqual(username, AUTH_USERNAME) || !passwordMatches(password)) {
        attempt.count += 1;
        return json(res, 401, { error: "账号或密码不正确" });
      }
      loginAttempts.delete(ip);
      return json(
        res,
        200,
        { authenticated: true, username: AUTH_USERNAME },
        { "set-cookie": sessionCookie(req, createSessionToken()) },
      );
    }
    if (path === "/api/auth/logout" && method === "POST") {
      if (isCrossSiteMutation(req, method)) return json(res, 403, { error: "请求来源无效" });
      return json(
        res,
        204,
        undefined,
        { "set-cookie": sessionCookie(req, "", 0) },
      );
    }

    if (!hasValidSession(req)) return json(res, 401, { error: "请先登录" });
    if (isCrossSiteMutation(req, method)) return json(res, 403, { error: "请求来源无效" });

    if (path === "/api/tasks" && method === "GET") return json(res, 200, await listTasks());
    if (path === "/api/tasks" && method === "POST") return json(res, 201, await createTask(await readBody(req)));
    const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && method === "PUT") {
      await updateTask({ ...(await readBody(req)), id: Number(taskMatch[1]) });
      return json(res, 204);
    }
    if (taskMatch && method === "DELETE") {
      await deleteTask(Number(taskMatch[1]));
      return json(res, 204);
    }
    const restoreMatch = path.match(/^\/api\/tasks\/(\d+)\/restore$/);
    if (restoreMatch && method === "POST") {
      await restoreTask(Number(restoreMatch[1]));
      return json(res, 204);
    }
    const permanentMatch = path.match(/^\/api\/tasks\/(\d+)\/permanent$/);
    if (permanentMatch && method === "DELETE") {
      await permanentlyDeleteTask(Number(permanentMatch[1]));
      return json(res, 204);
    }
    if (path === "/api/completions" && method === "GET") return json(res, 200, await listCompletions());
    if (path === "/api/completions" && method === "POST") {
      const { taskId, date, done } = await readBody(req);
      if (!Number.isInteger(taskId) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        return json(res, 400, { error: "参数无效" });
      }
      await setCompletion(taskId, date, !!done);
      return json(res, 204);
    }

    // 项目工作台：整份项目文档（含灵感/需求/任务/资料/动态）按 JSONB 存储
    if (path === "/api/projects" && method === "GET") return json(res, 200, await listProjects());
    const projectMatch = path.match(/^\/api\/projects\/([a-z0-9-]+)$/);
    if (projectMatch && method === "PUT") {
      const id = projectMatch[1];
      if (!PROJECT_ID_RE.test(id)) return json(res, 400, { error: "参数无效" });
      const data = await readBody(req);
      if (!isValidProject(data)) return json(res, 400, { error: "项目数据无效" });
      delete data.id;
      await upsertProject(id, data);
      return json(res, 204);
    }
    if (projectMatch && method === "DELETE") {
      if (!PROJECT_ID_RE.test(projectMatch[1])) return json(res, 400, { error: "参数无效" });
      await deleteProject(projectMatch[1]);
      return json(res, 204);
    }
    return json(res, 404, { error: "not found" });
  } catch (error) {
    console.error(`[workbench-api] ${method} ${path} failed:`, error);
    return json(res, 500, { error: "internal error" });
  }
});

init()
  .then(() => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[workbench-api] listening on 127.0.0.1:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("[workbench-api] init failed:", error);
    process.exit(1);
  });
