# 微信智能体助手

> 微信 Bot AI 助手，团队协作开发。  
> **技术栈**: Spring Boot 3.2.5 · JDK 21 · MyBatis · MySQL 8 · Redis · LangChain4j · LangGraph4j · DeepSeek · iLink SDK

单体多模块 Maven 工程，按业务边界拆分，打包为一个 JAR 部署。微信扫码或桌面端邮箱验证码登录后即可对话、调工具、处理文件。

---

## 模块

| 模块 | 说明 |
|------|------|
| `wechat-ai-common` | 统一响应、枚举、常量、工具类 |
| `wechat-ai-session` | 会话 / 消息持久化、提醒任务 |
| `wechat-ai-document` | 文档上传、同步解析、关键词检索 |
| `wechat-ai-tool` | `@Tool` 注册、Skills、读写工具实现 |
| `wechat-ai-ai` | LangGraph 编排、LLM / 多模态 / TTS、图中断 |
| `wechat-ai-wechat` | iLink 接入（登录、收发、分发、出站） |
| `wechat-ai-starter` | 启动入口与全局配置 |

### 依赖关系

```
starter → session / document / ai / tool / wechat
ai      → session + document + tool
wechat  → session + document + ai
tool    → document + common
*       → common
```

---

## 架构概览

### 微信消息流水线

```
扫码登录 (ConnectionManager)
    ↓
轮询收消息 (getUpdates)
    ↓
按类型分发 (Dispatcher)
    ↓
入站处理 (InboundHandler)
  · 文本 → AI
  · 图片 → Qwen-VL → AI
  · 语音 → 微信 ASR 文字 → AI
  · 文件 → 解析入库 → AI
    ↓
ChatBridge 调 LangGraph
    ↓
OutboundSender 发文字 / MP3 文件 / 生成文档
```

### AI 图（ReAct）

```
START → prepare_input → session_prepare → llm_think
                              ↑               │
                              │          needTool?
                              │          ┌────┴────┐
                              └─ tool_execute     END
```

- **WRITE 工具**（邮件 / 提醒 / 生成文档）在进入 `tool_execute` 前会**中断并请用户确认**
- **Skills**：按上一轮调用的工具动态补充 system prompt，控制工具增多后的提示词体积

---

## 已实现功能

### 基础对话

| 功能 | 说明 |
|------|------|
| 文本对话 | DeepSeek + 多轮上下文 |
| 图片识别 | Qwen-VL 多模态描述后进入对话 |
| 语音入站 | iLink `VoiceItem.getText()`（微信侧转写） |
| 语音出站 | CosyVoice TTS，以 MP3 文件发送（`[VOICE]` 标记） |
| 会话记忆 | 进程内缓存 + MySQL `message` 表双写；重启可从库恢复 |

### 文档

| 功能 | 说明 |
|------|------|
| 微信收文件 | 下载 → 同步解析（PDF / Word / TXT）→ 入库 |
| HTTP 上传 | `/api/v1/document/*` |
| 检索 / 摘要 | `searchDocument`、`getDocumentSummary` |
| AI 生文 | `generateDocument` → 本地文件 + 微信发文件（WRITE，需确认） |

### 工具一览

**只读（直接执行）**

| 工具 | 能力 |
|------|------|
| `queryWeather` | 实时天气 |
| `searchDocument` / `getDocumentSummary` | 文档检索与摘要 |
| `readUrl` / `searchInternet` | 读网页 / 联网搜索 |
| `searchConversation` | 搜历史对话 |
| `translate` | 多语言翻译（百度） |
| `queryStock` | A/H/美股行情 |
| `queryOnThisDay` | 历史上的今天 |
| `rollDice` / `makeRandomChoice` / `getDailyWaifu` | 娱乐向 |

**写入（`@WriteTool`，需用户确认）**

| 工具 | 能力 |
|------|------|
| `setRemind` | 定时提醒；到期后再次走 AI 图处理内容 |
| `sendEmail` | QQ SMTP 发邮件 |
| `generateDocument` | 生成 txt/docx 并发送 |

---

## 微信模块结构

| 类 | 职责 |
|----|------|
| `WechatServiceImpl` | 模块入口（组装，不承载业务） |
| `WechatConnectionManager` | 扫码登录 + 轮询 |
| `WechatMessageDispatcher` | 按消息类型分发 |
| `WechatInboundHandler` | 文本 / 图 / 语音 / 文件入站 |
| `WechatChatBridge` | 调图、上下文、用户级线程池、中断确认 |
| `WechatOutboundSender` | 文字 / TTS / 文件出站 |
| `RemindScheduler` | 扫描到期提醒并触发 AI |

---

## 构建与启动

### 环境

| 工具 | 版本 |
|------|------|
| JDK | **21** |
| Maven | 3.9.x |
| MySQL | 8.0 |
| Redis | 7.x（当前非强依赖，可按环境配置） |

### 构建

```bash
./mvnw clean package -DskipTests
```

产物：`wechat-ai-starter/target/wechat-ai-assistant.jar`

### 启动

```bash
cd wechat-ai-starter
mvn spring-boot:run
```

启动后控制台打印二维码链接，**手机微信扫码登录**后自动收发消息。

### 配置

编辑 `wechat-ai-starter/src/main/resources/application.properties`，按环境填写：

| 配置项 | 用途 |
|--------|------|
| `spring.datasource.*` | MySQL |
| `wechat.ai.llm.*` | DeepSeek |
| `qwen-vl.*` | 图片识别 |
| `tts.*` | 语音合成 |
| `translate.*` | 百度翻译 |
| `spring.mail.*` | 发邮件 |
| `wechat.storage.local-path` | 上传文件目录 |
| `tts.storage-path` / `docgen.storage-path` | 语音 / 生成文档目录 |

> 请勿将真实密钥提交到公开仓库；生产环境建议用环境变量或外部配置覆盖。

---

## REST 接口（概览）

| 前缀 | 模块 |
|------|------|
| `/api/v1/chat` | 对话（含桌面 SSE / 图片 / 文档） |
| `/api/v1/session` | 会话 |
| `/api/v1/document` | 文档 |
| `/api/v1/tools` | 工具列表 / 开关 |
| `/api/v1/desktop` | 桌面通知 |
| `/api/v1/mail` | 桌面邮箱验证码登录 |

微信走 iLink；桌面走 `desktop/`（Tauri）+ REST/SSE。邮箱登录详见文档目录 `桌面邮箱登录实现详解.md`。

---

## 使用提示

- 说「查天气 / 翻译 / 搜一下」等 → 自动选只读工具  
- 说「提醒我…」「发邮件…」「生成文档…」→ 先收到确认提示，回复确认后再执行  
- 发图片 / 语音 / 文件 → 自动识别或解析后进入对话  
- 回复需要语音时可让助手带语音标记（出站为 MP3 文件）

---

## 已知边界

- Bot 出站「语音气泡」受 iLink 能力限制，当前以 **MP3 文件** 代替  
- 文档检索为 MySQL 关键词（FULLTEXT + LIKE），非向量语义检索  
- 对话历史为内存缓存 + MySQL；多实例部署需另行设计共享会话  
- README 以当前代码为准；若与注释冲突，以可运行行为为准
