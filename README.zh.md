# AuthorOS

English: [README.md](README.md)

本地优先的 AI 作者 CLI。AuthorOS 把一本长篇小说当作一个可经营的产品,用 agent 闭环完成计划、写作、评审、修订、决策、记忆更新和作者级形状调整。

License: MIT · Node.js >= 24 · 运行时仅 `yaml` 一个 npm 依赖

---

## 1. 系统要求

v0.3 引入了"作者层":首次使用前先运行 `author author init`,让 AuthorOS 建立作者级 profile、preferences、templates 和 agent 默认配置。之后每本书都可以从作者层继承这些资产。

- Node.js **24** 或更新
- 任何能跑 `node` 的 shell(PowerShell / bash 都行)
- 一个 OpenAI 兼容的 API key + base_url + 模型名

运行时仅 `yaml` 一个 npm 依赖,用于 console structured edits 解析。dev 模式用 Node 24 native TypeScript type stripping 直接跑 `src/*.ts`;发布时 `npm pack` 会通过 prepack 脚本编译到 `dist/`。

### Windows PowerShell 注意

默认 ExecutionPolicy(`Restricted`)会拦截 `npm.ps1` 和 npm 装出来的 `author.ps1`。可以直接用 `.cmd` shim:

```powershell
npm.cmd install -g .\authoros-0.3.0.tgz
author.cmd --help
```

---

## 2. 安装

### 方式 A: npm pack

```powershell
npm install -g .\authoros-0.3.0.tgz
author --help
```

### 方式 B: 解压 + npm link

```powershell
cd authoros-v2
npm link
author --help
```

### 方式 C: 不安装,直接跑

```powershell
cd authoros-v2
node src\cli.ts --help
```

### 本机临时 Web 页面

`author web` 会启动一个本机私人作者页面,适合临时分享给朋友体验。页面提供聊天入口、开书问诊、进度提示、章节阅读、反馈预览/应用和章节下载。

```powershell
$env:AUTHOROS_PRIVATE_ROOT="D:\Books\authoros-web"
$env:AUTHOROS_WEB_TOKEN="临时访问码"
author web --root D:\Books\authoros-web --port 8787
```

如果要临时开 5 个隔离房间,用访问码决定房间:

```powershell
$env:AUTHOROS_WEB_ROOMS="1,2,3,4,999"
author web --root D:\Books\authoros-web --port 8787
```

公网入口链接不变。访问者输入 `1`、`2`、`3`、`4` 或 `999` 后,会分别进入 `/room/room1`、`/room/room2`、`/room/room3`、`/room/room4`、`/room/room999`。每个房间的书架独立保存在 `D:\Books\authoros-web\rooms\<room-id>`。

本机打开:

```text
http://127.0.0.1:8787
```

不在同一局域网时,可用 Cloudflare Tunnel 暴露临时 HTTPS 链接:

```powershell
cloudflared tunnel --url http://127.0.0.1:8787
```

把临时链接和访问码发给朋友。MVP 访问码只用于临时防误入,不要把公网链接长期公开。

Web 页面内置一个轻量 Author Agent Controller。默认 `rule`:前台接待、开书问诊、确认和常用命令都走本地规则 agent,不会调用模型做意图判断。可选:

- `AUTHOROS_WEB_AGENT=rule`:默认值,完全不调用模型做前台判断,只在写书/修书时调用模型。
- `AUTHOROS_WEB_AGENT=hybrid`:规则优先,规则不确定时调用模型,适合实验。
- `AUTHOROS_WEB_AGENT=llm`:前台判断也尽量交给模型,解析失败会回退规则。

前台 agent 默认复用 `AUTHOROS_MODEL`;如需单独指定更快的小模型,可设置 `AUTHOROS_WEB_AGENT_MODEL`。

### 可选: 安装 Claude Code skill

```powershell
author skill install
author skill install --force
author skill install --dir <root>
```

---

## 2.5. 三层身份模型

AuthorOS v0.3 有三层身份:

