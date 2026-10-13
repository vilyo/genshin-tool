# 原神工具箱

在本地汇总原神祈愿记录并评价玩家欧非情况的 Windows 桌面工具。

## 隐私承诺

你的祈愿记录属于个人数据：统计全部在本地完成，不内置任何遥测与上传，不会把记录发往任何远程服务器。数据获取走米哈游官方祈愿查询接口，仅在你主动发起时调用。

## 技术栈

Tauri 2 + Vue 3 + TypeScript + Pinia；Rust 侧负责祈愿链接探测（客户端日志）、官方接口拉取与本地 SQLite 档案存储。

## 开发

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 桌面开发(同时起 Vite 与 Rust 编译)
npm run build        # 前端生产构建(含类型检查)
npm run typecheck    # 类型检查
npm run lint         # ESLint
npm test             # Vitest 全量(日常请只跑相关 spec,见 AGENTS.md)
cd src-tauri && cargo check
```

本项目面向 Windows 发布（便携包）；macOS 仅用于开发调试。

## 状态

早期开发中，功能尚未可用。
