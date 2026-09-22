# Workbench 个人工作台

一个安静、克制的个人效率工具：月度日历 + Todo + 项目工作台，macOS 风格视觉。
Vue 3 + FullCalendar 前端，Node.js + PostgreSQL 后端（`server/index.mjs`），单用户、Cookie 登录。

## 功能

- 日历：桌面浏览器月视图，手机默认周列表；支持快速添加、拖拽改期、优先级着色和完成打卡
- 快速添加：中文自然语言解析日期与重复（明天 / 周五 / 下周末 / 9月15日 / 每周三 / 每月31号）
- 登录：7 天会话、失败限流、退出登录与登录失效自动回到登录页
- 今日侧边栏：待办 / 逾期（一键移到今天、推迟到明天）/ 接下来 7 天 / 已完成；标题栏显示农历与节气
- 收集箱：存放无日期的事项，可拖到日历上安排日期
- 重复任务：每天 / 每周 / 每月（31 号自动落到小月月末）/ 每年 / 农历每年，按天独立打卡
- 中国节假日：法定假日（休）/ 调休上班（班）/ 周末 背景区分
- 项目工作台（灵感工坊）：灵感速记、需求整理、任务规划、资料链接、项目动态
- 备份：设置里一键导出 JSON（含回收站与打卡记录）
- 全局搜索（Ctrl+F）、深色模式、快捷键 N / T / ← →

## 开发

```bash
npm install
cp server/.env.example server/.env   # 填好 DATABASE_URL / AUTH_*
node server/index.mjs                # 后端，127.0.0.1:3002
npm run dev                          # 前端，/api 已代理到 3002
```

需要一个可用的 PostgreSQL，表结构在后端启动时自动创建。

## 部署（阿里云 ECS）

- 后端：`server/index.mjs`（systemd `workbench-api.service`，127.0.0.1:3002），`DATABASE_URL` 指向本机 Docker PostgreSQL 的 `workbench` 库
- 前端：`WEB_BASE_PATH=/workbench/ npm run build`，`dist/` 由 nginx 挂在 `/workbench/` 子路径，API 经 `/workbench/api/` 反代到 3002 端口
- 鉴权：签名的 HttpOnly Cookie；生产环境需在 `server/.env` 配置 `AUTH_USERNAME`、`AUTH_PASSWORD_SHA256`、`AUTH_SECRET` 与 `AUTH_COOKIE_PATH=/workbench`，可参考 `server/.env.example`
- 公网安全：登录凭据只有在 HTTPS 下才会加密传输；绑定正式域名后应配置 TLS 证书并将 HTTP 重定向到 HTTPS

## License

MIT
