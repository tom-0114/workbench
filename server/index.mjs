// 个人工作台后端：PostgreSQL REST API。
// 数据语义见 src/lib/types.ts：
//   Task: { id, title, notes, dueDate, dueTime, remindOffset, priority, tags, repeatRule, completed, completedAt, ... }
//   completions: "taskId:date" 集合（重复任务按天打卡）
//   reminders: 前端按重复规则算好的未来提醒时间，后端到点核对任务现状后推送
// 多用户：tasks / reminders / push_subscriptions 按 user_id 隔离，task_completions 经 tasks 间接隔离；仅管理员可创建账号。
// Web API 使用签名 HttpOnly Cookie 鉴权，表结构在启动时自动创建/迁移。
import { Pool } from "pg";
import { createServer } from "node:http";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { loadVapidKeys, sendPush } from "./webpush.mjs";

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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPEAT_RULES = new Set(["none", "daily", "weekly", "monthly", "yearly", "yearly-lunar"]);
const VAPID = loadVapidKeys(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "";
const REMINDER_TICK_MS = 30_000;
// 进程重启或短暂卡顿时补发的窗口；更早的提醒视为过期不再打扰
const REMINDER_GRACE_MS = 15 * 60 * 1000;

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
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS date_overrides JSONB NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind_offset INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TEXT;
-- 重复截止日（含当天），空串表示一直重复
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_until TEXT NOT NULL DEFAULT '';
-- 子任务只有一层：parent_id 指向顶层任务，子任务没有日期，跟随父任务删除、恢复
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id BIGINT;
CREATE INDEX IF NOT EXISTS tasks_parent_id_idx ON tasks (parent_id) WHERE parent_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  user_id   BIGINT NOT NULL,
  task_id   BIGINT NOT NULL,
  occ_date  TEXT NOT NULL,
  fire_at   TEXT NOT NULL,
  body      TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL,
  sent_at   TEXT,
  PRIMARY KEY (task_id, occ_date, fire_at)
);
CREATE INDEX IF NOT EXISTS reminders_pending_idx ON reminders (fire_at) WHERE sent_at IS NULL;
`;

// 单用户时代的旧数据（user_id 为空）回填后再加约束
const MIGRATE_CONSTRAINTS = `
ALTER TABLE tasks ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id);
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
    await client.query("DELETE FROM reminders WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM push_subscriptions WHERE user_id = $1", [userId]);
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
    // 任务不再有时间：旧数据把时间折进提醒提前量（提醒基准改为当天 09:00，实际提醒时刻不变），再清空时间
    await client.query(
      `UPDATE tasks SET
         remind_offset = CASE WHEN remind_offset IS NULL THEN NULL
           ELSE remind_offset - (split_part(due_time, ':', 1)::int * 60 + split_part(due_time, ':', 2)::int - 540) END,
         due_time = ''
       WHERE due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    );
    await client.query("UPDATE tasks SET due_time = '' WHERE due_time <> ''");
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
    await client.query(MIGRATE_CONSTRAINTS);
  });
}

/* ---------- 任务 ---------- */

function rowToTask(r) {
  return {
    id: Number(r.id),
    title: r.title,
    notes: r.notes,
    dueDate: r.due_date,
    dueTime: r.due_time ?? "",
    remindOffset: r.remind_offset ?? null,
    priority: r.priority,
    tags: r.tags ?? [],
    repeatRule: r.repeat_rule,
    repeatUntil: r.repeat_until ?? "",
    completed: !!r.completed,
    completedAt: r.completed_at ?? null,
    parentId: r.parent_id == null ? null : Number(r.parent_id),
    dateOverrides: r.date_overrides ?? {},
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function listTasks(userId) {
  const { rows } = await pool.query("SELECT * FROM tasks WHERE user_id = $1 ORDER BY id", [userId]);
  return rows.map(rowToTask);
}

function validIso(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

/**
 * 新增字段统一在这里规整：任务只有日期，dueTime 恒为空；提醒提前量以当天 09:00 为基准，-30 天到 365 天（负数为之后提醒）；
 * 完成时间仅在已完成时保留。旧客户端或旧备份带来的时间折进提前量，保证提醒时刻不变。
 */
function taskExtras(input) {
  const legacyTime = TIME_RE.test(input.dueTime ?? "") && input.dueDate ? input.dueTime : "";
  let offset = Number(input.remindOffset);
  if (legacyTime) {
    const [h, m] = legacyTime.split(":").map(Number);
    offset -= h * 60 + m - 540;
  }
  const dueTime = "";
  const remindOffset =
    input.remindOffset !== null && input.remindOffset !== undefined && Number.isInteger(offset) && offset >= -30 * 1440 && offset <= 365 * 1440 && input.dueDate
      ? offset
      : null;
  const completedAt = input.completed ? validIso(input.completedAt) : null;
  // 截止日只对重复任务有意义，且不能早于开始日期
  const repeatUntil =
    input.repeatRule && input.repeatRule !== "none" && DATE_RE.test(input.repeatUntil ?? "") && input.repeatUntil >= input.dueDate
      ? input.repeatUntil
      : "";
  return { dueTime, remindOffset, completedAt, repeatUntil };
}

/** 子任务的父任务必须是本人未删除的顶层任务；不合法返回 null */
async function validParentId(userId, parentId) {
  if (!Number.isInteger(parentId)) return null;
  const { rows } = await pool.query(
    "SELECT id FROM tasks WHERE id=$1 AND user_id=$2 AND parent_id IS NULL AND deleted_at IS NULL",
    [parentId, userId],
  );
  return rows.length ? parentId : null;
}

async function createTask(userId, input, parentId = null) {
  const now = new Date().toISOString();
  // 子任务没有日期、重复和提醒，这些都跟着父任务走
  const task = parentId ? { ...input, dueDate: "", dueTime: "", remindOffset: null, repeatRule: "none" } : input;
  const extras = taskExtras(task);
  const { rows } = await pool.query(
    `INSERT INTO tasks (user_id, title, notes, due_date, due_time, remind_offset, priority, tags, repeat_rule,
       completed, completed_at, parent_id, created_at, updated_at, repeat_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [
      userId,
      task.title,
      task.notes ?? "",
      task.dueDate ?? "",
      extras.dueTime,
      extras.remindOffset,
      task.priority ?? 0,
      JSON.stringify(task.tags ?? []),
      task.repeatRule ?? "none",
      !!task.completed,
      extras.completedAt,
      parentId,
      now,
      now,
      extras.repeatUntil,
    ],
  );
  return rowToTask(rows[0]);
}

