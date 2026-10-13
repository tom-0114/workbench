// 个人工作台后端：PostgreSQL REST API。
// 数据语义见 src/lib/types.ts：
//   Task: { id, title, notes, dueDate, priority, tags, repeatRule, completed, deletedAt, createdAt, updatedAt }
//   completions: "taskId:date" 集合（重复任务按天打卡）
// 多用户：tasks / projects 按 user_id 隔离，task_completions 经 tasks 间接隔离；仅管理员可创建账号。
// Web API 使用签名 HttpOnly Cookie 鉴权，表结构在启动时自动创建/迁移。
import { Pool } from "pg";
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const PORT = Number(process.env.PORT || 3002);
// 仅在 users 表为空时用来初始化首个管理员；之后以数据库为准
const BOOTSTRAP_USERNAME = (process.env.AUTH_USERNAME || "admin").trim().toLowerCase();
const BOOTSTRAP_PASSWORD_HASH =
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
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

if (!AUTH_SECRET || AUTH_SECRET.length < 32) {
  throw new Error("至少 32 字符的 AUTH_SECRET 必须配置");
}

const scryptAsync = promisify(scrypt);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  is_admin        BOOLEAN NOT NULL DEFAULT false,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
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
  user_id    BIGINT NOT NULL,
  id         TEXT NOT NULL,
  data       JSONB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id BIGINT;
`;

// 单用户时代的旧数据（user_id 为空）回填后再加约束；projects 主键从 (id) 迁到 (user_id, id)
const MIGRATE_CONSTRAINTS = `
ALTER TABLE tasks ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id);
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relname = 'projects' AND i.indisprimary AND i.indnatts = 1
  ) THEN
    ALTER TABLE projects DROP CONSTRAINT projects_pkey;
    ALTER TABLE projects ADD PRIMARY KEY (user_id, id);
  END IF;
END $$;
`;

/* ---------- 密码 ---------- */

// 存储格式：scrypt$salt$key；sha256$hex 仅来自 .env 初始化的管理员，登录成功后自动升级
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

async function verifyPassword(password, stored) {
  const [scheme, a, b] = String(stored).split("$");
  if (scheme === "scrypt" && a && b) {
    const expected = Buffer.from(b, "base64url");
    const actual = await scryptAsync(String(password), Buffer.from(a, "base64url"), expected.length);
    return timingSafeEqual(actual, expected);
  }
  if (scheme === "sha256" && a) {
    return safeEqual(createHash("sha256").update(String(password)).digest("hex"), a.toLowerCase());
  }
  return false;
}

function validPassword(password) {
  return typeof password === "string" && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
}

// 账号不存在时也跑一次 scrypt，避免通过响应时间探测账号
let dummyHash = "";

/* ---------- 用户 ---------- */

function rowToUser(r) {
  return { id: Number(r.id), username: r.username, isAdmin: !!r.is_admin, createdAt: r.created_at };
}

async function findUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

async function findUserByName(username) {
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] ?? null;
}

async function listUsers() {
  const { rows } = await pool.query("SELECT * FROM users ORDER BY id");
  return rows.map(rowToUser);
}

async function createUser(username, password, isAdmin = false) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO NOTHING RETURNING *`,
    [username, await hashPassword(password), isAdmin, new Date().toISOString()],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

