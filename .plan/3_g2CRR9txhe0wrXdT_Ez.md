# OpenCowork Prompt Cache 命中率首版实施计划（修订版）

## 1. Summary and scope

修订依据：计划被 rejected；当前未收到具体 rejection 备注，因此本版按最低风险方向进一步收敛为 **首版最小可执行 PR**，优先实现 Reasonix 最关键的缓存稳定策略，让同一 session 内的 provider 请求尽量保持 `system prompt + tools schema + 历史前缀` 稳定。

本轮只做低风险、可验证、不会大改业务语义的闭环：

1. 稳定 tools schema 输出顺序。
2. 放宽 prompt snapshot 复用条件，避免 plan mode / memory snapshot 等动态上下文导致 system prompt 重建。
3. 把 plan mode 动态约束注入当前请求副本的 user turn tail，不改写历史消息。
4. 增加 cache shape debug：`systemHash` / `toolsHash` / `messagePrefixHash` / `toolCount`。
5. 补充 cache usage ratio：`cacheReadRatio`。
6. 禁止 pre-compress 阈值提前改写 transcript，只保留 full compression 兜底。

后置项不阻塞本轮：cold resume prune、CI cache guard、多 agent 深度隔离、full compression 前精细 prune、memory update / active goal 全量 turn-tail 迁移。

## 2. Requirements and acceptance criteria

### R1. Stable tool definitions

- `ToolRegistry` 新增稳定输出 API：`getStableDefinitions()` / `getStableNames()`。
- Provider 请求路径使用 stable definitions。
- `getDefinitions()` 保持原 insertion order，避免影响 UI / 注册侧。
- 相同工具集合在不同注册顺序下生成相同 `toolsHash`。

### R2. Prompt snapshot freeze

- 同一 session 内，只要 mode / model / provider binding / working folder / SSH target 未变化，就默认复用首次生成的 `systemPrompt` 和 `toolDefs`。
- `canReusePromptSnapshot` 不再因为 `planMode`、`memorySnapshot`、active team transient context 改变而失效。
- 现有显式清理边界保持：mode / model / folder / SSH 变化仍 clear snapshot。
- `SessionPromptSnapshot` 增加可选元数据：`createdAt`、`systemHash`、`toolsHash`。

### R3. Plan mode turn-tail

- plan mode 开启时，把约束 prepend 到请求副本中最新 user message：

```text
<turn-context>
<plan-mode>enabled: use planning constraints for this turn.</plan-mode>
</turn-context>

用户原始输入...
```

- 不修改已入库历史消息。
- plan mode toggle 不改变 `systemHash`。

### R4. Cache shape debug

- 新增 renderer helper 计算：
  - `systemHash`
  - `toolsHash`
  - `messagePrefixHash`
  - `toolCount`
- simple chat 与 full agent loop 请求 debug 中都能看到这些字段。
- 不改变 provider payload，只进入 debug / trace 数据。

### R5. Cache usage ratio

- usage 类型与归一化逻辑保留已有：`cacheReadTokens` / `cacheCreationTokens`。
- 新增 `cacheReadRatio = cacheReadTokens / inputTokens`。
- 没有 input tokens 或 cache tokens 时保持 undefined，避免误导。

### R6. Pre-compress 不再改写前缀

- pre-compress threshold 命中时不再提前 rewrite `conversationMessages` / transcript。
- full compression 兜底保留。
- 目标是减少低阈值自动改写对 provider prefix cache 的破坏。

## 3. Architecture / design and key types

### 3.1 Stable tools

文件：`src/renderer/src/lib/agent/tool-registry.ts`

新增稳定排序缓存：

```ts
getStableDefinitions(): ToolDefinition[]
getStableNames(): string[]
```

排序规则：

1. `name`
2. `description`
3. stable stringify `inputSchema`

`invalidate()` 同步清理 stable cache。

### 3.2 Cache shape helper

新增文件：`src/renderer/src/lib/agent/cache-shape.ts`

建议接口：

```ts
export interface PromptCacheShape {
  systemHash: string
  toolsHash: string
  messagePrefixHash: string
  toolCount: number
}
```

实现：

- 使用 deterministic stringify。
- `systemHash` 基于 raw system prompt。
- `toolsHash` 基于 stable sorted tool definitions。
- `messagePrefixHash` 基于请求消息中除最新 user turn 以外的前缀，避免用户新输入导致每轮必变。

### 3.3 Turn context helper

新增文件：`src/renderer/src/lib/agent/turn-context.ts`

首版只支持 plan mode：

```ts
prependTurnContextToLastUserMessage(messages, { planMode })
```

设计约束：

- 返回 request messages 副本。
- 不 mutate store messages。
- 只处理最后一条 user message。
- 若没有动态上下文，原样返回。

### 3.4 Prompt snapshot metadata

文件：`src/renderer/src/stores/chat-store.ts`

扩展：

```ts
export interface SessionPromptSnapshot {
  createdAt?: number
  systemHash?: string
  toolsHash?: string
}
```

`setSessionPromptSnapshot` 复制新增字段。

### 3.5 Usage ratio

文件：

- `src/renderer/src/lib/api/types.ts`
- `src/shared/agent-stream-protocol.ts`
- `src/renderer/src/hooks/use-chat-actions.ts`
- 必要时补 `src/main/cron/cron-agent-background.ts`