/** 以下写操作都带 user_id 条件，未命中按 404 处理；更新返回最新行，前端用它对齐 updatedAt */
async function updateTask(userId, task) {
  const extras = taskExtras(task);
  const { rows } = await pool.query(
    `UPDATE tasks SET title=$1, notes=$2, due_date=$3, due_time=$4, remind_offset=$5, priority=$6, tags=$7::jsonb,
       repeat_rule=$8, completed=$9, completed_at=$10, date_overrides=$11::jsonb, updated_at=$12, repeat_until=$15
     WHERE id=$13 AND user_id=$14 RETURNING *`,
    [
      task.title,
      task.notes ?? "",
      task.dueDate,
      extras.dueTime,
      extras.remindOffset,
      task.priority ?? 0,
      JSON.stringify(task.tags ?? []),
      task.repeatRule ?? "none",
      !!task.completed,
      extras.completedAt,
      JSON.stringify(task.dateOverrides ?? {}),
      new Date().toISOString(),
      task.id,
      userId,
      extras.repeatUntil,
    ],
  );
  return rows[0] ? rowToTask(rows[0]) : null;
}

async function deleteTask(userId, id) {
  const now = new Date().toISOString();
  const { rowCount } = await pool.query(
    "UPDATE tasks SET deleted_at=$1, updated_at=$1 WHERE (id=$2 OR parent_id=$2) AND user_id=$3",
    [now, id, userId],
  );
  return rowCount > 0;
}

async function restoreTask(userId, id) {
  const { rowCount } = await pool.query(
    "UPDATE tasks SET deleted_at=NULL, updated_at=$1 WHERE (id=$2 OR parent_id=$2) AND user_id=$3",
    [new Date().toISOString(), id, userId],
  );
  return rowCount > 0;
}

async function permanentlyDeleteTask(userId, id) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "DELETE FROM tasks WHERE (id=$1 OR parent_id=$1) AND user_id=$2 RETURNING id",
      [id, userId],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await client.query("DELETE FROM task_completions WHERE task_id = ANY($1::bigint[])", [ids]);
      await client.query("DELETE FROM reminders WHERE task_id = ANY($1::bigint[])", [ids]);
    }
    return ids.length > 0;
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