/** 改密码同时递增 session_version，让该账号其他设备上的会话失效 */
async function setPassword(userId, password) {
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $1, session_version = session_version + 1 WHERE id = $2
     RETURNING session_version`,
    [await hashPassword(password), userId],
  );
  return rows[0] ? rows[0].session_version : null;
}

async function deleteUser(userId) {
  await withTransaction(async (client) => {
    await client.query(
      "DELETE FROM task_completions WHERE task_id IN (SELECT id FROM tasks WHERE user_id = $1)",
      [userId],
    );
    await client.query("DELETE FROM tasks WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM projects WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
  });
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function init() {
  dummyHash = await hashPassword(randomBytes(16).toString("hex"));
  await withTransaction(async (client) => {
    await client.query(SCHEMA);
    const { rows } = await client.query("SELECT id FROM users WHERE is_admin ORDER BY id LIMIT 1");
    let adminId = rows[0]?.id;
    if (!adminId) {
      if (!/^[a-f0-9]{64}$/i.test(BOOTSTRAP_PASSWORD_HASH) || !USERNAME_RE.test(BOOTSTRAP_USERNAME)) {
        throw new Error("首次启动需配置 AUTH_USERNAME 与 AUTH_PASSWORD_SHA256 以创建管理员");
      }
      const created = await client.query(
        `INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ($1, $2, true, $3)
         ON CONFLICT (username) DO UPDATE SET is_admin = true RETURNING id`,
        [BOOTSTRAP_USERNAME, `sha256$${BOOTSTRAP_PASSWORD_HASH.toLowerCase()}`, new Date().toISOString()],
      );
      adminId = created.rows[0].id;
      console.log(`[workbench-api] created admin user "${BOOTSTRAP_USERNAME}"`);
    }
    await client.query("UPDATE tasks SET user_id = $1 WHERE user_id IS NULL", [adminId]);
    await client.query("UPDATE projects SET user_id = $1 WHERE user_id IS NULL", [adminId]);
    await client.query(MIGRATE_CONSTRAINTS);
  });
}

/* ---------- 项目 ---------- */

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

async function listProjects(userId) {
  const { rows } = await pool.query("SELECT * FROM projects WHERE user_id = $1", [userId]);
  return rows.map(rowToProject);
}

async function upsertProject(userId, id, data) {
  const now = new Date().toISOString();
  const createdAt =
    typeof data.createdAt === "string" && !Number.isNaN(Date.parse(data.createdAt)) ? data.createdAt : now;
  await pool.query(
    `INSERT INTO projects (user_id, id, data, created_at, updated_at) VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (user_id, id) DO UPDATE SET data = $3::jsonb, updated_at = $5`,
    [userId, id, JSON.stringify(data), createdAt, now],
  );
}

async function deleteProject(userId, id) {
  await pool.query("DELETE FROM projects WHERE user_id = $1 AND id = $2", [userId, id]);
}

/* ---------- 任务 ---------- */

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

async function listTasks(userId) {
  const { rows } = await pool.query("SELECT * FROM tasks WHERE user_id = $1 ORDER BY id", [userId]);
  return rows.map(rowToTask);
}

async function createTask(userId, input) {
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO tasks (user_id, title, notes, due_date, priority, tags, repeat_rule, completed, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) RETURNING *`,
    [
      userId,
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

/** 以下写操作都带 user_id 条件，返回是否命中，未命中按 404 处理 */
async function updateTask(userId, task) {
  const { rowCount } = await pool.query(
    `UPDATE tasks SET title=$1, notes=$2, due_date=$3, priority=$4, tags=$5::jsonb,
       repeat_rule=$6, completed=$7, updated_at=$8 WHERE id=$9 AND user_id=$10`,
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
      userId,
    ],
  );
  return rowCount > 0;
}

async function deleteTask(userId, id) {
  const now = new Date().toISOString();
  const { rowCount } = await pool.query(
    "UPDATE tasks SET deleted_at=$1, updated_at=$1 WHERE id=$2 AND user_id=$3",
    [now, id, userId],
  );
  return rowCount > 0;
}

async function restoreTask(userId, id) {
  const { rowCount } = await pool.query(
    "UPDATE tasks SET deleted_at=NULL, updated_at=$1 WHERE id=$2 AND user_id=$3",
    [new Date().toISOString(), id, userId],
  );
  return rowCount > 0;
}

async function permanentlyDeleteTask(userId, id) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query("DELETE FROM tasks WHERE id=$1 AND user_id=$2", [id, userId]);
    if (rowCount > 0) await client.query("DELETE FROM task_completions WHERE task_id=$1", [id]);
    return rowCount > 0;
  });
}

