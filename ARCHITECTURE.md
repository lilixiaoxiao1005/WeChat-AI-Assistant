# 架构说明（ARCHITECTURE）

> 本文档为该个人仓库的架构梳理，站在维护者视角，说明模块边界、数据流、MCP 接入与环境变量。
> 更偏“使用与协作”的项目说明见 [`README.md`](./README.md)；启动与部署步骤见 [`DEPLOY.md`](./DEPLOY.md)。

---

## 1. 总体形态

这是一个**单体多模块 Maven 工程 + 桌面端（Tauri 2）**的微信 AI 助手：

- 后端：Spring Boot 3.2 · JDK 21 · MyBatis · MySQL 8 · Redis · LangChain4j / LangGraph4j · DeepSeek · iLink SDK
- 前端：`desktop/` 下 React + Vite，经 Tauri 2 打包为桌面客户端；同时桌面端通过 REST/SSE 与后端通信
- 入口双通道：**微信（iLink SDK）** 与 **桌面客户端**
- 包名统一为 `com.wechatai.*`，共 9 个后端模块

---

## 2. 后端模块（`wechat-ai-*`）

| 模块 | 职责 | 关键包 |
|------|------|--------|
| `wechat-ai-common` | 统一响应、枚举、常量、工具类、Skill 公共契约 | `constant` `enums` `model` `common.skill` `util` |
| `wechat-ai-starter` | 启动入口 `WechatAiApplication` 与全局配置 | `config` |
| `wechat-ai-session` | 会话 / 消息 / 提醒 / 桌面通知持久化 | `entity` `mapper` `controller` `service` `db.migration` |
| `wechat-ai-document` | 文档上传、解析（PDF/Word/TXT）、检索 | `controller` `service` `service.parser` `entity` `mapper` |
| `wechat-ai-tool` | `@Tool` 注册、Skills、读写工具实现、MCP 框架 | `impl` `registry` `skill` `mcp` `mcp.impl` `mcp.config` |
| `wechat-ai-ai` | LangGraph 编排、LLM / 多模态 / TTS、SSE 流式、图中断 | `agent` `ai` `graph` `node` `controller` `service` |
| `wechat-ai-wechat` | iLink 接入（扫码登录、收发、分发、出站、多账号） | `connection` `message` `multi` `service` `event` |
| `wechat-ai-agent` | Agent 编排 / LLM 调用抽象 | `AgentInvoker` `LlmCaller` `AgentToolRegistration` |
| `wechat-ai-proactive` | 主动服务：行为路径自学习、Critic 评估、反馈解析 | `critic` `feedback` `path` `model` `config` |

### 依赖方向

```
starter → session / document / ai / tool / wechat
ai      → session + document + tool
wechat  → session + document + ai
tool    → document + common
*       → common
```

---

## 3. 微信消息流水线

```
扫码登录 (WechatConnectionManager)
    ↓
轮询收消息 (getUpdates)
    ↓
按类型分发 (WechatMessageDispatcher)
    ↓
入站处理 (WechatInboundHandler)
  · 文本 → AI
  · 图片 → Qwen-VL → AI
  · 语音 → 微信 ASR 文字 → AI
  · 文件 → 解析入库 → AI
    ↓
WechatChatBridge 调 LangGraph
    ↓
WechatOutboundSender 发文字 / MP3 文件 / 生成文档
```

- 多账号：`WechatClientRegistry` 维护多个 `WechatClientHandle`，登录态存于 `wechat-login/`（**本地忽略，绝不入库**）。
- 提醒：`RemindScheduler` 扫描到期提醒，重新投入 AI 图处理内容。

---

## 4. AI 图（ReAct）

```
START → prepare_input → session_prepare → llm_think
                              ↑               │
                              │          needTool?
                              │          ┌────┴────┐
                              └─ tool_execute     END
```

- **WRITE 工具**（邮件 / 提醒 / 生成文档）在进入 `tool_execute` 前会**中断并请用户确认**（`GraphInterruptHandler` + 桌面确认窗）。
- **Skills**：按上一轮调用的工具动态补充 system prompt，控制工具增多后的提示词体积（`SkillManager`）。

---

## 5. 工具（Tools）与 MCP 接入

工具实现集中在 `wechat-ai-tool`，分两类：

- **只读（直接执行）**：`queryWeather` `searchDocument` `getDocumentSummary` `readUrl` `searchInternet` `searchConversation` `translate` `queryStock` `queryOnThisDay` `rollDice` `makeRandomChoice` `getDailyWaifu` 等
- **写入（需确认）**：`setRemind` `sendEmail` `generateDocument`

### MCP 源（4 个，均在 `wechat-ai-tool/.../mcp/impl`）

