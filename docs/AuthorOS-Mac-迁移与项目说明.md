# AuthorOS 项目说明与 Mac 迁移手册

更新时间: 2026-05-14

这份文档用于把当前 Windows 机器上的 AuthorOS 项目迁移到 Mac,并让新的 Codex/Claude Code 会话能继续接手。它比原始聊天上下文更可靠,因为当前会话里有大量 Windows 绝对路径、OpenClaw 状态和临时隧道进程,直接迁移会话文件很容易失效。

## 1. 项目一句话

AuthorOS 是一个本地优先的 AI 作者系统。它把一本长篇小说当作一个可经营的产品,用 CLI 和 Web 页面完成开书、章节计划、正文生成、反馈预览、确认应用、下载章节等流程。

当前正在新增的方向是:

```text
AuthorOS Private Web Agent
= 本机 Web 页面
+ 私人作者 Agent Controller
+ AuthorOS private 书架
+ 临时 Cloudflare Tunnel 分享给朋友
```

目标不是替换 AuthorOS CLI,而是在外面加一层更适合朋友体验的网页。

## 2. 当前机器上的关键路径

Windows 当前路径:

```text
D:\AI\AuthorOS-v2
D:\Books\authoros-web        # Web 页面专用书架
D:\Books\private-author      # QQ/OpenClaw 机器人旧书架
```

建议迁移到 Mac 后映射为:

```text
~/AI/AuthorOS-v2
~/Books/authoros-web
```

不要依赖 Windows 绝对路径继续运行。文档、README、skill 和历史书架里可能仍出现:

```text
D:\AI\AuthorOS-v2
D:\Books\authoros-web
C:\Users\Administrator\...
```

Mac 上需要统一替换为:

```text
$HOME/AI/AuthorOS-v2
$HOME/Books/authoros-web
```

## 3. 当前仓库状态

仓库:

```text
D:\AI\AuthorOS-v2
```

package 信息:

```json
{
  "name": "authoros",
  "version": "0.3.6",
  "type": "module",
  "engines": { "node": ">=24" },
  "dependencies": { "yaml": "^2.6.0" }
}
```

常用脚本:

```bash
npm test
npm run build
node src/cli.ts --help
node src/cli.ts web --root ~/Books/authoros-web --port 8787
```

当前有未提交改动。迁移时如果只从 GitHub 拉代码,可能拿不到 `author web` 实现。迁移前必须先提交/打包这些文件,或者直接复制整个工作区。

当前未提交/新增内容包括:

```text
M README.md
M skill/authoros/SKILL.md
M src/cli.ts
?? docs/superpowers/plans/
?? src/web/
?? tests/web-agent-llm.test.ts
?? tests/web-agent.test.ts
?? tests/web-downloads.test.ts
?? tests/web-jobs.test.ts
?? tests/web-server.test.ts
```

已提交的设计文档:

```text
docs/superpowers/specs/2026-05-14-private-web-agent-design.md
commit: 3da75bb docs: design private web agent
```

新增但未提交的实现计划:

```text
docs/superpowers/plans/2026-05-14-private-web-agent-plan.md
```

## 4. 当前已实现的 Web 功能

新增模块:

```text
src/web/agent.ts
src/web/agent-llm.ts
src/web/auth.ts
src/web/downloads.ts
src/web/jobs.ts
src/web/server.ts
src/web/public/app.html
```

新增测试:

```text
tests/web-agent.test.ts
tests/web-agent-llm.test.ts
tests/web-downloads.test.ts
tests/web-jobs.test.ts
tests/web-server.test.ts
```

CLI 新增命令:

```bash
author web [--root <dir>] [--port <n>] [--host <host>] [--token <access-code>]
```

本机启动示例:

```bash
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"
export AUTHOROS_WEB_TOKEN="<临时访问码>"
export AUTHOROS_WEB_AGENT="hybrid"
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="..."
export AUTHOROS_MODEL="mimo-v2.5-pro"

cd "$HOME/AI/AuthorOS-v2"
node src/cli.ts web --root "$AUTHOROS_PRIVATE_ROOT" --port 8787
```

打开:

```text
http://127.0.0.1:8787
```

朋友不在同一局域网时:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

然后把 `https://*.trycloudflare.com` 链接和访问码发给朋友。

## 5. Web 架构

数据流:

```text
朋友浏览器
  -> Cloudflare Tunnel 临时 HTTPS 链接
  -> 本机 AuthorOS Web server
  -> Author Agent Controller
  -> AuthorOS private commands
  -> ~/Books/authoros-web
```

核心原则:

- Web 是 AuthorOS 的外壳,不替换 CLI。
- 书籍数据仍然落在 AuthorOS private root 里。
- 页面只做朋友体验:聊天、开书问诊、读章节、反馈、确认应用、下载。
- 第一版不做多用户账户系统。
- 第一版不做永久部署。
- 第一版不依赖 OpenClaw。

## 6. Author Agent Controller

前台 Agent 有三种模式:

```bash
AUTHOROS_WEB_AGENT=rule
AUTHOROS_WEB_AGENT=hybrid
AUTHOROS_WEB_AGENT=llm
```

推荐默认:

```bash
AUTHOROS_WEB_AGENT=hybrid
```

含义:

- `rule`:前台判断完全走本地规则。快、稳、不额外调用模型。
- `hybrid`:明确命令走规则,模糊表达才调用模型。
- `llm`:前台判断尽量交给模型,解析失败会回退规则。

可选单独指定前台模型:

```bash
export AUTHOROS_WEB_AGENT_MODEL="<更快的小模型名>"
```

如果不设置,前台 Agent 复用:

```bash
AUTHOROS_MODEL
```

### 6.1 明确命令走规则

这些不会调用前台模型:

```text
继续写
下一章
读最新章
下载这一章
下载全部章节
确认应用修改
```

### 6.2 模糊表达可走模型

这些适合走模型判断:

```text
这章读起来怪怪的,但我说不上来
我想看一本有点疯但别乱的书
主角不够讨喜,但别变弱
这本书方向是不是太严肃了
```

模型输出必须是结构化 JSON。解析失败会回退规则,不会乱执行。

## 7. Web 页面能力

当前页面:

```text
src/web/public/app.html
```

布局:

- 左侧:聊天区。
- 中间:当前章节阅读区。
- 右侧:书架、刷新、下载按钮、进度日志。

当前功能:

- 输入自然语言。
- 新书请求先问诊,不直接建书。
- 确认后创建 AuthorOS private book。
- 继续写下一章。
- 读取最新章。
- 提反馈时生成修改预览,不直接覆盖。
- 确认应用后才覆盖当前章节。
- 下载当前章节 `.md`。
- 下载全部章节 `.zip`。
- 长任务通过 SSE 显示进度。

## 8. Server API

主要 API:

```text
GET  /api/session
GET  /api/books
GET  /api/status
POST /api/chat
GET  /api/jobs/:id/events
GET  /api/chapters/:chapter
GET  /download/chapter/:chapter
GET  /download/chapters.zip
```

认证:

- 如果设置 `AUTHOROS_WEB_TOKEN`,API 和下载需要 token。
- 浏览器页面会用 `Bearer <token>` 调 API。
- 下载链接会带 `?token=<token>`。

MVP token 只是临时防误入,不是正式账号系统。

## 9. 当前书架数据

Windows 当前 Web 专用书架:

```text
D:\Books\authoros-web
```

迁移目标建议:

```text
~/Books/authoros-web
```

Web 专用书架当前是空书架,用于朋友网页体验,和 QQ 机器人隔离。

QQ/OpenClaw 旧书架仍在:

```text
D:\Books\private-author
```

旧 QQ 书架里的 `bookshelf.json`:

```json
{
  "version": 1,
  "current": "book-7ae75646",
  "books": [
    {
      "id": "book-7ae75646",
      "title": "赛博天庭精神病院",
      "path": "books/book-7ae75646"
    }
  ]
}
```

当前书:

```text
book-7ae75646
赛博天庭精神病院
```

书籍重要文件:

```text
product.md
author.md
outline.md
world.md
characters.yaml
review_rules.md
chapters/0001.md
chapters/0001.draft.md
plans/0001.md
reviews/0001.internal.md
memory/
.authoros/
```

已知问题:

- 早期生成时曾出现 `outline.md` 主角是“沈无明”,但 `characters.yaml` 主角是“赛博修士·零”的不一致。
- 后续应先用 AuthorOS console 或 Web Agent 校准书籍方向,再继续写。
- 当前书方向应该是“赛博修仙 + 天庭遗留协议 + 精神病院 + 癫但有逻辑 + 可带喜剧/黑色幽默”。

## 10. Mac 迁移步骤

