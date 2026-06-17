# 强制自动更新功能

## 功能说明

已实现应用启动时自动检测最新版本并强制更新的功能。

## 实现细节

### 修改的文件
- `src/main/updater.ts` - 主要更新逻辑

### 关键改动

1. **自动下载模式**
   - `autoUpdater.autoDownload = true` - 检测到更新时自动下载，无需用户确认
   - `autoUpdater.autoInstallOnAppQuit = true` - 应用退出时自动安装

2. **启动时自动检查**
   - 应用启动时立即检查更新
   - 控制台输出：`[Updater] Checking for updates on startup (forced update mode)...`

3. **自动下载和安装流程**
   - 检测到新版本 → 自动开始下载
   - 下载完成 → 1.5秒后强制重启并安装
   - UI会显示下载进度和更新提示

4. **事件处理**
   - `update:available` - 通知UI有新版本正在下载（包含 `autoDownloading: true` 标志）
   - `update:download-progress` - 下载进度更新
   - `update:downloaded` - 下载完成，即将重启
   - `update:error` - 更新错误

### 工作流程

```
应用启动
  ↓
检查更新
  ↓
发现新版本 → 自动下载（显示进度）
  ↓
下载完成 → 等待1.5秒
  ↓
强制重启并安装更新
```

## 配置要求

更新服务器配置在 `dev-app-update.yml`（开发环境）或发布时的 `electron-builder.yml`：

```yaml
provider: github
owner: smawatch
repo: OpenCowork
releaseType: release
```

## 注意事项

1. **网络要求**：需要网络连接才能检查更新
2. **平台支持**：仅支持 Windows、macOS、Linux
3. **macOS签名**：macOS需要有效的Developer ID签名才能自动安装更新
4. **用户提示**：UI会显示下载进度和更新信息，用户体验流畅

## 禁用自动更新

如果用户禁用了自动更新（在设置中），则不会执行强制更新：

```typescript
if (!isAutoUpdateEnabled()) {
  console.log('[Updater] Auto update is disabled. Skip startup update check.')
  return
}
```

## 测试建议

### 开发环境测试
```bash
npm run dev
```

查看控制台输出：
- `[Updater] Checking for updates on startup (forced update mode)...`
- `[Updater] Update available: X.X.X. Auto-downloading...`
- `[Updater] Update X.X.X downloaded. Installing...`
- `[Updater] Forcing quit and install...`

### 生产环境测试
需要发布到GitHub Releases并创建新版本才能测试完整的更新流程。

## 相关代码位置

- 更新器主逻辑：`src/main/updater.ts`
- 应用启动调用：`src/main/index.ts` 第1305-1310行
- 更新配置：`dev-app-update.yml`
- 构建配置：`electron-builder.yml`
