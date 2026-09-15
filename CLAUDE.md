# CLAUDE.md — 微信智能体助手

> 快速导航：详细功能/架构/配置见 `C:\Users\16080\Desktop\文档\wechat\` 下的文档，本文聚焦**改代码需要知道的东西**。

## 一句话定位

Spring Boot 3.2.5 单体多模块 Maven 工程，微信扫码登录 Bot，LangGraph4j 编排 DeepSeek V4，支持工具调用、多模态、TTS。

## 模块速查（9 个 Maven 子模块 + 1 个桌面端）

| 模块 | 一句话 | 改什么来这里 |
|------|--------|-------------|
| `wechat-ai-common` | 统一响应、枚举、常量、工具类 | 跨模块共享 |
| `wechat-ai-session` | 会话/消息持久化（MySQL）、提醒调度 | 消息存储、会话恢复 |
| `wechat-ai-document` | 文档上传、解析（PDF/Word/TXT）、Embedding/Qdrant 向量检索 | 文档流水线、向量存储 |
| `wechat-ai-tool` | `@Tool` 注册、ToolRegistry、Skills、MCP 接入 | 增删工具、MCP 源 |
| `wechat-ai-agent` | 子 Agent 注册（AgentToolRegistration） | 新增/调整 Agent |
| `wechat-ai-ai` | LangGraph 编排、LLM/TTS/多模态、图中断、Watchdog | AI 流水线、图节点 |
| `wechat-ai-proactive` | 行为路径自学习（RAG检索→工具链复用→置信度进化） | 路径检索、反馈解析、策略决策 |
| `wechat-ai-wechat` | iLink SDK 接入（登录、收发、分发、出站） | 微信消息处理 |
| `wechat-ai-starter` | 启动入口、`application.properties`、全局配置 | 启动/配置 |
| `desktop/` | React + Vite 桌面端壳（Tauri 打包） | 聊天UI、前端页面 |

基础包路径：`com.wechatai.*`，启动类：`com.wechatai.WechatAiApplication`

## Agent 体系（4 个）

| Agent | 工具来源 | 场景 |
|-------|----------|------|
| `generalAgent` | 本地 @Tool beans | 天气/翻译/浏览器/邮件/提醒 |
| `taxiAgent` | MCP:DIDI | 打车/路线/地点搜索 |
| `filesystemAgent` | MCP:FILESYSTEM | 文件读写/目录操作 |
| `jobAgent` | MCP:LIEPIN（13 工具） | 简历/职位搜索/投递 |

Agent 注册：`AgentToolRegistration` → 路由：`ToolExecuteNode` switch → 执行：`AgentGraphRunner`

## MCP 架构

```
mcp/                          ← 接口 + POJO + 通用
├── McpSource.java、McpToolDefinition.java、McpClientManager.java、McpToolBridge.java
├── impl/                     ← 具体实现
│   ├── DidiMcpSource、FilesystemMcpSource、LiepinMcpSource
└── config/                   ← 配置类
    ├── McpConfigProperties、LiepinMcpConfigProperties