### 10.1 复制代码

方式 A:如果已经提交并推到 GitHub:

```bash
mkdir -p ~/AI
cd ~/AI
git clone <repo-url> AuthorOS-v2
cd AuthorOS-v2
npm install
```

方式 B:如果还没提交 Web 实现,直接复制整个目录:

```text
Windows: D:\AI\AuthorOS-v2
Mac:     ~/AI/AuthorOS-v2
```

推荐迁移前先在 Windows 提交 Web 实现,再在 Mac 用 Git 拉取。否则很容易漏掉未跟踪文件:

```text
src/web/
tests/web-*.test.ts
docs/superpowers/plans/
```

### 10.2 复制书架

复制:

```text
Windows: D:\Books\authoros-web
Mac:     ~/Books/authoros-web
```

注意:

- Web 专用书架当前和 QQ/OpenClaw 书架分开。不要把 `D:\Books\private-author` 当作 Web 默认 root。
- `.openclaw/`、`skills/`、`AGENTS.md` 等 OpenClaw 工作区文件可以保留,但 Web 模式不依赖它们。
- 书籍核心数据在 `books/` 和 `bookshelf.json`。
- Mac 上路径分隔符不同,但 `bookshelf.json` 内部使用相对路径 `books/book-...`,这部分可以直接迁。

### 10.3 安装 Node

AuthorOS 要求 Node >= 24。

Mac 上可以用:

```bash
node -v
npm -v
```

如果 Node 版本不足,用 nvm 或 fnm 安装 Node 24。

### 10.4 安装依赖

```bash
cd ~/AI/AuthorOS-v2
npm install
```

### 10.5 配置环境变量

不要把 API key 写进仓库。

临时 shell:

```bash
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://token-plan-sgp.xiaomimimo.com/v1"
export AUTHOROS_MODEL="mimo-v2.5-pro"
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"
export AUTHOROS_WEB_TOKEN="<临时访问码>"
export AUTHOROS_WEB_AGENT="hybrid"
```

持久化可写入 `~/.zshrc`:

```bash
cat >> ~/.zshrc <<'EOF'
export OPENAI_BASE_URL="https://token-plan-sgp.xiaomimimo.com/v1"
export AUTHOROS_MODEL="mimo-v2.5-pro"
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"
export AUTHOROS_WEB_AGENT="hybrid"
EOF
```

API key 建议通过更安全的方式设置,不要明文提交。

### 10.6 验证 CLI

```bash
cd ~/AI/AuthorOS-v2
node src/cli.ts --help
node src/cli.ts private list --root "$AUTHOROS_PRIVATE_ROOT"
```

### 10.7 跑测试

```bash
npm test
npm run build
```

Windows 当前最后验证结果:

```text
npm.cmd test      -> 209 passed
npm.cmd run build -> Build complete: dist/ ready.
```

Mac 上如果因为平台差异有测试失败,优先看路径分隔符、Windows 专用路径、端口占用和 Node 版本。

### 10.8 启动 Web

```bash
cd ~/AI/AuthorOS-v2
node src/cli.ts web --root "$AUTHOROS_PRIVATE_ROOT" --port 8787
```

本机打开:

```text
http://127.0.0.1:8787
```

### 10.9 临时公网分享

安装 Cloudflare Tunnel:

```bash
brew install cloudflared
```

启动 tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

把输出里的:

```text
https://*.trycloudflare.com
```

和访问码发给朋友。

## 11. 不建议迁移的东西

### 11.1 不建议迁 Codex 当前会话文件

Codex session 目录:

```text
C:\Users\Administrator\.codex\sessions
```

今天看到的 rollout 文件:

```text
C:\Users\Administrator\.codex\sessions\2026\05\14\rollout-2026-05-14T09-01-09-019e2400-7338-71e1-941d-311405640933.jsonl
```

但用 `AuthorOS Private Web`、`cloudflared`、`AUTHOROS_WEB_AGENT` 等关键词没有命中当前 Web 开发内容。说明当前上下文不适合靠这个文件迁移。

### 11.2 不建议迁 OpenClaw 状态当作主路径

OpenClaw session 示例:

```text
C:\Users\Administrator\.openclaw\agents\private-author\sessions\e7089f23-9e2a-4bd0-9e64-746e7ae6b9d3.jsonl
C:\Users\Administrator\.openclaw\agents\private-author\sessions\e7089f23-9e2a-4bd0-9e64-746e7ae6b9d3.trajectory.jsonl
```