- **作者层**:默认在 `~/.authoros`,也可用 `AUTHOROS_AUTHOR_DIR` 或 `--author-dir` 指定。保存作者级 `author.md`、`style.md`、preferences、agent profiles、templates 和 changes 历史。
- **书层**:每本书自己的 `product.md`、`author.md`、`world.md`、`outline.md`、`characters.yaml`、`review_rules.md`、memory 和 `.authoros/config.yaml`。
- **运行层**:章节计划、正文、评审、决策、反馈分析、memory delta、console change 记录。

继承方向是作者层 -> 书层 -> 运行层。书层可以覆盖作者层,但不会自动反写作者层;需要长期复用的变化通过 `author console --scope author` 或 template promote 进入作者层。

---

## 3. 配置模型

模型 key 不存盘,只存环境变量名。

```powershell
$env:OPENAI_API_KEY="<你的 key>"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:AUTHOROS_MODEL="gpt-4o"
```

项目级覆盖:

```powershell
cd <book 目录>
author model config set --base-url https://... --model <name>
author model config set --api-key-env OPENAI_API_KEY
author model doctor
author model smoke
```

---

## 4. 起一本书

首次使用:

```powershell
author author init
```

指定作者目录:

```powershell
author author init --author-dir D:\AI\author-home
author init "我的小说" --quick --author-dir D:\AI\author-home
```

`author init` 必须选择一个模式:

```powershell
author init "我的小说" --concept "都市异能,主角是数据分析师,能力是回溯历史信息"
author init "我的小说" --guided
author init "我的小说" --quick
```

常用选项:

- `--template <key>`:选择参考模板,默认 `urban_power_anomaly`。
- `--dir <path>`:指定书目录。
- `--force`:允许写入非空目录。
- `--strategy-confirm`:concept/guided 模式下打印 Strategy Pass 决策并等待确认。
- `--no-distill`:跳过建书后的候选 template 提炼。
- `--author-dir <path>`:使用指定作者层目录。

支持 12 个 seed templates:

`urban_power_anomaly`, `xianxia`, `western_fantasy`, `mystery_thriller`, `sci_fi`, `rules_horror`, `wuxia`, `dog_blood_romance`, `system_literature`, `apocalypse`, `period_drama`, `campus_realism`。

模板是结构参考。concept/guided 模式下,模型只用 schema 和 strategy 决策,不复制模板正文;`--quick` 才保留模板默认内容。

---

## 5. 跑通第一章

```powershell
cd <book 目录>

author model doctor
author model smoke

author plan --chapter 1 --model --write --dir <book-dir>
author write --chapter 1 --model --write --dir <book-dir>
author review --chapter 1 --mode all --model --write --dir <book-dir>
author revise --chapter 1 --model --write
author decide --chapter 1 --model --write
author memory update --chapter 1 --model --write

author state
```

真实反馈线:

```powershell
author feedback import --chapter 1 path\to\feedback.txt
author feedback analyze --chapter 1 --model --write
author decide --chapter 1 --model --write
```

真实反馈不存在时,`reader_feedback` 的 20% 不重分配给其它来源。

---

## 6. 命令速查

```powershell
author author init | show | doctor | edit-profile

author init <name> --quick | --concept "<idea>" | --guided
author init <name> --dir <path> --author-dir <path>

author model config | doctor | smoke
author state
author brief
author profile

author plan --chapter <N> | --next [--model] [--write] [--dir <book-dir>]
author write --chapter <N> | --next [--model] [--write] [--dir <book-dir>]
author review --chapter <N> [--mode internal|reader-sim|all] [--model] [--write] [--dir <book-dir>]
author revise --chapter <N> [--model] [--write] [--instruction "<directive>"]
author feedback import --chapter <N> <input-file>
author feedback analyze --chapter <N> [--model] [--write]
author decide --chapter <N> [--model] [--write]
author memory update --chapter <N> [--model] [--write]
author memory deltas [show <name>]

author console ["instruction"] [--dry-run] [--write] [--scope author|book|both]
author console log
author console --rollback <CHG-ID>

author private new --title <name> --concept "<idea>" [--root <bookshelf-dir>]
author private list | current | status [--root <bookshelf-dir>]
author private switch --book <id> [--root <bookshelf-dir>]
author private continue [--root <bookshelf-dir>]
author private read [--chapter latest|N] [--root <bookshelf-dir>]
author private feedback --chapter latest|N --text "<reader feedback>" [--root <bookshelf-dir>]
author private apply [--root <bookshelf-dir>]

author template list | show <key> | promote <key> | forget <key> | export <key> <file.zip>
author skill install [--dir <skills-root>] [--force]
```