/** 通知上点“完成”：普通任务标记完成，重复任务只打卡这一天 */
async function completeOccurrence(userId, taskId, date) {
  const { rows } = await pool.query("SELECT repeat_rule FROM tasks WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [
    taskId,
    userId,
  ]);
  if (!rows.length) return false;
  // 完成父任务同时完成它的子任务；重复任务按这一天打卡
  if (rows[0].repeat_rule !== "none") {
    await pool.query(
      `INSERT INTO task_completions (task_id, date)
       SELECT id, $3 FROM tasks WHERE (id=$1 OR parent_id=$1) AND user_id=$2 AND deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [taskId, userId, date],
    );
    return true;
  }
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE tasks SET completed = true, completed_at = COALESCE(completed_at, $1), updated_at = $1
     WHERE (id = $2 OR parent_id = $2) AND user_id = $3 AND NOT completed`,
    [now, taskId, userId],
  );
  return true;
}

/* ---------- 备份恢复 ---------- */

const IMPORT_MAX_TASKS = 20_000;
const IMPORT_MAX_COMPLETIONS = 200_000;

/** 校验备份并整理成可写入的结构；不合法返回错误文案 */
function parseBackup(body) {
  if (body?.app !== "workbench" || body.version !== 1) return { error: "不是 Workbench 的备份文件" };
  if (!Array.isArray(body.tasks) || !Array.isArray(body.completions)) return { error: "备份文件内容不完整" };
  if (body.tasks.length > IMPORT_MAX_TASKS || body.completions.length > IMPORT_MAX_COMPLETIONS) {
    return { error: "备份文件过大" };
  }
  const tasks = [];
  for (const t of body.tasks) {
    if (!Number.isInteger(t?.id) || typeof t.title !== "string" || !t.title.trim()) return { error: "备份里有无效的任务" };
    if (t.dueDate && !DATE_RE.test(t.dueDate)) return { error: `任务「${t.title}」的日期无效` };
    const now = new Date().toISOString();
    tasks.push({
      ...t,
      dueDate: t.dueDate || "",
      notes: typeof t.notes === "string" ? t.notes : "",
      priority: [0, 1, 2, 3].includes(t.priority) ? t.priority : 0,
      tags: Array.isArray(t.tags) ? t.tags.filter((tag) => typeof tag === "string") : [],
      repeatRule: REPEAT_RULES.has(t.repeatRule) && t.dueDate ? t.repeatRule : "none",
      dateOverrides: t.dateOverrides && typeof t.dateOverrides === "object" ? t.dateOverrides : {},
      deletedAt: t.deletedAt ? validIso(t.deletedAt) : null,
      parentId: Number.isInteger(t.parentId) ? t.parentId : null,
      createdAt: validIso(t.createdAt) ?? now,
      updatedAt: validIso(t.updatedAt) ?? now,
    });
  }
  const completions = [];
  for (const key of body.completions) {
    const [id, date] = String(key).split(":");
    if (Number.isInteger(Number(id)) && DATE_RE.test(date ?? "")) completions.push([Number(id), date]);
  }
  return { tasks, completions };
}

/** 覆盖式恢复：清空该账号现有任务后按备份重建。任务 id 全局自增，按新 id 重映射打卡记录 */
async function importBackup(userId, { tasks, completions }) {
  return withTransaction(async (client) => {
    await client.query(
      "DELETE FROM task_completions WHERE task_id IN (SELECT id FROM tasks WHERE user_id = $1)",
      [userId],
    );
    await client.query("DELETE FROM reminders WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM tasks WHERE user_id = $1", [userId]);
    const idMap = new Map();
    // 先建顶层任务，子任务才能映射到新的父任务 id；找不到父任务的子任务退回顶层
    const ordered = [...tasks.filter((t) => t.parentId == null), ...tasks.filter((t) => t.parentId != null)];
    for (const t of ordered) {
      const extras = taskExtras(t);
      const parentId = t.parentId != null ? (idMap.get(t.parentId) ?? null) : null;
      const { rows } = await client.query(
        `INSERT INTO tasks (user_id, title, notes, due_date, due_time, remind_offset, priority, tags, repeat_rule,
           completed, completed_at, date_overrides, deleted_at, parent_id, created_at, updated_at, repeat_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17) RETURNING id`,
        [
          userId, t.title, t.notes, t.dueDate, extras.dueTime, extras.remindOffset, t.priority,
          JSON.stringify(t.tags), t.repeatRule, !!t.completed, extras.completedAt,
          JSON.stringify(t.dateOverrides), t.deletedAt, parentId, t.createdAt, t.updatedAt, extras.repeatUntil,
        ],
      );
      idMap.set(t.id, rows[0].id);
    }
    const mapped = completions.filter(([id]) => idMap.has(id));
    if (mapped.length) {
      await client.query(
        `INSERT INTO task_completions (task_id, date) SELECT * FROM unnest($1::bigint[], $2::text[])
         ON CONFLICT DO NOTHING`,
        [mapped.map(([id]) => idMap.get(id)), mapped.map(([, date]) => date)],
      );
    }
    return { tasks: tasks.length, completions: mapped.length };
  });
}

