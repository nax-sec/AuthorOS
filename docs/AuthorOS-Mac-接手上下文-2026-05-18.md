# AuthorOS Mac 接手上下文

更新日期: 2026-05-18  
当前源机器: Windows, `D:\AI\AuthorOS-v2`  
GitHub: https://github.com/nax-sec/AuthorOS

这份文档用于在新的 Mac / Codex / Claude Code 会话里快速接手 AuthorOS 项目。它记录的是当前真实项目状态、最近决策、运行方式、房间隔离、接待 agent、数据迁移点和下一步建议。

---

## 1. 项目一句话

AuthorOS 是一个本地优先的 AI 作者系统。它不是单纯的“提示词生成小说”,而是把一本长篇小说当作一个持续经营的产品:

- 开书前生成作品定位、世界观、人物、大纲、评审规则。
- 每章走 `plan -> write -> review -> revise -> decide -> memory` 的闭环。
- 支持读者反馈,但反馈先生成修改预览,确认后才覆盖正文。
- 支持私人 Web 页面,让朋友像和“私人 AI 作者”聊天一样开书、续写、反馈、读章节、下载章节。

当前产品方向:

```text
AuthorOS CLI core
  + private bookshelf mode
  + private web agent
  + 5-room temporary friend demo
  + receptionist agent first, rules only as fallback
```

---

## 2. 当前仓库状态

本地仓库:

```text
D:\AI\AuthorOS-v2
```

远端仓库:

```text
https://github.com/nax-sec/AuthorOS
```

当前分支:

```text
main
```

当前状态:

```text
main...origin/main
working tree clean
```

包信息:

```json
{
  "name": "authoros",
  "version": "0.3.6",
  "type": "module",
  "engines": { "node": ">=24" },
  "dependencies": { "yaml": "^2.6.0" }
}
```

常用验证:

```bash
npm test
npm run build
```

最近关键提交:

```text
f7800c2 fix: route hybrid web chat through receptionist first
b4c6118 feat: use receptionist agent for private web chat
e485115 feat: add room-isolated private web access
f5bb9ac docs: make english readme primary
dc4cee1 docs: add english readme for showcase
856364c docs: add openai showcase submission draft
b42f323 docs: update authoros skill for private mode
50b0ff4 feat: add private web agent
3da75bb docs: design private web agent
04cf5b2 feat: add private author bookshelf mode
```

---

## 3. Mac 上第一步

推荐路径:

```bash
mkdir -p ~/AI
cd ~/AI
git clone https://github.com/nax-sec/AuthorOS.git AuthorOS-v2
cd AuthorOS-v2
npm install
npm test
npm run build
```

要求:

```text
Node.js >= 24
npm
可用的 OpenAI-compatible API key/base_url/model
```

如果没有 Node 24:

```bash
node -v
```

低于 24 时先安装新版 Node。项目开发态依赖 Node 24 的 native TypeScript type stripping,可以直接运行 `node src/cli.ts ...`。

---

## 4. 模型配置

AuthorOS 不保存 API key 值,只读环境变量。

Mac 推荐:

```bash
export OPENAI_API_KEY="<key>"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export AUTHOROS_MODEL="<model>"
```

当前 Windows 实战曾用过小米 MiMo OpenAI-compatible endpoint。Mac 上可以继续用 OpenAI-compatible provider,也可以切到 OpenAI 官方:

```bash
export OPENAI_BASE_URL="https://api.openai.com/v1"
export AUTHOROS_MODEL="<OpenAI model name>"
```

Web 前台接待 agent 默认复用 `AUTHOROS_MODEL`。如果要给接待 agent 单独用一个更快/更便宜模型:

```bash
export AUTHOROS_WEB_AGENT_MODEL="<smaller-model>"
```

不要把 key 写进 README、docs、Git commit 或聊天记录。

---

## 5. 代码与数据的区别

GitHub 只包含代码、模板、测试和文档。书架数据不在仓库里。

Windows 当前 Web 书架:

```text
D:\Books\authoros-web
```

