# OpenCowork 架构分析计划

## 目标
深度分析OpenCowork项目架构设计并生成SVG架构图

## 分析结果

### 项目概述
OpenCowork是一个开源的桌面平台，用于多代理AI协作。它是一个4层Electron桌面应用（Main → Preload → Renderer → Agent runtime）。

### 架构层次

#### 1. Main Process (主进程)
- **系统访问**：文件系统、Shell、SSH、网络
- **数据存储**：SQLite数据库（better-sqlite3）
- **消息插件**：支持8个平台（飞书、钉钉、Discord、QQ、Telegram、企业微信、微信公众号、WhatsApp）
- **定时任务**：Cron调度器
- **MCP客户端**：连接Model Context Protocol服务器
- **IPC处理器**：处理来自渲染进程的请求

#### 2. Preload Bridge (预加载桥)
- **安全通信**：通过contextBridge暴露有限的API
- **类型安全**：TypeScript类型定义
- **API封装**：封装IPC调用

#### 3. Renderer UI (渲染进程UI)
- **React 19**：现代React框架
- **Tailwind CSS**：样式框架
- **Zustand**：状态管理
- **Agent Loop**：代理循环执行
- **工具系统**：文件I/O、浏览器、任务、计划、目标、内存、技能等

#### 4. Agent Runtime (代理运行时)
- **Provider-agnostic**：支持多个AI提供商
- **流式响应**：实时流式处理
- **工具调用**：处理各种工具调用
- **会话模式**：chat、clarify、cowork、code、acp

### 关键组件关系

1. **IPC通信**：Renderer通过Preload调用Main Process的IPC处理器
2. **工具系统**：Renderer中的工具通过IPC调用Main Process的系统功能
3. **状态管理**：Zustand stores管理UI状态，通过IPC与Main Process同步
4. **数据库**：Main Process中的SQLite存储消息、会话、项目、任务、计划等
5. **消息插件**：Main Process中的Channel Manager管理多个消息平台连接

### 数据流

1. 用户输入 → Renderer UI → Agent Loop → 工具调用 → IPC → Main Process → 系统操作
2. 系统响应 → Main Process → IPC → Renderer UI → 用户界面更新
3. 消息插件 → Main Process → IPC → Renderer UI → 用户界面显示

## 下一步
创建SVG架构图来可视化这个架构