| MCP 源 | 传输方式 | 鉴权 |
|--------|----------|------|
| `FilesystemMcpSource` | Stdio（`cmd.exe /c node` 本地入口） | 允许目录走 `mcp.filesystem.allowed-dir` 变量 |
| `McdonaldsMcpSource` | HTTP Streamable（Bearer Token） | API Key 走 `mcp.mcdonalds.api-key` 配置变量 |
| `DidiMcpSource` | HTTP Streamable | API Key 走 `mcp.didi.api-key` 配置变量 |
| `LiepinMcpSource` | HTTP Streamable | Credential 走 `mcp.liepin.credential` 配置变量 |

> 所有 MCP 鉴权值**均来自配置变量 / 环境变量，源码中无硬编码**。核心接口（`McpSource` / `McpClientManager` / `McpToolBridge`）在 `mcp/` 包内。

---

## 6. 前端与桌面端（`desktop/`）

- 框架：React + Vite；窗口：主聊天窗 + 确认窗 + 提醒窗（多 HTML 入口）
- 状态：`routeStore.js`；API 封装：`api.js`；Tauri IPC 封装：`popupWindow.js` / `confirmWindow.js` / `remindWindow.js`
- 地图：高德 `amapLoader.js`（Key 走 `VITE_AMAP_KEY` 环境变量，真实值在 `desktop/.env`，**已忽略**）
- Rust 层：`desktop/src-tauri/`（`lib.rs` / `main.rs` / `tauri.conf.json` / `capabilities/default.json` / 图标）；`target/` 与 `gen/schemas/` 已忽略

---

## 7. 环境变量清单（运行时注入）

提交版 `application.properties` 中以 `${ENV}` 引用以下变量（缺失时 Spring 用空默认，相关功能降级）：

| 变量名 | 用途 |
|--------|------|
| `SPRING_DATASOURCE_PASSWORD` | MySQL 密码 |
| `SPRING_DATA_REDIS_PASSWORD` | Redis 密码（可空） |
| `SPRING_MAIL_PASSWORD` | 发件邮箱密码 |
| `WECHAT_AI_LLM_API_KEY` | 大模型 API Key |
| `WECHAT_AI_EMBEDDING_API_KEY` | 向量化 API Key |
| `WECHAT_QDRANT_API_KEY` | Qdrant API Key |
| `TTS_API_KEY` | 语音合成 API Key |
| `QWEN_VL_API_KEY` | 图片识别 API Key |
| `TRANSLATE_API_KEY` | 翻译 API Key |
| `MCP_DIDI_API_KEY` | 滴滴 MCP |
| `MCP_MCDONALDS_API_KEY` | 麦当劳/发票 MCP |
| `MCP_LIEPIN_CREDENTIAL` | 猎聘 MCP |

> 其余配置（`wechat.app-id` / `wechat.app-secret` / `kuaidi100.api-key` / `mcp.filesystem.allowed-dir` 等）可直接在 `application.properties` 中填写，或用 `application-example.properties` 作为填写模板。详见 [`DEPLOY.md`](./DEPLOY.md)。

---

## 8. 本仓库的复现脉络（15 批）

为便于个人长期维护，代码按“由浅入深”分 15 批提交（Conventional Commits）：

1. `chore` 仓库与安全基线（`.gitignore` / `.env.example` / 脱敏 `application.properties`）
2. `feat` 后端脚手架（Maven 聚合 + `common` / `starter`）
3. `feat` 数据库与实体（Flyway `V1~V4.sql` + session/document 领域）
4. `feat` 微信接入基础
5. `feat` 对话核心 API 与消息持久化（SSE）
6. `feat` AI Agent 管线与工具注册
7. `feat` filesystem MCP
8. `feat` 麦当劳/发票 MCP
9. `feat` 滴滴 / 猎聘 MCP
10. `feat` Tauri 2 Rust 层
11. `feat` 前端脚手架与 IPC
12. `feat` 前端 UI 页面
13. `chore` 构建脚本与运行配置
14. `test` 后端/前端 CI 骨架
15. `docs` 本文档与部署文档

---

## 9. 个人维护注意事项

- **密钥红线**：任何真实密钥只在本地 `application.properties` / `desktop/.env` / `wechat-login/` 中，这些均已被 `.gitignore` 忽略，提交历史中绝不出现明文。
- **不提交产物**：`target/`、`.class`、`*.jar`、`node_modules/`、`dist/`、`.vite/`、`desktop/src-tauri/target/`、`gen/schemas/`、日志、登录态一律忽略。
- **数据库**：初始化脚本见 `wechat-ai-session/src/main/resources/db/migration/V1~V4.sql`（Flyway）。
- **扩展工具**：新增 `@Tool` 在 `wechat-ai-tool/impl` 注册；新增 MCP 在 `mcp/impl` 实现 `McpSource` 并登记配置。
- **上游同步**：GitHub `main` 通过快进推送维护，未强推、未继承原公司 remote（本地仅留 `company` 作参考）。