```

新加 MCP 源：`config/` 加配置类 + `impl/` 加 Source 实现 + `application.properties` 加配置 + 可选注册新 Agent。

## 行为路径自学习系统（v0.3，Phase 3 已落地）

```
每次 Agent 调用 → RAG 检索相似历史任务 → 温/热路径直接复用工具链
→ 用户反馈更新置信度 → 负面反馈触发 Critic LLM 分析 → 规则绑定到路径 → 下次命中注入
```

### 闭环流程
1. `BehaviorPathService.retrieveAndDecide()` — Agent 启动前：userMessage → Embedding → Qdrant 向量检索 → 策略决策（fast/hybrid/slow）+ 时间衰减
2. `BehaviorPathService.recordAfterAgent()` — Agent 完成后：录制工具链 → 写入 MySQL + 索引到 Qdrant
3. `BehaviorPathService.collectFeedback()` — 下条消息到来时：解析用户反馈 → 更新 Beta 分布置信度 → 条件触发 Critic 分析

### Phase 2 新增（Critic 反思）
- `CriticTriggerDecider` — 判定是否触发（failure/harmful/partial → 必触发，success+新路径 → 触发一次）
- `CriticEvaluator` — 调 DeepSeek 分析失败原因，生成结构化规则
- 规则绑定到路径的 `critic_rules` JSON 列，**RAG 命中该路径时才注入**（不是全局注入）

### Phase 3 新增（路径库维护）
- `PathMergeService` — 启动时全量扫描，sim>0.85 且 tool_chain 一致则合并 α/β
- `PathMaintenanceScheduler` — 每天 3 点归档过期路径（90天未用 + use_count<10），每天 4 点标记矛盾路径（好坏各半 → degraded）
- 个人权重：用户对同一路径使用 3 次以上时，finalConf = 0.7×全局 + 0.3×个人
- degraded 路径强制走温路径，不参与热路径

### 模块结构
```
wechat-ai-proactive/src/main/java/com/wechatai/proactive/
├── config/ProactiveConfig.java
├── model/{BehaviorPath,DecisionTrace,PathEvaluation,FeedbackSignal}
├── path/{BehaviorPathService,ConfidenceUpdater,PathEmbeddingService,BehaviorPathMapper,PathMergeService,PathMaintenanceScheduler}
├── feedback/FeedbackParser.java
└── critic/{CriticTriggerDecider,CriticEvaluator,CriticVerdict,RuleInjector}
```

### 集成点（纯增量，不改现有逻辑）
- `AgentGraphRunner.run()` — 开头调 retrieveAndDecide（RAG检索 + 路径规则注入），结尾调 recordAfterAgent
- `WechatChatBridge.doThink()` — 开头调 collectFeedback（反馈解析 + 置信度更新 + Critic触发）

### 数据库（3 张新表）
`behavior_paths` / `decision_traces` / `path_evaluations`，详见 `C:\Users\16080\Desktop\文档\behavior-path-self-learning.md`

### 配置
```properties
wechat.proactive.enabled=true
wechat.proactive.hot-threshold=0.75        # 置信度阈值
wechat.proactive.min-similarity=0.6       # 向量检索最小相似度
wechat.proactive.retrieve-top-k=10        # 检索 Top-K
wechat.proactive.qdrant.collection=behavior_paths
```

## 关键机制

### ReAct 超时看门狗（RunWatchdog）
- 工具级 60s → 超时注入 error JSON
- Agent 级 30s → 超时返回 fail
- Bridge 总 120s → 超时告知用户
- 配置：`wechat.watchdog.tool-timeout-ms` / `wechat.watchdog.bridge-timeout-ms`

### 熔断器（LlmService）
- 连续 3 次 400 / 8 次异常 / 消息超 150 条 → 拉闸
- 仅重启恢复

### 图中断
- WRITE 工具（`@WriteTool` 或 MCP `getWriteToolNames()`）→ tool_execute 前中断 → 用户确认
- 消息上限 30 轮（60 条非系统消息）
- `cleanupOrphanedToolCalls`：双向清理 + 去重

### HTTP 超时
- JDK HttpClient：connect 30s / read 120s（`LlmService.init()`）

## 编码约定

- Java 21，Lombok，构造器注入
- MyBatis XML 在 `classpath*:mapper/**/*.xml`
- 返回体统一用 `com.wechatai.common.Result<T>`
- 日志 `log.info/warn/error`（Slf4j），关键节点加 `【模块名】` 前缀

## 常用命令

```bash
./mvnw clean package -DskipTests    # 构建
cd wechat-ai-starter && mvn spring-boot:run  # 启动
./mvnw compile                      # 编译检查
```

## 桌面端（React + Vite + Tauri）

### 项目结构
```
desktop/
├── index.html          # 入口页面
├── package.json        # React 18 + Vite 5 + Tauri CLI
├── vite.config.js      # 端口3000，/api 代理到 localhost:8081，排除 src-tauri 监听
├── src-tauri/          # Rust 壳 + Tauri 配置
│   └── tauri.conf.json # 窗口 1100×700，NSIS 打包
└── src/
    ├── main.jsx        # React 入口
    ├── App.jsx         # 聊天组件（侧边栏 + 对话列表 + 消息区 + 输入框）
    ├── App.css         # ChatGPT 风格深色主题
    └── api.js          # 开发走 Vite 代理，打包走 localhost:8081
```

### 开发
```bash
cd desktop && npx tauri dev     # 桌面窗口 + 热更新
```

### 打包
```bash
set HTTPS_PROXY=http://127.0.0.1:7890   # 需开代理
npx tauri build
# 产物: src-tauri/target/release/bundle/nsis/wechat-ai-desktop_0.1.0_x64-setup.exe
```

### Rust 环境
- 安装到 `D:\Rust\`（需设 RUSTUP_HOME / CARGO_HOME 环境变量）
- 镜像：`D:\Rust\.cargo\config.toml`
- 代理：打包时需开 clash（7890）下载依赖

## 文档索引

- `C:\Users\16080\Desktop\文档\wechat\更新日志.md`
- `C:\Users\16080\Desktop\文档\wechat\wechat-ai-assistant-api.md`
- `C:\Users\16080\Desktop\文档\MCP\猎聘MCP接入实现详解.md`
- `C:\Users\16080\Desktop\文档\devlog\devlog-2026-07-31.md`
