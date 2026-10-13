# Workbench 个人工作台

一个以待办清单为核心的个人效率工具：智能清单导航 + 任务列表 + 详情面板，日历作为独立视图。
Vue 3 + FullCalendar 前端，Node.js + PostgreSQL 后端（`server/index.mjs`），多用户、Cookie 登录。

## 功能

- 日历：桌面浏览器月视图，手机默认周列表；支持快速添加、拖拽改期、优先级着色和完成打卡
- 快速添加：中文自然语言解析日期与重复（明天 / 周五 / 下周末 / 9月15日 / 每周三 / 每月31号）
- 登录：7 天会话、失败限流、退出登录与登录失效自动回到登录页
- 清单导航：收集箱 / 今天 / 最近 7 天 / 全部任务 / 标签分类 / 已完成 / 回收站；今天按逾期、待办、已完成分组
- 任务详情：桌面侧栏编辑，中等屏幕对话框，手机底部抽屉；未保存修改受保护，失败保留输入
- 收集箱：存放无日期的事项，可拖到日历上安排日期
- 重复任务：每天 / 每周 / 每月（31 号自动落到小月月末）/ 每年 / 农历每年，按天独立打卡
- 中国节假日：法定假日（休）/ 调休上班（班）/ 周末 背景区分
- 备份：设置里一键导出 JSON（含回收站与打卡记录）
- 多账号：管理员在「设置 → 账号与成员」创建账号、重置密码；各账号的任务、打卡互相隔离
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
- 鉴权：签名的 HttpOnly Cookie；生产环境需在 `server/.env` 配置 `AUTH_SECRET` 与 `AUTH_COOKIE_PATH=/workbench`，可参考 `server/.env.example`
- 账号：存在 `users` 表（密码 scrypt 哈希）。`AUTH_USERNAME`、`AUTH_PASSWORD_SHA256` 只在库里还没有管理员时用来创建首个管理员，之后改密码请在页面里操作；单用户时代的旧数据启动时自动归到该管理员名下
- 公网安全：登录凭据只有在 HTTPS 下才会加密传输；绑定正式域名后应配置 TLS 证书并将 HTTP 重定向到 HTTPS

## License

MIT