async function listCompletions(userId) {
  const { rows } = await pool.query(
    `SELECT c.task_id, c.date FROM task_completions c JOIN tasks t ON t.id = c.task_id
     WHERE t.user_id = $1`,
    [userId],
  );
  return rows.map((r) => `${r.task_id}:${r.date}`);
}

async function setCompletion(userId, taskId, date, done) {
  const { rows } = await pool.query("SELECT 1 FROM tasks WHERE id=$1 AND user_id=$2", [taskId, userId]);
  if (!rows.length) return false;
  if (done) {
    await pool.query("INSERT INTO task_completions (task_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      taskId,
      date,
    ]);
  } else {
    await pool.query("DELETE FROM task_completions WHERE task_id=$1 AND date=$2", [taskId, date]);
  }
  return true;
}

/* ---------- HTTP 工具 ---------- */

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
  // 灵感速记支持图片（dataURL 内嵌），放宽到 12MB
  for await (const c of req) {
    size += c.length;
    if (size > 12 * 1024 * 1024) throw new Error("request body too large");
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

function sign(value) {
  return createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function createSessionToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      uid: Number(user.id),
      ver: user.session_version,
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    }),
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

/** 校验签名后再查库：账号被删或改过密码的旧会话都会失效 */
async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload))) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Number.isInteger(parsed.uid) || !(Number(parsed.expiresAt) > Date.now())) return null;
  const user = await findUserById(parsed.uid);
  if (!user || user.session_version !== parsed.ver) return null;
  return user;
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

