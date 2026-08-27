# Workbench 个人工作台

一个安静、克制的 Windows 桌面个人效率工具：月度日历 + Todo，macOS 风格视觉。
基于 Tauri 2 + Vue 3 + FullCalendar，数据存本地 SQLite。

## 功能

- 月视图：点日期格子快速添加、拖拽改期、优先级着色、点圆点打卡完成
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