---

## 7. 字数与容差配置

`.authoros/config.yaml` 控制 chief-writer 写作长度:

```yaml
chapter_word_count: 3000
chapter_word_count_floor_percent: 70
chapter_word_count_ceiling_percent: 150
```

write 会尽量落在范围内。超出时 `revise` 会把 length_state 当作修订理由。

---

## 8. Agent Profile 自定义

书层 agent profile 在 `.authoros/agents/<name>.md`,作者层默认 profile 在 `<author-dir>/agents/<name>.md`。可直接编辑,下次调用生效。

核心 agent:

`planner`, `chief-writer`, `world-advisor`, `character-advisor`, `plot-advisor`, `style-advisor`, `editor`, `reader-sim`, `feedback-analyzer`, `decider`, `memory-curator`, `book-setup-editor`, `author-console`。

---

## 9. 决策权重

默认 `.authoros/weights.yaml`:

```yaml
decision_basis_weights:
  author_long_term_plan:  { weight: 40, enabled_when: always }
  internal_review:        { weight: 30, enabled_when: always }
  simulated_readers:      { weight: 10, enabled_when: always }
  reader_feedback:
    weight: 20
    enabled_when: real_feedback_exists
    redistribute_when_absent: false
```

缺真实反馈时跳过该项,不归一化。

---

## 10. 模拟读者

`.authoros/readers.yaml` 保存模拟读者人格。`review --mode reader-sim` 每章按这个清单输出读者侧信号。

---

## 11. 常见问题

**Q: 模型返回空内容,报 finish_reason: length**  
A: max_tokens 顶到了。先降低 `chapter_word_count`,或检查对应命令的输出预算。

**Q: 章节 OUT OF RANGE 怎么办**  
A: 跑 `author revise --chapter N --model --write`。chief-writer 会根据 length_state 压缩或扩张。

**Q: 我想跳过 review 直接 decide 行不行**  
A: 不行。decider 需要 internal review 和 reader-sim review。

**Q: 记忆 delta 怎么合并**  
A: 先用 `author memory deltas` 查看待处理 delta,再用 `author memory deltas show <name>` 查看内容。把采纳内容手动合并到 `memory/canon.md` 的"变更记录"段,或合并到对应的 `memory/foreshadowing.yaml`、`memory/plot_threads.yaml`、`memory/character_state.yaml`。AuthorOS 不自动合并 canon 或 YAML。

**Q: 为什么我的概念没生成异能内容**  
A: v0.3 的 Strategy Pass 会先判断你的概念适合哪个模板,并用 banned vocabulary 防止不相关模板词汇串入。如果你的 concept 是侦探、校园、科幻等非异能方向,系统会避免把 `urban_power_anomaly` 的能力/代价词汇硬塞进去。

**Q: candidate template 是什么**  
A: Distill Pass 认为某本书形成了可复用题材结构时,会在作者层创建 `status: candidate` 的模板。它不会自动用于新书;你确认后用 `author template promote <key>` 转为 active。

**Q: PowerShell 里 `npm` 或 `author` 报脚本被禁用**  
A: 用 `npm.cmd` / `author.cmd`,或修改 ExecutionPolicy。

---

## 12. 验证安装

```powershell
npm test
npm run build
node src\cli.ts --help
```

当前 v0.3 测试矩阵目标是 140+ tests pass。

