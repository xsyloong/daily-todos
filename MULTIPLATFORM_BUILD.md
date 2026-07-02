# 多平台构建说明

## 当前结论

Tauri 桌面应用建议在目标操作系统上构建对应安装包：

- Windows 包在 Windows 上构建。
- Linux 包在 Linux 上构建。
- macOS 包在 macOS 上构建。

Windows 本机可以继续生成 `daily-todo-app.exe`、NSIS 安装包和 MSI。Linux/macOS 包已通过 GitHub Actions 工作流配置，由对应 runner 生成。

## GitHub Actions 构建

工作流文件：`.github/workflows/build-desktop.yml`

触发方式：

1. 手动触发 `workflow_dispatch`。
2. 推送 tag，例如 `v1.0.0`。

产物名称：

- `daily-todo-app-windows`
- `daily-todo-app-linux`
- `daily-todo-app-macos`

产物路径来自：

- `src-tauri/target/release/bundle/**/*`
- `src-tauri/target/release/daily-todo-app.exe`
- `src-tauri/target/release/daily-todo-app`

## 本机 Windows 构建

```bash
npm ci
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
```

Windows 绿色版位置：

```text
src-tauri/target/release/daily-todo-app.exe
```

Windows 安装包位置：

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

## Linux 本机构建

Ubuntu 22.04 示例：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
npm ci
npm run tauri -- build
```

## macOS 本机构建

macOS 示例：

```bash
npm ci
npm run tauri -- build
```

如需对外分发 macOS 包，后续还需要配置 Apple Developer 证书、公证和签名；当前工作流生成的是未签名构建产物。

## 跨平台注意事项

- 已补充 Windows、Linux、macOS 三个平台的开机启动实现。
- 系统托盘和通知依赖桌面环境支持，Linux 下不同发行版可能表现略有差异。
- 数据文件夹功能使用普通文件系统路径，各平台均可用。
- 默认数据目录由 `dirs::data_local_dir()` 决定，各平台路径不同。