这些是 OpenClaw agent 运行轨迹,不是 AuthorOS 项目的核心数据。迁 Mac 的主线应是:

```text
AuthorOS repo + private-author bookshelf
```

OpenClaw 可以后续再单独配置,但 Web 模式不依赖 OpenClaw。

## 12. 当前临时公网状态

Windows 当前曾启动过 Cloudflare quick tunnel:

```text
https://identified-transactions-crawford-fine.trycloudflare.com
```

访问码:

```text
<临时访问码>
```

注意:

- 这是临时 quick tunnel,重启后链接可能变化。
- Windows 本机用该公网链接可能因为本地代理/TLS 握手失败打不开。
- 外网能打开则说明 tunnel 是通的。
- 本机访问应优先用:

```text
http://127.0.0.1:8787
```

## 13. 已知风险与待办

### 13.1 当前 Web 实现还未提交

迁移前最好提交:

```bash
git add README.md src/cli.ts src/web tests/web-*.test.ts docs/superpowers/plans/2026-05-14-private-web-agent-plan.md
git commit -m "feat: add private web agent"
```

`skill/authoros/SKILL.md` 是另一组 OpenClaw/skill 文档改动,可以单独提交:

```bash
git add skill/authoros/SKILL.md
git commit -m "docs: update authoros skill for private mode"
```

不要把 API key、访问码、`.env`、本机 tunnel 日志提交。

### 13.2 Web 下载功能是 MVP

当前支持:

- 当前章节 `.md`。
- 全部章节 `.zip`。

后续可以加:

- 整本资料包。
- EPUB。
- TXT 合集。
- PDF。

### 13.3 多用户隔离未做

现在是单人私人书架:

```text
~/Books/authoros-web
```

如果多个朋友同时用,会共用 current book 和 pending feedback。后续应做:

```text
~/Books/authoros-web/users/<user-id>
```

或者 Web 层加简单 session/user namespace。

### 13.4 模型 Agent 仍需控制

`AUTHOROS_WEB_AGENT=hybrid` 是推荐默认。

不要默认 `llm` 全权执行,否则模型误判会增加。当前实现有 JSON 白名单和 fallback,但产品上仍应保持:

- 新书先问诊。
- 创建前确认。
- 反馈先预览。
- 应用前确认。
- 不自动删除书。

### 13.5 页面 UI 还很朴素

当前页面是原生 HTML/CSS/JS,没有 React/Vite。优点是依赖少、迁移容易。后续如果要更好体验,可以再升级前端。

## 14. 给新 Codex 会话的接手提示词

在 Mac 新开 Codex 后,可以直接贴这段:

```text
你现在接手 AuthorOS。请先阅读 ~/AI/AuthorOS-v2/docs/AuthorOS-Mac-迁移与项目说明.md。

当前目标是继续完善 AuthorOS Private Web Agent:
- 仓库: ~/AI/AuthorOS-v2
- 私人书架: ~/Books/authoros-web
- Node >= 24
- Web 命令: node src/cli.ts web --root ~/Books/authoros-web --port 8787
- 推荐环境: AUTHOROS_WEB_AGENT=hybrid

先执行:
git status --short
npm test
npm run build

不要重写 AuthorOS 核心 CLI。Web 层是外壳,核心书籍数据仍在 AuthorOS private root。优先保持:开书问诊、确认后建书、反馈预览不覆盖、确认后应用、章节下载。
```

## 15. 快速命令清单

Windows 当前:

```powershell
cd D:\AI\AuthorOS-v2
npm.cmd test
npm.cmd run build
node D:\AI\AuthorOS-v2\src\cli.ts web --root D:\Books\authoros-web --port 8787
cloudflared tunnel --url http://127.0.0.1:8787
```

Mac 目标:

```bash
cd ~/AI/AuthorOS-v2
npm test
npm run build
node src/cli.ts web --root ~/Books/authoros-web --port 8787
cloudflared tunnel --url http://127.0.0.1:8787
```

环境变量:

```bash
export OPENAI_API_KEY="..."
export OPENAI_BASE_URL="https://token-plan-sgp.xiaomimimo.com/v1"
export AUTHOROS_MODEL="mimo-v2.5-pro"
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"
export AUTHOROS_WEB_TOKEN="<临时访问码>"
export AUTHOROS_WEB_AGENT="hybrid"
```
