# AuthorOS

本地优先的 AI 作者 CLI。AuthorOS 把一本长篇小说当作一个可经营的产品,用 agent 闭环完成计划、写作、评审、修订、决策、记忆更新和作者级形状调整。

License: MIT · Node.js >= 24 · 运行时零 npm 依赖

---

## 1. 系统要求

v0.3 引入了"作者层":首次使用前先运行 `author author init`,让 AuthorOS 建立作者级 profile、preferences、templates 和 agent 默认配置。之后每本书都可以从作者层继承这些资产。

- Node.js **24** 或更新
- 任何能跑 `node` 的 shell(PowerShell / bash 都行)
- 一个 OpenAI 兼容的 API key + base_url + 模型名

运行时零 npm 依赖。dev 模式用 Node 24 native TypeScript type stripping 直接跑 `src/*.ts`;发布时 `npm pack` 会通过 prepack 脚本编译到 `dist/`。

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

author plan --chapter 1 --model --write
author write --chapter 1 --model --write
author review --chapter 1 --mode all --model --write
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

author plan --chapter <N> | --next [--model] [--write]
author write --chapter <N> | --next [--model] [--write]
author review --chapter <N> [--mode internal|reader-sim|all] [--model] [--write]
author revise --chapter <N> [--model] [--write] [--instruction "<directive>"]
author feedback import --chapter <N> <input-file>
author feedback analyze --chapter <N> [--model] [--write]
author decide --chapter <N> [--model] [--write]
author memory update --chapter <N> [--model] [--write]

author console ["instruction"] [--dry-run] [--write] [--scope author|book|both]
author console log
author console --rollback <CHG-ID>

author template list | show <key> | promote <key> | forget <key> | export <key> <file.zip>
author skill install [--dir <skills-root>] [--force]
```

---

## 7. 字数与容差配置

`.authoros/config.yaml` 控制 chief-writer 写作长度:

```yaml
chapter_word_count: 3000
chapter_word_count_floor_percent: 80
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
A: 手动打开 `memory/chapter-NNNN.delta.md`,把采纳内容合并到 `memory/*`。AuthorOS 不自动改 canon。

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

## 分发

```powershell
npm pack
npm install -g .\authoros-0.3.0.tgz
author skill install
```

详细模型行为在 `src/commands/*.ts` 的 prompt 里,agent profile 在 init 后的 `.authoros/agents/*.md`。