新增可选字段：

```ts
cacheReadRatio?: number
```

## 4. Step-by-step implementation

### Step 1：工具 schema 稳定化

1. 修改 `src/renderer/src/lib/agent/tool-registry.ts`：
   - 增加 stable definitions / names cache。
   - 增加 `getStableDefinitions()` / `getStableNames()`。
   - `invalidate()` 清理 stable cache。

2. 修改 provider 请求侧调用：
   - `src/renderer/src/hooks/use-chat-actions.ts`
     - `toolRegistry.getDefinitions()` 改为 `getStableDefinitions()`，仅限请求构造路径。
   - `src/renderer/src/lib/agent/teams/teammate-runner.ts`
     - provider-facing tool defs 改 stable。
   - `src/renderer/src/lib/agent/sub-agents/runner.ts`
     - provider-facing tool defs 改 stable。

### Step 2：新增 cache shape helper

1. 新增 `src/renderer/src/lib/agent/cache-shape.ts`。
2. 在 `use-chat-actions.ts` 中导入 helper。
3. 在 simple chat 与 full agent loop 构造 system prompt / effective tool defs 后计算 shape。
4. 将 shape 写入现有 request debug 对象，不改 provider payload。

### Step 3：冻结 prompt snapshot 动态失效项

1. 修改 `src/renderer/src/stores/chat-store.ts`：
   - 扩展 `SessionPromptSnapshot`。
   - `setSessionPromptSnapshot` 保留新增字段。

2. 修改 `src/renderer/src/hooks/use-chat-actions.ts`：
   - simple chat path 的 `canReusePromptSnapshot` 移除 `contextCacheKey` 动态强校验。
   - full agent path 的 `canReusePromptSnapshot` 移除 `planMode` / memory snapshot / active team transient 相关强校验。
   - 创建 snapshot 时保存 `createdAt`、`systemHash`、`toolsHash`。

3. 保留已有 clear snapshot 行为，不新增跨 session 持久化。

### Step 4：plan mode turn-tail

1. 新增 `src/renderer/src/lib/agent/turn-context.ts`。
2. 在 full agent loop 请求消息副本构造后调用 helper：
   - 只 prepend 当前请求的最后一个 user message。
   - store / DB 历史不变。
3. simple chat 如有 plan mode 入口，同样只作用于请求副本。

### Step 5：usage ratio

1. 扩展 usage 类型，新增 `cacheReadRatio?: number`。
2. 在 usage normalize / merge 处计算：

```ts
cacheReadRatio = inputTokens > 0 && cacheReadTokens > 0
  ? cacheReadTokens / inputTokens
  : undefined
```

3. request debug / persisted usage 不丢失已有字段。

### Step 6：pre-compress no-op

1. 修改 `src/main/cron/cron-agent-background.ts`：
   - `shouldPreCompressContext(...)` 命中时不再调用 `preCompressContextMessages(...)` 改写 `conversationMessages`。
   - 保留 full compression 分支。

2. 修改 `src/renderer/src/lib/agent/context-compression.ts` 或自动调用点：
   - 自动 pre-compress 不再改写 messages。
   - manual/full compression 行为保持。

## 5. Testing strategy

### Static checks

- `npm run typecheck`
- `npm run lint`

### Focused manual checks

1. 同一 session 连续 3 轮请求：
   - `systemHash` 稳定。
   - `toolsHash` 稳定。
   - 第二轮开始可观察 `cacheReadTokens` / `cacheReadRatio`。

2. Plan mode toggle：
   - toggle 前后 `systemHash` 不变。
   - 当前请求最后 user message 有 `<turn-context>` plan mode 块。
   - 历史消息未被写入该块。

3. Tool order stability：
   - 刷新 skill / sub-agent / extension tools 后，相同集合 `toolsHash` 不变。

4. Compression：
   - 到达 pre-compress threshold 时不改写 conversation messages。
   - full compression 仍可触发并完成。

## 6. Risks and mitigations

### Risk 1：冻结 system prompt 后动态状态传达不及时

缓解：首版先迁移 plan mode 到 turn-tail；memory update / active goal 作为后续小 PR，避免重复注入。

### Risk 2：stable tool order 影响隐性依赖顺序

缓解：不改变 `getDefinitions()`，只在 provider 请求路径使用 stable API。

### Risk 3：pre-compress no-op 增加上下文上限风险

缓解：full compression 保留；provider context error fallback 仍按现有逻辑处理。

### Risk 4：当前工作区已有未提交改动

缓解：实施时只改本计划列出的文件；修改前先 read/diff，避免覆盖无关用户改动。

## 7. Out of scope for this PR

- CI cache-impact guard。
- cold resume prune。
- full compression 前精细 prune。
- 多 agent / team 深度 session 隔离重构。
- 把 memory update / active goal / background jobs 全量迁移到 turn-tail。
- 跨 app 重启持久化 prompt snapshot。

## 8. Done definition

本轮完成时需要报告：

- 已改文件列表。
- `npm run typecheck` 结果。
- `npm run lint` 结果；若失败，区分 pre-existing 与 introduced。
- 是否完成手动 cache shape smoke。
