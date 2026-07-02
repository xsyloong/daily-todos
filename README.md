# 每日待办

轻量级本地优先桌面待办应用，支持普通待办、长期计划、小组件、提醒和本地 JSON 数据文件夹同步。

## 核心功能

- 普通待办：按日期添加、完成、删除，可设置时间段提醒。
- 长期待办：支持开始/结束日期、每日完成记录、阶段备注和提前完成。
- 日期选择器：只能查看今天及过去日期，展示长期任务综合状态和当日详情。
- 小组件：独立置顶窗口，展示今日待办并支持快速勾选。
- 数据同步：可指定数据文件夹，自动读写 `daily-todos.json`，适合放入个人 Git 笔记仓库。
- 开机启动：支持 Windows、Linux、macOS。
- 多平台构建：通过 GitHub Actions 构建 Windows、Linux、macOS 桌面包。

## 开发

```bash
npm ci
npm run tauri dev
```

## 构建

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
```

Windows 绿色版输出：

```text
src-tauri/target/release/daily-todo-app.exe
```

安装包输出：

```text
src-tauri/target/release/bundle/
```

## 文档

- [需求梳理](./REQUIREMENTS.md)
- [多平台构建说明](./MULTIPLATFORM_BUILD.md)
