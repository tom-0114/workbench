import { parseQuickAdd } from "./src/lib/nl-parse";
const base = new Date(2026, 8, 3);
const cases = [
  "明天买牛奶",
  "每周三 团队会议",
  "下周体检",
  "9月15日 版本发布",
  "每天跑步",
  "28号 交房租",
  "买咖啡",
  "周五提交周报",
  "后天交押金",
  "下周一 汇报",
  "12月25日 圣诞聚会",
  "整理车库",
];
for (const c of cases) {
  const r = parseQuickAdd(c, base);
  console.log(JSON.stringify({ input: c, title: r.title, dueDate: r.dueDate, repeat: r.repeatRule, hint: r.hint }));
}