旧 QQ/OpenClaw 书架:

```text
D:\Books\private-author
```

Mac 推荐 Web 书架:

```bash
~/Books/authoros-web
```

如果要把当前朋友体验房间里的书也带到 Mac,需要额外复制:

```text
D:\Books\authoros-web
```

到:

```text
~/Books/authoros-web
```

迁移时保留目录结构,尤其是:

```text
rooms/
bookshelf.json
books/<book-id>/
```

---

## 6. Private Web 当前设计

Web 入口命令:

```bash
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"
export AUTHOROS_WEB_AGENT="hybrid"
export AUTHOROS_WEB_ROOMS="1,2,3,4,999"

node src/cli.ts web --root "$AUTHOROS_PRIVATE_ROOT" --port 8787
```

本机打开:

```text
http://127.0.0.1:8787
```

临时外网分享:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

注意: `trycloudflare.com` quick tunnel 不保证固定域名。断线或重启后会生成新链接。

Windows 当前最近一次可用临时链接是:

```text
https://pics-seniors-gossip-assessments.trycloudflare.com
```

这个链接是临时状态,迁到 Mac 后不要假设仍可用。

---

## 7. 5 个房间

当前临时体验不是完整多用户系统,而是 5 个固定房间。入口 URL 可以一样,用户输入不同访问码后进入不同 URL 房间。

访问码:

```text
1
2
3
4
999
```

映射:

```text
1   -> /room/room1
2   -> /room/room2
3   -> /room/room3
4   -> /room/room4
999 -> /room/room999
```

对应本地 root:

```text
~/Books/authoros-web/rooms/room1
~/Books/authoros-web/rooms/room2
~/Books/authoros-web/rooms/room3
~/Books/authoros-web/rooms/room4
~/Books/authoros-web/rooms/room999
```

原则:

- 页面不提供手动切房间。
- 访问码只对应一个房间。
- 错误访问码不能访问其他房间 API。
- 每个房间独立书架、当前书、章节、反馈预览、下载内容和 job 进度。

实现位置:

```text
src/web/server.ts
src/web/public/app.html
tests/web-server.test.ts
```

---

## 8. Receptionist Agent 当前行为

现在 Web 前台不是规则优先,而是:

```text
AUTHOROS_WEB_AGENT=rule
  -> 只走旧规则

AUTHOROS_WEB_AGENT=hybrid
  -> 先走 receptionist agent
  -> agent 出错 / 不可用 / JSON 解析失败
  -> fallback 到规则

AUTHOROS_WEB_AGENT=llm
  -> 尽量走 receptionist agent
  -> 失败 fallback 到规则
```

关键修复:

```text
f7800c2 fix: route hybrid web chat through receptionist first
```

这次修复的原因:

- 之前 `agent-llm.ts` 已经改成 agent 优先。
- 但 `server.ts` 的 `resolveAgentMessage` 还在 hybrid 模式里先跑规则。
- 所以网页请求仍会被规则短路。
- 当前已修复,并加了 server 层回归测试。

白名单动作:

```text
new_book_intake
new_book_confirmed
create_book_and_continue
continue_book
read_chapter
feedback_preview
feedback_apply
download_current_chapter
download_all_chapters
status
unknown
```

新增关键动作:

```text
create_book_and_continue
```

含义:

```text
建书
-> 自动规划第 1 章
-> 自动写第 1 章
-> 完成后返回章节信息
```

这样避免朋友说“你决定,直接写”后只建书不写正文,造成“终止/卡住”的糟糕体验。

实现位置:

```text
src/web/agent-llm.ts
src/web/agent.ts
src/web/server.ts
tests/web-agent-llm.test.ts
tests/web-server.test.ts
```

---

## 9. Web 模块结构

```text
src/web/
  agent.ts          # 规则 agent / fallback / command type
  agent-llm.ts      # receptionist agent JSON protocol
  auth.ts           # token 校验
  downloads.ts      # chapter markdown / zip downloads
  jobs.ts           # in-memory job store + events
  server.ts         # HTTP routes, rooms, SSE, command jobs
  public/app.html   # 单文件前端 UI
```

