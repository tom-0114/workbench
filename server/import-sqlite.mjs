/**
 * 将桌面版 workspace.db 追加导入 Web 版 PostgreSQL。
 *
 * 特性：
 * - 单事务，失败整体回滚
 * - 不沿用 SQLite ID，避免覆盖云端已有任务
 * - 以「标题 + 日期」精确匹配现有任务，重复项不再插入
 * - 自动重映射重复任务完成记录中的 task_id
 *
 * 用法：
 *   DATABASE_URL=postgres://... node import-sqlite.mjs /path/workspace.db --dry-run
 *   DATABASE_URL=postgres://... node import-sqlite.mjs /path/workspace.db
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const { Client } = pg;
const dbPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");

if (!dbPath || !existsSync(dbPath)) {
  console.error("用法: node import-sqlite.mjs <workspace.db> [--dry-run]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const allowedRepeats = new Set(["none", "daily", "weekly", "monthly", "yearly", "yearly-lunar"]);
const sqlite = new DatabaseSync(dbPath, { readOnly: true });

function parseTags(raw, id) {
  let tags;
  try {
    tags = JSON.parse(raw || "[]");
  } catch {
    throw new Error(`任务 ${id} 的 tags 不是合法 JSON`);
  }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new Error(`任务 ${id} 的 tags 必须是字符串数组`);
  }
  return tags;
}

const taskRows = sqlite.prepare("SELECT * FROM tasks ORDER BY id").all();
const duplicate = sqlite
  .prepare(
    `SELECT title, due_date, COUNT(*) AS n
       FROM tasks
      GROUP BY title, due_date
     HAVING COUNT(*) > 1
      LIMIT 1`,
  )
  .get();
if (duplicate) throw new Error("SQLite 中存在重复的「标题 + 日期」，无法建立稳定的 ID 映射");

const tasks = taskRows.map((row) => {
  if (!Number.isInteger(row.id) || row.id < 1) throw new Error("任务 ID 无效");
  if (typeof row.title !== "string" || !row.title.trim()) throw new Error(`任务 ${row.id} 标题为空`);
  if (row.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.due_date)) {
    throw new Error(`任务 ${row.id} 日期格式无效`);
  }
  if (!Number.isInteger(row.priority) || row.priority < 0 || row.priority > 3) {
    throw new Error(`任务 ${row.id} 优先级无效`);
  }
  if (!allowedRepeats.has(row.repeat_rule || "none")) {
    throw new Error(`任务 ${row.id} 重复规则无效`);
  }
  return {
    source_id: row.id,
    title: row.title,
    notes: row.notes || "",
    due_date: row.due_date || "",
    priority: row.priority,
    tags: parseTags(row.tags, row.id),
    repeat_rule: row.repeat_rule || "none",
    completed: !!row.completed,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
});

const completionRows = sqlite
  .prepare("SELECT task_id, date FROM task_completions ORDER BY task_id, date")
  .all();
const sourceIds = new Set(tasks.map((task) => task.source_id));
const completions = completionRows.map((row) => {
  if (!sourceIds.has(row.task_id)) throw new Error(`完成记录引用了不存在的任务 ${row.task_id}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`完成记录日期无效: ${row.date}`);
  return { source_id: row.task_id, date: row.date };
});
sqlite.close();

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('workbench-sqlite-import'))");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query(`
    CREATE TEMP TABLE import_tasks (
      source_id BIGINT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL,
      due_date TEXT NOT NULL,
      priority INTEGER NOT NULL,
      tags JSONB NOT NULL,
      repeat_rule TEXT NOT NULL,
      completed BOOLEAN NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) ON COMMIT DROP;
    CREATE TEMP TABLE import_task_map (
      source_id BIGINT PRIMARY KEY,
      target_id BIGINT NOT NULL,
      matched_existing BOOLEAN NOT NULL
    ) ON COMMIT DROP;
  `);

  await client.query(
    `INSERT INTO import_tasks
       SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS x(
           source_id BIGINT, title TEXT, notes TEXT, due_date TEXT, priority INTEGER,
           tags JSONB, repeat_rule TEXT, completed BOOLEAN, created_at TEXT, updated_at TEXT
         )`,
    [JSON.stringify(tasks)],
  );

  await client.query(`
    INSERT INTO import_task_map (source_id, target_id, matched_existing)
    SELECT DISTINCT ON (source.source_id) source.source_id, target.id, true
      FROM import_tasks source
      JOIN tasks target
        ON target.title = source.title
       AND target.due_date = source.due_date
     ORDER BY source.source_id, target.id
  `);

  const inserted = await client.query(`
    INSERT INTO tasks (
      title, notes, due_date, priority, tags, repeat_rule, completed, created_at, updated_at
    )
    SELECT source.title, source.notes, source.due_date, source.priority, source.tags,
           source.repeat_rule, source.completed, source.created_at, source.updated_at
      FROM import_tasks source
      LEFT JOIN import_task_map mapped ON mapped.source_id = source.source_id
     WHERE mapped.source_id IS NULL
     ORDER BY source.source_id
  `);

  await client.query(`
    INSERT INTO import_task_map (source_id, target_id, matched_existing)
    SELECT DISTINCT ON (source.source_id) source.source_id, target.id, false
      FROM import_tasks source
      JOIN tasks target
        ON target.title = source.title
       AND target.due_date = source.due_date
      LEFT JOIN import_task_map mapped ON mapped.source_id = source.source_id
     WHERE mapped.source_id IS NULL
     ORDER BY source.source_id, target.id DESC
  `);

  const mapping = await client.query(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE matched_existing)::int AS matched FROM import_task_map",
  );
  if (mapping.rows[0].total !== tasks.length) throw new Error("任务 ID 映射不完整");

  let insertedCompletions = 0;
  if (completions.length) {
    const result = await client.query(
      `WITH source AS (
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(source_id BIGINT, date TEXT)
       )
       INSERT INTO task_completions (task_id, date)
       SELECT mapped.target_id, source.date
         FROM source
         JOIN import_task_map mapped USING (source_id)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(completions)],
    );
    insertedCompletions = result.rowCount;
  }

  const totals = await client.query(
    "SELECT (SELECT COUNT(*)::int FROM tasks) AS tasks, (SELECT COUNT(*)::int FROM task_completions) AS completions",
  );

  if (dryRun) await client.query("ROLLBACK");
  else await client.query("COMMIT");

  console.log(
    JSON.stringify({
      mode: dryRun ? "dry-run" : "committed",
      sourceTasks: tasks.length,
      matchedExisting: mapping.rows[0].matched,
      insertedTasks: inserted.rowCount,
      sourceCompletions: completions.length,
      insertedCompletions,
      resultingTasks: totals.rows[0].tasks,
      resultingCompletions: totals.rows[0].completions,
    }),
  );
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // 连接已经中断时无需再次处理。
  }
  throw error;
} finally {
  await client.end();
}
