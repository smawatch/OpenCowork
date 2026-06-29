# 阿里云 OSS 自动更新配置指南

## 概述

本项目已配置为使用阿里云 OSS 作为自动更新服务器，替代 GitHub Releases，以提升国内用户的下载速度。

## 配置步骤

### 1. 创建阿里云 OSS Bucket

1. 登录 [阿里云 OSS 控制台](https://oss.console.aliyun.com/)
2. 创建一个新的 Bucket
   - **Bucket 名称**：建议 `cocowork-downloads`
   - **区域**：选择离目标用户最近的区域（如 `华东1（杭州）`）
   - **读写权限**：设置为 **公共读**（重要！）
   - **存储类型**：标准存储

### 2. 获取 OSS 凭证

1. 在阿里云控制台创建 AccessKey
   - 访问 [AccessKey 管理](https://ram.console.aliyun.com/manage/ak)
   - 点击"创建 AccessKey"
   - 保存 `AccessKey ID` 和 `AccessKey Secret`

2. 获取 Endpoint
   - 在 OSS Bucket 概览页面找到 **Endpoint**
   - 例如：`oss-cn-hangzhou.aliyuncs.com`

### 3. 配置 GitHub Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加以下 Secret：

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `OSS_ACCESS_KEY_ID` | 阿里云 AccessKey ID | `LTAI5t...` |
| `OSS_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret | `xxxxxxxx...` |
| `OSS_BUCKET_NAME` | OSS Bucket 名称 | `cocowork-downloads` |
| `OSS_ENDPOINT` | OSS Endpoint | `https://oss-cn-hangzhou.aliyuncs.com` |
| `OSS_REGION` | OSS 区域（可选） | `cn-hangzhou` |

### 4. 更新 electron-builder.yml

已配置为使用 generic provider：

```yaml
publish:
  provider: generic
  url: https://cocowork-downloads.oss-cn-hangzhou.aliyuncs.com/releases/
```

**注意**：请将 URL 中的 bucket 名称和区域替换为你的实际配置。

## 文件结构

OSS 中的文件将按以下结构组织：

```
cocowork-downloads/
├── latest.yml                      # Windows 自动更新元数据
├── latest-mac.yml                  # macOS 自动更新元数据
├── releases/
│   ├── 0.9.120/
│   │   ├── index.html              # 下载页面
│   │   ├── CoCoWork-0.9.120-setup.exe
│   │   ├── CoCoWin-0.9.120-setup.exe.blockmap
│   │   ├── CoCoWork-mac-arm64.dmg
│   │   ├── CoCoWork-mac-arm64.zip
│   │   ├── CoCoWork-linux-amd64.AppImage
│   │   └── latest.yml              # 版本目录下的元数据
│   └── 0.9.121/
│       └── ...
```

## 自动更新工作原理

1. **构建时**：electron-builder 生成 `latest.yml` 文件，包含最新版本号和文件哈希
2. **上传到 OSS**：GitHub Actions 将 `latest.yml` 同时上传到：
   - `releases/{version}/latest.yml` （归档）
   - `latest.yml` （根目录，供 electron-updater 查询）
3. **客户端检查更新**：
   - electron-updater 访问 `https://bucket.oss-endpoint/releases/latest.yml`
   - 对比当前版本和最新版本
   - 如果有更新，从 OSS 下载安装包

## 测试自动更新

### 方法 1：手动触发构建

1. 在 GitHub Actions 中手动触发 workflow
2. 输入版本号（如 `0.9.120`）
3. 等待构建完成并上传到 OSS
4. 检查 OSS 中是否有 `latest.yml` 文件

### 方法 2：发布 Release

1. 在 GitHub 上创建新的 Release
2. 触发自动构建
3. 构建产物自动上传到 OSS

### 方法 3：本地测试

```bash
# 设置环境变量指向 OSS
export VITE_UPDATE_URL="https://cocowork-downloads.oss-cn-hangzhou.aliyuncs.com/releases/"

# 启动应用
npm run dev
```

## 访问下载页面

上传完成后，可以通过以下 URL 访问下载页面：

```
https://cocowork-downloads.oss-cn-hangzhou.aliyuncs.com/releases/0.9.120/index.html
```

## 常见问题

### Q: electron-updater 找不到更新？

A: 检查以下几点：
1. 确认 `latest.yml` 文件已上传到 OSS 根目录
2. 确认 Bucket 权限设置为 **公共读**
3. 检查 `electron-builder.yml` 中的 URL 是否正确
4. 在浏览器中访问 `https://bucket.oss-endpoint/releases/latest.yml` 确认可以访问

### Q: 下载速度慢？

A: 
1. 确认使用了正确的 OSS Endpoint（国内区域）
2. 可以考虑开启 OSS 的 CDN 加速
3. 检查 Bucket 的传输加速是否开启

### Q: 如何回退到 GitHub Releases？

A: 修改 `electron-builder.yml`：

```yaml
publish:
  provider: github
  owner: smawatch
  repo: OpenCowork
  releaseType: release
```

## 安全建议

1. **AccessKey 权限最小化**：只授予 OSS 写入权限
2. **定期轮换 AccessKey**：建议每 90 天更换一次
3. **监控 OSS 流量**：设置告警防止异常流量
4. **版本回滚**：保留历史版本的安装包

## 技术支持

如有问题，请查看：
- [electron-updater 文档](https://www.electron.build/auto-update)
- [阿里云 OSS 文档](https://help.aliyun.com/product/31815.html)
- GitHub Issues: https://github.com/smawatch/OpenCowork/issues
