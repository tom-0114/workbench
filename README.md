# Workbench 个人工作台

一个以待办清单为核心的个人效率工具：智能清单导航 + 任务列表 + 详情面板，日历作为独立视图。
Vue 3 + FullCalendar 前端，Node.js + PostgreSQL 后端（`server/index.mjs`），多用户、Cookie 登录。

## 功能

- 日历：桌面浏览器月视图，手机默认周列表；支持快速添加、拖拽改期、优先级着色和完成打卡
- 快速添加：中文自然语言解析日期、时间与重复（明天 / 周五 / 下周末 / 9月15日 / 下午3点 / 15:30 / 每周三 / 每月31号）
- 时间与提醒：任务可设具体时间和提醒（准时 / 提前 5 分钟～1 天；全天任务当天或前一天 09:00），到点推送到开启了通知的手机和电脑
- 可安装：支持「添加到主屏幕」以独立窗口打开（PWA）；iPhone 需从主屏幕打开才能收通知
- 登录：7 天会话、失败限流、退出登录与登录失效自动回到登录页
- 清单导航：收集箱 / 今天 / 最近 7 天 / 全部任务 / 标签分类 / 已完成 / 回收站；今天按逾期、待办、已完成分组
- 任务详情：桌面侧栏编辑，中等屏幕对话框，手机底部抽屉；未保存修改受保护，失败保留输入
- 收集箱：存放无日期的事项；日历右侧可展开收集箱侧栏，拖到某天安排日期，日历上的事项拖回侧栏即取消日期；手机上在日历底部打开收集箱选日期
- 重复任务：每天 / 每周 / 每月（31 号自动落到小月月末）/ 每年 / 农历每年，按天独立打卡，显示连续完成次数
- 已完成：记录完成时间，按完成日期分组回看
- 中国节假日：法定假日（休）/ 调休上班（班）/ 周末 背景区分
- 备份：设置里导出 JSON（含回收站与打卡记录），也可导入备份覆盖恢复
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
- 提醒推送：需要 HTTPS（Service Worker 与推送只在安全上下文可用）。在 `server/.env` 配 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`（生成命令见 `server/.env.example`），重启后端即启用；不配则不推送，其余功能不受影响。密钥一旦换掉，各设备需在「设置 → 提醒通知」重新开启
- 提醒的工作方式：前端按重复规则算出未来 35 天的提醒交给后端（`reminders` 表），后端每 30 秒检查一次，发送前核对任务是否已删除、已完成或在别的设备上改过。推送加密用 `node:crypto` 自己实现（`server/webpush.mjs`），没有引入 MPL 许可的 web-push 库

## 测试

```bash
node --test tests/webpush.test.mjs   # 推送加密与签名，含 RFC 8291 官方测试向量
# 接口测试需要一个独立的测试库，用法见 tests/api.test.mjs 文件头
node tests/ui-fixture.mjs            # 界面测试用的内存假后端（127.0.0.1:3002）
npx vite --host 127.0.0.1 --port 5176 --strictPort
node tests/ui-smoke.mjs              # 需另行安装 playwright，可用 WORKBENCH_PLAYWRIGHT_DIR 指定
```

## License

MIT
