/**
 * 一键发版脚本：
 *   node scripts/release.mjs [更新说明]
 *
 * 流程：读取版本号 → 签名构建 → 生成 latest.json → 创建 GitHub Release
 * 前置：gh 已登录；~/.tauri/workbench.key 存在（无密码）
 * 发布前记得先改版本号：src-tauri/tauri.conf.json 和 package.json 的 "version"
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, opts = {}) =>
  execSync(cmd, { stdio: "inherit", cwd: root, ...opts });

const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.version !== version) {
  throw new Error(`版本号不一致：package.json ${pkg.version} ≠ tauri.conf.json ${version}`);
}
const notes = process.argv[2] || `v${version}`;

// 从 git remote 推导仓库 owner/name
const remote = execSync("git remote get-url origin", { cwd: root }).toString().trim();
const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
if (!m) throw new Error(`无法从 remote 解析 GitHub 仓库: ${remote}`);
const repo = m[1];

const keyPath = join(homedir(), ".tauri", "workbench.key");
if (!existsSync(keyPath)) throw new Error(`签名私钥不存在: ${keyPath}`);

console.log(`\n== 发布 v${version} 到 ${repo} ==\n`);

// 1. 签名构建
run("npm run tauri build", {
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf8"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});

// 2. 生成 latest.json
const bundleDir = join(root, "src-tauri/target/release/bundle/nsis");
const exeName = `workbench_${version}_x64-setup.exe`;
const exePath = join(bundleDir, exeName);
const sigPath = `${exePath}.sig`;
if (!existsSync(sigPath))
  throw new Error(`签名文件不存在: ${sigPath}（检查 createUpdaterArtifacts 配置）`);

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(sigPath, "utf8"),
      url: `https://github.com/${repo}/releases/download/v${version}/${exeName}`,
    },
  },
};
const latestPath = join(bundleDir, "latest.json");
writeFileSync(latestPath, JSON.stringify(latest, null, 2));

// 3. 创建 GitHub Release（含安装包与 latest.json）
run(
  `gh release create v${version} "${exePath}" "${latestPath}" --title "v${version}" --notes "${notes.replace(/"/g, '\\"')}"`,
);

console.log(`\n✅ v${version} 发布完成。客户端点“检查更新”即可升级。\n`);