当前 Web API:

```text
GET  /
GET  /api/session
POST /api/login
GET  /room/:roomId
GET  /room/:roomId/api/books
GET  /room/:roomId/api/status
POST /room/:roomId/api/chat
GET  /room/:roomId/api/jobs/:jobId/events
GET  /room/:roomId/api/chapters/:chapter
GET  /room/:roomId/download/chapter/:chapter
GET  /room/:roomId/download/chapters.zip
```

旧单人模式仍保留:

- 不设置 `AUTHOROS_WEB_ROOMS` 时使用单 root。
- 可用 `AUTHOROS_WEB_TOKEN` 做单入口访问码。

---

## 10. Private Bookshelf CLI

不走 Web 时,可用 CLI 操作私人书架:

```bash
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"

node src/cli.ts private new --title "Cyber HK" --concept "A cyberpunk detective story" --root "$AUTHOROS_PRIVATE_ROOT"
node src/cli.ts private list --root "$AUTHOROS_PRIVATE_ROOT"
node src/cli.ts private switch --book <book-id> --root "$AUTHOROS_PRIVATE_ROOT"
node src/cli.ts private continue --root "$AUTHOROS_PRIVATE_ROOT"
node src/cli.ts private read --chapter latest --root "$AUTHOROS_PRIVATE_ROOT"
node src/cli.ts private feedback --chapter latest --text "Make this chapter more tense" --root "$AUTHOROS_PRIVATE_ROOT"
node src/cli.ts private apply --root "$AUTHOROS_PRIVATE_ROOT"
```

反馈规则:

- `feedback` 只生成 pending preview。
- `apply` 才真正覆盖章节。
- 章节原稿会保留 draft 备份。

---

## 11. 常规 AuthorOS CLI Loop

单本书内部完整流程:

```bash
cd <book-dir>

node ~/AI/AuthorOS-v2/src/cli.ts model doctor
node ~/AI/AuthorOS-v2/src/cli.ts model smoke

node ~/AI/AuthorOS-v2/src/cli.ts plan --chapter 1 --model --write
node ~/AI/AuthorOS-v2/src/cli.ts write --chapter 1 --model --write
node ~/AI/AuthorOS-v2/src/cli.ts review --chapter 1 --mode all --model --write
node ~/AI/AuthorOS-v2/src/cli.ts revise --chapter 1 --model --write
node ~/AI/AuthorOS-v2/src/cli.ts decide --chapter 1 --model --write
node ~/AI/AuthorOS-v2/src/cli.ts memory update --chapter 1 --model --write
```

检查状态:

```bash
node ~/AI/AuthorOS-v2/src/cli.ts state
```

---

## 12. 测试状态

最近一次完整验证结果:

```text
npm.cmd test
215/215 passed

npm.cmd run build
Build complete: dist/ ready.
```

Mac 上应运行:

```bash
npm test
npm run build
```

Web 相关测试:

```text
tests/web-agent.test.ts
tests/web-agent-llm.test.ts
tests/web-downloads.test.ts
tests/web-jobs.test.ts
tests/web-server.test.ts
```

重要回归:

- hybrid server chat 必须先调用 receptionist agent。
- receptionist agent 出错时必须 fallback 到规则。
- `create_book_and_continue` 必须生成 job。
- 5 个 room 必须 root/token 隔离。

---

## 13. OpenAI Showcase

项目已经提交过 OpenAI Showcase Gallery。

提交材料:

```text
docs/SHOWCASE.md
docs/assets/showcase-cover.svg
```

GitHub README 现在默认英文主页:

```text
README.md      # English primary
README.zh.md   # Chinese version
```

当时提交信息:

```text
First name: Liang
Last name: Zee
Email: naxx5549@gmail.com
Author display name: ty126
GitHub: https://github.com/nax-sec/AuthorOS
```

官方提示: 每周 review,如果被选中会邮件通知,不提供逐个反馈。

---

## 14. 当前已知问题 / 风险

