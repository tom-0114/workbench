/**
 * 一次性迁移：把滴答导入时标记为"原为(农历)每年重复"的任务
 * 转成真正的 yearly / yearly-lunar 重复规则，并清理备注里的标记。
 *
 * 用法（必须在你自己的 cmd 里运行）：
 *   node scripts/migrate-yearly.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const dbDir = join(process.env.APPDATA, "com.tomchen.workbench");
const dbPath = join(dbDir, "workspace.db");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
copyFileSync(dbPath, join(dbDir, `workspace.backup-${stamp}.db`));
console.log(`已备份数据库 → workspace.backup-${stamp}.db`);

const db = new DatabaseSync(dbPath);
const rows = db
  .prepare("SELECT id, title, notes FROM tasks WHERE notes LIKE '%原为每年重复%' OR notes LIKE '%原为农历每年重复%'")
  .all();

const upd = db.prepare("UPDATE tasks SET repeat_rule = ?, notes = ?, updated_at = ? WHERE id = ?");
const now = new Date().toISOString();

db.exec("BEGIN");
let lunar = 0, solar = 0;
for (const r of rows) {
  const isLunar = r.notes.includes("原为农历每年重复");
  const cleaned = r.notes
    .split("\n")
    .filter((line) => !line.includes("原为每年重复") && !line.includes("原为农历每年重复"))
    .join("\n")
    .trim();
  upd.run(isLunar ? "yearly-lunar" : "yearly", cleaned, now, r.id);
  isLunar ? lunar++ : solar++;
  console.log(`  ${isLunar ? "农历每年" : "每年"} ← ${r.title}`);
}
db.exec("COMMIT");
db.close();
console.log(`\n✅ 迁移完成：公历每年 ${solar} 条，农历每年 ${lunar} 条`);
