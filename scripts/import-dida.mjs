/**
 * 滴答清单（Dida365）备份 CSV 导入脚本
 *   node scripts/import-dida.mjs <备份csv路径>
 *
 * 规则：
 * - Status 2(已完成) → completed=1；-1(已放弃) → 跳过
 * - 日期取 Due Date（缺省用 Start Date），按本机时区转 YYYY-MM-DD；无日期 → 收集箱('')
 * - 优先级 0/1/3/5 → 0/1/2/3
 * - 重复：DAILY/WEEKLY/MONTHLY → daily/weekly/monthly（仅未完成任务）；
 *   YEARLY/LUNAR → 不支持，按滴答已算好的下次日期导入为单次任务，备注标注
 * - 去重：库里已存在相同 标题+日期 的记录则跳过
 * - 导入前自动备份数据库
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const csvPath = process.argv[2];
if (!csvPath || !existsSync(csvPath)) {
  console.error("用法: node scripts/import-dida.mjs <Dida-backup.csv>");
  process.exit(1);
}

const dbDir = join(process.env.APPDATA, "com.tomchen.workbench");
const dbPath = join(dbDir, "workspace.db");
if (!existsSync(dbPath)) throw new Error(`数据库不存在: ${dbPath}`);

// 备份
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
copyFileSync(dbPath, join(dbDir, `workspace.backup-${stamp}.db`));
console.log(`已备份数据库 → workspace.backup-${stamp}.db`);

// ---------- CSV 解析（处理引号内换行/逗号/转义引号） ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = readFileSync(csvPath, "utf8").replace(/^﻿/, "");
const rows = parseCSV(raw);
const hi = rows.findIndex((r) => r[0] === "Folder Name");
if (hi < 0) throw new Error("找不到表头行（Folder Name）");
const header = rows[hi];
const data = rows.slice(hi + 1).filter((r) => r.length >= header.length - 2);
const col = (n) => header.indexOf(n);

// ---------- 字段映射 ----------
const PRI = { "0": 0, "1": 1, "3": 2, "5": 3 };

function localDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.replace("+0000", "Z"));
  if (isNaN(d)) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function mapRepeat(rule, status) {
  if (!rule || status !== "0") return { rule: "none", note: "" };
  if (/FREQ=DAILY/.test(rule)) return { rule: "daily", note: "" };
  if (/FREQ=WEEKLY/.test(rule)) return { rule: "weekly", note: "" };
  if (/FREQ=MONTHLY/.test(rule)) return { rule: "monthly", note: "" };
  if (/FREQ=YEARLY/.test(rule))
    return { rule: "none", note: rule.startsWith("LUNAR") ? "[导入] 原为农历每年重复" : "[导入] 原为每年重复" };
  return { rule: "none", note: "" };
}

// ---------- 写入 ----------
const db = new DatabaseSync(dbPath);
const existsStmt = db.prepare("SELECT 1 FROM tasks WHERE title = ? AND due_date = ? LIMIT 1");
const insertStmt = db.prepare(
  `INSERT INTO tasks (title, notes, due_date, priority, tags, repeat_rule, completed, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

let imported = 0, skippedDup = 0, skippedAbandoned = 0;
db.exec("BEGIN");
for (const r of data) {
  const status = r[col("Status")];
  if (status === "-1") { skippedAbandoned++; continue; }

  const title = (r[col("Title")] || "").trim();
  if (!title) continue;

  const dueDate = localDate(r[col("Due Date")] || r[col("Start Date")]);
  if (existsStmt.get(title, dueDate)) { skippedDup++; continue; }

  const { rule, note } = mapRepeat(r[col("Repeat")], status);
  const content = (r[col("Content")] || "").trim();
  const notes = [content, note].filter(Boolean).join("\n");
  const tags = (r[col("Tags")] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const createdAt = r[col("Created Time")] || new Date().toISOString();
  const updatedAt = r[col("Completed Time")] || createdAt;

  insertStmt.run(
    title, notes, dueDate,
    PRI[r[col("Priority")]] ?? 0,
    JSON.stringify(tags), rule,
    status === "2" ? 1 : 0,
    createdAt, updatedAt,
  );
  imported++;
}
db.exec("COMMIT");
db.close();

console.log(`✅ 导入完成：新增 ${imported} 条，跳过重复 ${skippedDup} 条，跳过已放弃 ${skippedAbandoned} 条`);