### 14.1 quick tunnel 不稳定

`trycloudflare.com` quick tunnel 可能随时断,旧链接可能失效。

短期处理:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

长期建议:

- Cloudflare named tunnel
- 或 VPS 上部署
- 或一个简单 HTTPS 反代

### 14.2 页面 UI 还是 MVP

当前 `src/web/public/app.html` 是单文件 HTML,可以用但不精致。缺点:

- 进度反馈还偏原始。
- job 完成后的“下一步建议”不够强。
- 章节刷新/自动显示体验还可以继续优化。
- 没有真正的登录账号系统。

### 14.3 接待 agent prompt 还需要继续磨

当前已做到 agent 优先,但 prompt 仍可优化:

- 更像“作者助理”,少像命令分类器。
- 在用户表达模糊时主动补足方向,但不要胡乱开书。
- 建书完成后用更自然的话告诉用户“我正在写第 1 章”。
- 长任务中要持续解释当前阶段。

### 14.4 房间不是正式多用户

5 房间只是临时体验隔离,不是账号系统:

- 没有用户注册。
- 没有密码重置。
- 没有审计日志。
- 没有多人权限管理。
- 房间访问码不要当长期安全方案。

---

## 15. 建议下一步

### 优先级 A: 提升朋友体验

1. Web job 完成后自动读取并显示最新章节。
2. `create_book_and_continue` 完成后回复更明确:
   - 书已建好。
   - 第 1 章已写好。
   - 可以读 / 反馈 / 继续写。
3. 失败时展示可读原因:
   - 模型超时
   - finish_reason length
   - 网络错误
   - key/base_url/model 配置问题
4. 页面增加“当前正在做什么”的固定状态区。

### 优先级 B: 稳定外网访问

1. 不再依赖 quick tunnel。
2. 做 Cloudflare named tunnel 或 VPS。
3. 给 5 个房间保留固定入口。

### 优先级 C: Receptionist agent 继续产品化

1. 抽出独立 prompt 文件或 agent profile。
2. 加更完整的 JSON schema。
3. 给每个房间持久化接待上下文。
4. 让 agent 在不泄露内部实现的情况下解释进度。

### 优先级 D: 正式多用户

如果朋友体验稳定后再做:

- 用户账号
- 每用户书架
- 邀请码
- 权限
- 数据导出
- 后台管理

---

## 16. Mac 会话接手提示词

新的 Codex / Claude Code 会话可以直接贴:

```text
你接手 AuthorOS 项目。请先阅读 docs/AuthorOS-Mac-接手上下文-2026-05-18.md、README.md、README.zh.md、src/web/server.ts、src/web/agent-llm.ts、tests/web-server.test.ts、tests/web-agent-llm.test.ts。

当前方向: 本地优先 AI 作者系统 + 私人 Web 书架 + 5 个房间隔离 + receptionist agent 优先。不要把 Web 改成完整 SaaS,先优化朋友体验。

重要约束:
- 不要把 API key 写入仓库。
- 不要破坏 CLI 核心闭环。
- 不要把 reader feedback 自动应用到正文,必须 preview -> approve -> apply。
- hybrid web chat 必须先走 receptionist agent,失败才 fallback 规则。
- 设置 AUTHOROS_WEB_ROOMS="1,2,3,4,999" 时,不同访问码必须隔离到不同 room root。

开始前先运行:
npm test
npm run build
```

---

## 17. 当前最短启动命令

Mac 本地:

```bash
cd ~/AI/AuthorOS-v2

export OPENAI_API_KEY="<key>"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export AUTHOROS_MODEL="<model>"
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"
export AUTHOROS_WEB_AGENT="hybrid"
export AUTHOROS_WEB_ROOMS="1,2,3,4,999"

node src/cli.ts web --root "$AUTHOROS_PRIVATE_ROOT" --port 8787
```

另一个终端开临时外网:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

发给朋友:

```text
链接: <cloudflared 输出的 https://*.trycloudflare.com>
访问码: 1 / 2 / 3 / 4 / 999
```