function sessionInfo(user) {
  return { authenticated: true, username: user.username, isAdmin: !!user.is_admin };
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

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/* ---------- 路由 ---------- */

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
      const user = await getSessionUser(req);
      return json(res, 200, user ? sessionInfo(user) : { authenticated: false });
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
      const user = await findUserByName(normalizeUsername(username));
      const ok = await verifyPassword(password ?? "", user?.password_hash ?? dummyHash);
      if (!user || !ok) {
        attempt.count += 1;
        return json(res, 401, { error: "账号或密码不正确" });
      }
      loginAttempts.delete(ip);
      if (!user.password_hash.startsWith("scrypt$")) {
        await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
          await hashPassword(password),
          user.id,
        ]);
      }
      return json(res, 200, sessionInfo(user), {
        "set-cookie": sessionCookie(req, createSessionToken(user)),
      });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      if (isCrossSiteMutation(req, method)) return json(res, 403, { error: "请求来源无效" });
      return json(res, 204, undefined, { "set-cookie": sessionCookie(req, "", 0) });
    }

    const user = await getSessionUser(req);
    if (!user) return json(res, 401, { error: "请先登录" });
    if (isCrossSiteMutation(req, method)) return json(res, 403, { error: "请求来源无效" });
    const uid = Number(user.id);

    if (path === "/api/auth/password" && method === "POST") {
      const { currentPassword, newPassword } = await readBody(req);
      if (!(await verifyPassword(currentPassword ?? "", user.password_hash))) {
        return json(res, 400, { error: "当前密码不正确" });
      }
      if (!validPassword(newPassword)) {
        return json(res, 400, { error: `新密码需 ${PASSWORD_MIN}-${PASSWORD_MAX} 位` });
      }
      const ver = await setPassword(uid, newPassword);
      // 其他设备下线，当前设备换发新 Cookie 继续使用
      return json(res, 204, undefined, {
        "set-cookie": sessionCookie(req, createSessionToken({ id: uid, session_version: ver })),
      });
    }

    // 账号管理：仅管理员
    if (path === "/api/users" || path.startsWith("/api/users/")) {
      if (!user.is_admin) return json(res, 403, { error: "需要管理员权限" });
      if (path === "/api/users" && method === "GET") return json(res, 200, await listUsers());
      if (path === "/api/users" && method === "POST") {
        const body = await readBody(req);
        const username = normalizeUsername(body.username);
        if (!USERNAME_RE.test(username)) {
          return json(res, 400, { error: "账号需 2-32 位，仅限小写字母、数字、_ . -，且以字母或数字开头" });
        }
        if (!validPassword(body.password)) {
          return json(res, 400, { error: `密码需 ${PASSWORD_MIN}-${PASSWORD_MAX} 位` });
        }
        const created = await createUser(username, body.password);
        if (!created) return json(res, 409, { error: "账号已存在" });
        return json(res, 201, created);
      }
      const userMatch = path.match(/^\/api\/users\/(\d+)(\/password)?$/);
      if (userMatch) {
        const targetId = Number(userMatch[1]);
        const target = await findUserById(targetId);
        if (!target) return json(res, 404, { error: "账号不存在" });
        if (userMatch[2] && method === "POST") {
          const { password } = await readBody(req);
          if (!validPassword(password)) {
            return json(res, 400, { error: `密码需 ${PASSWORD_MIN}-${PASSWORD_MAX} 位` });
          }
          if (targetId === uid) return json(res, 400, { error: "请在“修改密码”中修改自己的密码" });
          await setPassword(targetId, password);
          return json(res, 204);
        }
        if (!userMatch[2] && method === "DELETE") {
          if (targetId === uid) return json(res, 400, { error: "不能删除当前登录的账号" });
          if (target.is_admin) return json(res, 400, { error: "不能删除管理员账号" });
          await deleteUser(targetId);
          return json(res, 204);
        }
      }
      return json(res, 404, { error: "not found" });
    }

    if (path === "/api/tasks" && method === "GET") return json(res, 200, await listTasks(uid));
    if (path === "/api/tasks" && method === "POST") {
      return json(res, 201, await createTask(uid, await readBody(req)));
    }
    const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && method === "PUT") {
      const ok = await updateTask(uid, { ...(await readBody(req)), id: Number(taskMatch[1]) });
      return ok ? json(res, 204) : json(res, 404, { error: "任务不存在" });
    }
    if (taskMatch && method === "DELETE") {
      const ok = await deleteTask(uid, Number(taskMatch[1]));
      return ok ? json(res, 204) : json(res, 404, { error: "任务不存在" });
    }
    const restoreMatch = path.match(/^\/api\/tasks\/(\d+)\/restore$/);
    if (restoreMatch && method === "POST") {
      const ok = await restoreTask(uid, Number(restoreMatch[1]));
      return ok ? json(res, 204) : json(res, 404, { error: "任务不存在" });
    }
    const permanentMatch = path.match(/^\/api\/tasks\/(\d+)\/permanent$/);
    if (permanentMatch && method === "DELETE") {
      const ok = await permanentlyDeleteTask(uid, Number(permanentMatch[1]));
      return ok ? json(res, 204) : json(res, 404, { error: "任务不存在" });
    }
    if (path === "/api/completions" && method === "GET") return json(res, 200, await listCompletions(uid));
    if (path === "/api/completions" && method === "POST") {
      const { taskId, date, done } = await readBody(req);
      if (!Number.isInteger(taskId) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        return json(res, 400, { error: "参数无效" });
      }
      const ok = await setCompletion(uid, taskId, date, !!done);
      return ok ? json(res, 204) : json(res, 404, { error: "任务不存在" });
    }

    // 项目工作台：整份项目文档（含灵感/需求/任务/资料/动态）按 JSONB 存储
    if (path === "/api/projects" && method === "GET") return json(res, 200, await listProjects(uid));
    const projectMatch = path.match(/^\/api\/projects\/([a-z0-9-]+)$/);
    if (projectMatch && method === "PUT") {
      const id = projectMatch[1];
      if (!PROJECT_ID_RE.test(id)) return json(res, 400, { error: "参数无效" });
      const data = await readBody(req);
      if (!isValidProject(data)) return json(res, 400, { error: "项目数据无效" });
      delete data.id;
      await upsertProject(uid, id, data);
      return json(res, 204);
    }
    if (projectMatch && method === "DELETE") {
      if (!PROJECT_ID_RE.test(projectMatch[1])) return json(res, 400, { error: "参数无效" });
      await deleteProject(uid, projectMatch[1]);
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