/* ---------- 推送与提醒 ---------- */

async function saveSubscription(userId, sub) {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
    [userId, sub.endpoint, sub.p256dh, sub.auth, new Date().toISOString()],
  );
}

/** 单条推送；失败时带上推送服务的域名，方便区分“连不上”和“被拒绝” */
async function pushToSubscription(sub, payload) {
  const host = new URL(sub.endpoint).host;
  try {
    const result = await sendPush(sub, payload, { vapid: VAPID, subject: VAPID_SUBJECT });
    if (result.ok) return { ok: true };
    if (result.gone) await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
    console.warn(`[workbench-api] push ${sub.id} (${host}) rejected: ${result.status}`);
    return { ok: false, host, reason: result.gone ? "gone" : "rejected", status: result.status };
  } catch (error) {
    console.warn(`[workbench-api] push ${sub.id} (${host}) failed:`, error.message);
    return { ok: false, host, reason: "unreachable" };
  }
}

async function pushToUser(userId, payload) {
  const { rows } = await pool.query("SELECT * FROM push_subscriptions WHERE user_id = $1", [userId]);
  let sent = 0;
  for (const sub of rows) if ((await pushToSubscription(sub, payload)).ok) sent += 1;
  return { sent, total: rows.length };
}

/** 覆盖该账号所有未发送的提醒；已发送且时间未变的保留发送标记，避免重复推送 */
async function syncReminders(userId, list) {
  const now = new Date().toISOString();
  const valid = [];
  for (const r of list) {
    const fireAt = validIso(r?.fireAt);
    if (Number.isInteger(r?.taskId) && DATE_RE.test(r.date ?? "") && fireAt) {
      valid.push([r.taskId, r.date, fireAt, typeof r.body === "string" ? r.body.slice(0, 200) : ""]);
    }
  }
  await withTransaction(async (client) => {
    await client.query("DELETE FROM reminders WHERE user_id = $1 AND (sent_at IS NULL OR fire_at < $2)", [
      userId,
      new Date(Date.now() - 3 * 86400_000).toISOString(),
    ]);
    if (!valid.length) return;
    await client.query(
      `INSERT INTO reminders (user_id, task_id, occ_date, fire_at, body, synced_at)
       SELECT $1, r.task_id, r.occ_date, r.fire_at, r.body, $2
       FROM unnest($3::bigint[], $4::text[], $5::text[], $6::text[]) AS r(task_id, occ_date, fire_at, body)
       JOIN tasks t ON t.id = r.task_id AND t.user_id = $1
       ON CONFLICT (task_id, occ_date, fire_at) DO UPDATE SET body = EXCLUDED.body, synced_at = EXCLUDED.synced_at`,
      [userId, now, valid.map((r) => r[0]), valid.map((r) => r[1]), valid.map((r) => r[2]), valid.map((r) => r[3])],
    );
  });
  return valid.length;
}

/**
 * 到点的提醒在发送前再核对一次：任务已删、已完成，或任务在上次同步之后被改过（别的设备改的，
 * 本条可能已过时）都跳过。跳过的不标记已发送，等下一次同步覆盖。
 */
