# Workbench 个人工作台

一个安静、克制的个人效率工具：月度日历 + Todo，macOS 风格视觉。
基于 Tauri 2 + Vue 3 + FullCalendar——桌面版数据存本地 SQLite，Web 版数据存服务器 PostgreSQL。

## 双形态

| 形态 | 数据层 | 说明 |
| --- | --- | --- |
| 桌面版（Tauri） | 本地 SQLite（`workspace.db`） | `npm run tauri dev` / `npm run tauri build` |
| Web 版 | 服务器 PostgreSQL（REST API，见 `server/index.mjs`） | `WEB_BASE_PATH=/workbench/ npm run build` 后部署 dist |

Web 版在浏览器中自动走 REST 仓库（`src/lib/repo.ts` 的 `RestRepo`），桌面应用行为完全不变。

## Web 版部署（阿里云 ECS）

- 后端：`server/index.mjs`（systemd `workbench-api.service`，127.0.0.1:3002），`DATABASE_URL` 指向本机 Docker PostgreSQL 的 `workbench` 库，表结构启动时自动创建
- 前端：`dist/` 由 nginx 挂在 `/workbench/` 子路径，API 经 `/workbench/api/` 反代到 3002 端口
- 鉴权：Web API 使用签名的 HttpOnly Cookie；生产环境需在 `server/.env` 配置 `AUTH_USERNAME`、`AUTH_PASSWORD_SHA256`、`AUTH_SECRET` 与 `AUTH_COOKIE_PATH=/workbench`，可参考 `server/.env.example`
- 公网安全：登录凭据只有在 HTTPS 下才会加密传输；绑定正式域名后应配置 TLS 证书并将 HTTP 重定向到 HTTPS
- 本地开发：`node server/index.mjs` 起后端（vite 已配置 `/api` 代理到 3002），`npm run dev` 起前端
- SQLite 导入：`server/import-sqlite.mjs` 使用事务追加数据，按“标题 + 日期”去重并自动重映射 ID；先加 `--dry-run` 预演，再正式执行

## 功能

- 日历：桌面端月视图，手机端默认周列表；支持快速添加、拖拽改期、优先级着色和完成打卡
- Web 登录：7 天会话、失败限流、退出登录与登录失效自动回到登录页
- 今日侧边栏：待办 / 逾期（一键移到今天）/ 已完成
- 收集箱：存放无日期的事项，可拖到日历上安排日期
- 重复任务：每天 / 每周 / 每月，按天独立打卡
- 中国节假日：法定假日（休）/ 调休上班（班）/ 周末 背景区分
- 桌面集成：系统托盘、关闭进托盘、防多开、开机自启
- 应用内更新：启动自检 + 手动检查，一键升级

## 开发

```bash
npm install
npm run tauri dev
```

前置：Rust (stable-msvc) + VS Build Tools 2022（C++ 工作负载）。

## 发版

1. 修改 `src-tauri/tauri.conf.json` 与 `package.json` 中的版本号
2. `node scripts/release.mjs "更新说明"`

## License

MIT