---

## 13. 作者控制台

`author console` 是作者驾驶席,用于调整书或作者层的 shape,不直接重写章节正文。

One-shot:

```powershell
author console "把主角名字从 X 改成 Y"
author console --dry-run "调整世界规则"
author console --write "调整大纲第二阶段"
author console --scope author "把默认写作偏好改得更克制"
```

REPL:

```powershell
author console
```

每次模型输出必须是四段协议:

```text
[scope] book | author | both
[impact]
  <severity>: <file> - <reason>
[edits]
- file: product.md
  op: replace-text
  find: |
    <exact old text>
  replace: |
    <new text>
[next]
  <command>
```

`[edits]` 使用结构化 YAML op,支持 `append-after-heading`, `prepend-before-heading`, `replace-section`, `replace-text`, `append-to-file`, `create-file`, `set-yaml-key`, `append-yaml-array-item`, `delete-yaml-array-item`。

REPL 支持:

- `apply`:应用结构化 edits,写入 `changes/<ts>/` 快照。
- `edit`:把 edits YAML 写到临时文件,用 `$EDITOR` 编辑后再决定。
- `abort`:丢弃本次建议。
- `drill <file>`:预览应用后该文件完整内容。

历史与回滚:

```powershell
author console log
author console --rollback CHG-XXXX
```

回滚会从对应 change 的 `before/` 快照还原文件,并写入新的 rollback change 记录。

---

## 14. 模板管理

模板分两类:

- `seed`:随 AuthorOS 发布的出厂模板,不可删除。
- `author`:作者层 `templates/<key>/` 中积累的模板资产。

命令:

```powershell
author template list
author template show <key>
author template promote <key>
author template forget <key>
author template export <key> <file.zip>
```

说明:

- `list`:列 seed 和 author templates,标注 source/status。
- `show`:查看 `meta.yaml` 和文件结构。
- `promote`:把 candidate template 转为 active,可被后续建书使用。
- `forget`:删除作者层模板;seed template 会报错。
- `export`:打包成 zip,方便迁移或提 PR 进入 seed templates。

candidate template 来自 Distill Pass。它代表"这本书总结出的可复用结构",需要人工 promote 后才进入常用模板库。

---

## 15. 私人 AI 作者模式

`author private` 是给单个读者/朋友体验用的外层 bookshelf。它不改变 AuthorOS 的核心设计:每一本书仍然是一个标准书层项目,只是统一放在一个 root 下并记录当前书。

目录结构:

```text
<bookshelf-dir>/
  bookshelf.json
  books/
    <book-id>/
      product.md
      outline.md
      chapters/
      .authoros/
```

推荐 root:

```powershell
$env:AUTHOROS_PRIVATE_ROOT="D:\Books\authoros-web"
```

最小体验流:

```powershell
author private new --title "战后魔法部审计" --concept "HP 同人,主角是战后魔法部审计员"
author private continue
author private read --chapter latest
author private feedback --chapter latest --text "这一章冷幽默不够,茶杯案可以更荒诞一点"
author private apply
```

多书切换:

```powershell
author private list
author private switch --book <id>
author private current
author private status
```

行为边界:

- `new` 会建一本标准 AuthorOS 书并写入 `bookshelf.json`,自动设为当前书。
- `continue` 等价于对当前书跑 `plan --next --model --write` 后再跑 `write --next --model --write`。
- `feedback` 只做预览,把读者意见转成 `revise --instruction` 的 dry-run,并保存一条 pending feedback。
- `apply` 才会把 pending feedback 应用到章节正文;原章备份仍由 `revise` 放到 `chapters/NNNN.draft.md`。
- 不支持删书。想停看一本书就切到别的书,旧书目录会保留。

---

## 分发

```powershell
npm pack
npm install -g .\authoros-0.3.0.tgz
author skill install
```

详细模型行为在 `src/commands/*.ts` 的 prompt 里,agent profile 在 init 后的 `.authoros/agents/*.md`。