async function deliverDueReminders() {
  const now = new Date();
  const { rows } = await pool.query(
    `SELECT r.*, t.title, t.priority, t.repeat_rule, t.completed, t.deleted_at, t.updated_at,
       EXISTS (SELECT 1 FROM task_completions c WHERE c.task_id = r.task_id AND c.date = r.occ_date) AS occ_done
     FROM reminders r JOIN tasks t ON t.id = r.task_id
     WHERE r.sent_at IS NULL AND r.fire_at <= $1 AND r.fire_at > $2
     ORDER BY r.fire_at`,
    [now.toISOString(), new Date(now.getTime() - REMINDER_GRACE_MS).toISOString()],
  );
  for (const r of rows) {
    const done = r.repeat_rule === "none" ? r.completed : r.occ_done;
    if (r.deleted_at || done || r.synced_at < r.updated_at) continue;
    const claimed = await pool.query(
      "UPDATE reminders SET sent_at = $1 WHERE task_id = $2 AND occ_date = $3 AND fire_at = $4 AND sent_at IS NULL",
      [now.toISOString(), r.task_id, r.occ_date, r.fire_at],
    );
    if (!claimed.rowCount) continue;
    await pushToUser(Number(r.user_id), {
      // 高优先级在标题前加标记，一堆通知里更显眼
      title: Number(r.priority) === 3 ? `❗${r.title}` : r.title,
      body: r.body,
      tag: `wb-${r.task_id}-${r.occ_date}`,
      taskId: Number(r.task_id),
      date: r.occ_date,
    });
  }
}

function startReminderLoop() {
  if (!VAPID || !VAPID_SUBJECT) {
    console.log("[workbench-api] VAPID_* 未配置，提醒推送未启用");
    return;
  }
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await deliverDueReminders();
    } catch (error) {
      console.error("[workbench-api] reminder tick failed:", error);
    } finally {
      running = false;
    }
  }, REMINDER_TICK_MS);
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
      const body = await readBody(req);
      if (body.parentId == null) return json(res, 201, await createTask(uid, body));
      const parentId = await validParentId(uid, body.parentId);
      if (!parentId) return json(res, 400, { error: "父任务不存在或本身是子任务" });
      return json(res, 201, await createTask(uid, body, parentId));
    }
    const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && method === "PUT") {
      const saved = await updateTask(uid, { ...(await readBody(req)), id: Number(taskMatch[1]) });
      return saved ? json(res, 200, saved) : json(res, 404, { error: "任务不存在" });
    }
    if (taskMatch && method === "DELETE") {
      const ok = await deleteTask(uid, Number(taskMatch[1]));
      return ok ? json(res, 204) : json(res, 404, { error: "任务不存在" });
    }
    const completeMatch = path.match(/^\/api\/tasks\/(\d+)\/complete$/);
    if (completeMatch && method === "POST") {
      const { date } = await readBody(req);
      if (!DATE_RE.test(date ?? "")) return json(res, 400, { error: "参数无效" });
      const ok = await completeOccurrence(uid, Number(completeMatch[1]), date);
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

    if (path === "/api/import" && method === "POST") {
      const parsed = parseBackup(await readBody(req));
      if (parsed.error) return json(res, 400, { error: parsed.error });
      return json(res, 200, await importBackup(uid, parsed));
    }

    if (path === "/api/reminders" && method === "PUT") {
      const { reminders } = await readBody(req);
      if (!Array.isArray(reminders) || reminders.length > 5000) return json(res, 400, { error: "参数无效" });
      return json(res, 200, { count: await syncReminders(uid, reminders) });
    }
    if (path === "/api/push/config" && method === "GET") {
      return json(res, 200, VAPID && VAPID_SUBJECT ? { enabled: true, publicKey: VAPID.publicKey } : { enabled: false });
    }
    if (path === "/api/push/subscribe" && method === "POST") {
      const { endpoint, keys } = await readBody(req);
      let url;
      try {
        url = new URL(endpoint);
      } catch {
        url = null;
      }
      if (url?.protocol !== "https:" || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
        return json(res, 400, { error: "订阅信息无效" });
      }
      await saveSubscription(uid, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
      return json(res, 204);
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      const { endpoint } = await readBody(req);
      await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [String(endpoint), uid]);
      return json(res, 204);
    }
    if (path === "/api/push/test" && method === "POST") {
      if (!VAPID || !VAPID_SUBJECT) return json(res, 400, { error: "服务器未配置推送" });
      // 只发给当前设备：发给全部设备时，一台成功会掩盖本机失败
      const { endpoint } = await readBody(req);
      const { rows } = await pool.query("SELECT * FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [uid, String(endpoint)]);
      if (!rows.length) return json(res, 200, { ok: false, reason: "missing" });
      return json(res, 200, await pushToSubscription(rows[0], { title: "Workbench 提醒已开启", body: "到点时会像这样通知你", tag: "wb-test" }));
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
    startReminderLoop();
  })
  .catch((error) => {
    console.error("[workbench-api] init failed:", error);
    process.exit(1);
  });
