# 部署与运行（DEPLOY）

> 面向本仓库的本地开发与部署。最低可用只需后端 + MySQL；桌面端为可选增强。

---

## 1. 前置依赖

| 工具 | 版本 | 说明 |
|------|------|------|
| JDK | **21** | 后端运行/编译 |
| Maven | 3.9.x（已带 `mvnw`） | 构建 |
| MySQL | 8.0 | 业务库 |
| Redis | 7.x | 当前非强依赖，可按环境配置 |
| Node | 20.x | 前端（`desktop/`） |
| Rust + Tauri 2 预研环境 | 最新 | 仅桌面端打包时需要 |

---

## 2. 获取与配置密钥

本仓库**不提交任何真实密钥**。两种本地填值方式任选其一：

### 方式 A：环境变量（推荐，最干净）

提交版 `application.properties` 中以 `${ENV}` 引用变量（见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 第 7 节 12 个变量名）。在运行前于 shell 中导出：

```bash
export SPRING_DATASOURCE_PASSWORD='***'
export WECHAT_AI_LLM_API_KEY='***'
export TTS_API_KEY='***'
# …其余按需
```

### 方式 B：复制模板填写

```bash
cp wechat-ai-starter/src/main/resources/application-example.properties \
   wechat-ai-starter/src/main/resources/application.properties
# 编辑 application.properties，把 YOUR_* 占位替换为真实值
```

> 注意：提交版 `application.properties` 用的是 `${ENV}` 名（如 `SPRING_DATASOURCE_PASSWORD`）；
> 模板文件用的是 `YOUR_*` 占位。若用方式 B，请直接在原 `${ENV}` 处填入真实值，或保留 `${ENV}` 并走方式 A。

前端密钥单独在 `desktop/.env`（已忽略）中：

```bash
# desktop/.env
VITE_AMAP_KEY=你的高德Key
```

可参考已提交的 `desktop/.env.example`。

---

## 3. 数据库初始化

业务表由 Flyway 迁移脚本自动建表，位于：

```
wechat-ai-session/src/main/resources/db/migration/V1__multi_account.sql
wechat-ai-session/src/main/resources/db/migration/V2__recurring_reminder.sql
wechat-ai-session/src/main/resources/db/migration/V3__remind_channel.sql
wechat-ai-session/src/main/resources/db/migration/V4__app_user.sql
```

只需先手动建库，启动后端时 Flyway 会自动执行：

```sql
CREATE DATABASE wechat_ai DEFAULT CHARACTER SET utf8mb4;
```

---

## 4. 后端运行

```bash
# 构建
./mvnw clean package -DskipTests
# 产物：wechat-ai-starter/target/wechat-ai-assistant.jar

# 运行（开发）
cd wechat-ai-starter
mvn spring-boot:run
```

启动后控制台打印二维码链接，**手机微信扫码登录**后自动收发消息（iLink 通道）。
桌面端走 `desktop/` + REST/SSE。

---

## 5. 前端 / 桌面端运行

```bash
cd desktop
npm install
npm run dev        # Vite 开发模式
# 或打包为桌面应用（需 Rust + Tauri 2 环境）
npm run tauri dev  # 开发态桌面端
npm run tauri build  # 产出安装包
```

> 真实高德 Key 放 `desktop/.env`（`VITE_AMAP_KEY`），不要提交。

---

## 6. MCP 接入配置

4 个 MCP 源默认由配置开关启用，鉴权值走变量：

| 源 | 配置项（在 application.properties） |
|----|------|
| Filesystem | `mcp.filesystem.allowed-dir`（允许访问的本地目录，务必收紧） |
| 麦当劳/发票 | `mcp.mcdonalds.api-key` |
| 滴滴 | `mcp.didi.api-key` |
| 猎聘 | `mcp.liepin.credential` |

filesystem MCP 在 Windows 下以 `cmd.exe /c node` 作为 Stdio 本地入口，目录通过变量控制，无硬编码绝对路径。

---

## 7. CI（可选）

`.github/workflows/ci.yml` 提供最小 CI：push/PR 到 `main` 时编译后端（Maven）与构建前端（npm）。
其中仅通过 `secrets.*` 引用密钥，仓库内**无任何明文**。

如需开启 Tauri 桌面构建，在 CI 中新增 `tauri-build` job（安装 Rust + 原生依赖 +
签名 `secrets`，参见 `ci.yml` 注释）。

---

## 8. 密钥与产物红线（务必遵守）

- 不提交：`.env`、`.env.*`、`application-prod.*`、`*.p12`/`*.jks`/`*.pem`/`*.key`、`wechat-login/`、
  `log.md`、`发票test.pdf`、`target/`、`.class`、`*.jar`、`node_modules/`、`dist/`、`.vite/`、
  `desktop/src-tauri/target/`、`gen/schemas/`、`.workbuddy/`。
- 登录态、聊天记录、真实发票/日志一律不入库。
- 推送一律快进，禁止 `--force`。
