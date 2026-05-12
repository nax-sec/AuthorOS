# AuthorOS 使用说明

AuthorOS 是本地优先的 AI 作者 CLI:由 12 个 agent 协作经营一本长篇小说,完成 计划 → 写作 → 评审 → 修订 → 决策 → 记忆 的闭环。

---

## 1. 系统要求

- Node.js **24** 或更新
- 任何能跑 `node` 的 shell(PowerShell / bash 都行)
- 一个 OpenAI 兼容的 API key + base_url + 模型名

**运行时零 npm 依赖**。dev 用 Node 24 native TypeScript type stripping 直接跑 `src/*.ts`;发布时 `npm pack` 会自动通过 prepack 脚本用 tsc 编译到 `dist/`(devDep 只有 typescript,运行时不需要)。

### Windows PowerShell 注意

默认 ExecutionPolicy(`Restricted`)会拦截 `npm.ps1` 和 npm 装出来的 `author.ps1`。两种绕法:

```powershell
# 绕法 A:用 .cmd shim(batch file,不受 policy 影响)
npm.cmd install -g .\authoros-0.2.0.tgz
author.cmd --help

# 绕法 B:为当前用户放开
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
npm install -g .\authoros-0.2.0.tgz
author --help
```

cmd.exe / Git Bash / WSL 不受影响。

---

## 2. 安装

### 方式 A: npm pack(推荐)

```powershell
# 拿到 authoros-0.2.0.tgz 后
npm install -g .\authoros-0.2.0.tgz
author --help
# 卸载:npm uninstall -g authoros
```

装完顺手注册 Claude Code skill(可选,让 Claude Code 自动识别 AuthorOS 触发短语):

```powershell
author skill install                   # 装到 ~/.claude/skills/authoros/
author skill install --force           # 覆盖已存在副本
author skill install --dir <root>      # 装到别处
```

### 方式 B: 解压 + npm link

```powershell
# 解压 authoros-v2.zip
cd authoros-v2
npm link            # 注册 author / authoros 命令
author --help
```

### 方式 C: 不安装,直接跑

```powershell
cd authoros-v2
node src\cli.ts --help
```

---

## 3. 配置模型

模型 key **永不存盘**(只存环境变量名)。两种配置层次:

### 环境变量(默认,所有 book 共用)

```powershell
$env:OPENAI_API_KEY="<你的 key>"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"     # 或你的代理
$env:AUTHOROS_MODEL="gpt-4o"                          # 或别的模型名
```

### 项目级覆盖(写到 `.authoros/model.json`)

```powershell
cd <book 目录>
author model config set --base-url https://... --model <name>
author model config set --api-key-env OPENAI_API_KEY    # env 变量名,不是 key 本身
author model doctor       # 不联网,只检查配置是否齐
author model smoke        # 联网 ping chief-writer,确认能通
```

---

## 4. 起一本书

`author init` **必须**选一个模式 flag:

```powershell
# (1) concept 模式:一句话给模型,模型一次出 6 个 identity 文件
author init "我的小说" --concept "都市异能,主角是数据分析师,能力是回溯历史信息"

# (2) guided 模式:交互式 Q&A,6 段每段一个问题
author init "我的小说" --guided

# (3) quick 模式:仅用模板默认(后续手动编辑或重新 init)
author init "我的小说" --quick

# 路径控制
author init demo --quick --dir D:\Books\demo      # 指定路径
author init demo --quick --force                  # 允许覆盖非空目录
```

**模板**(目前仅 `urban_power_anomaly`)是**结构参考**——concept/guided 模式下,模型只用它的小节结构,内容完全按用户意图重写。`--quick` 才会原样保留模板内容。

### 起完书你会得到

```
我的小说/
  product.md            # 作品定位
  author.md             # 作者人格
  outline.md            # 主线大纲
  world.md              # 世界与规则
  characters.yaml       # 人物表
  review_rules.md       # 章节评审规则
  README.md             # 项目级 README(自动生成)
  plans/                # 章节计划
  chapters/             # 章节正文(canonical)+ <ch>.draft.md(被修订时的原稿备份)
  reviews/              # <ch>.internal.md / <ch>.reader-sim.md
  feedback/             # <ch>.raw.jsonl / <ch>.analysis.md
  decisions/            # 加权决策报告
  memory/
    canon.md, foreshadowing.yaml, plot_threads.yaml,
    character_state.yaml, style.md   # 5 类类型化记忆
    chapter-<ch>.delta.md             # 每章 memory-curator 输出的待合并 delta
  .authoros/
    config.yaml         # 项目配置(字数目标、容差等)
    state.json          # 章节进度状态
    weights.yaml        # 决策权重(默认 40/30/10/20)
    readers.yaml        # 5 类模拟读者人格
    model.json          # (可选) 模型配置
    agents/<name>.md    # 12 个 agent 的可编辑 profile
    runs/               # 操作日志(预留)
    templates/<name>/   # 冻结的模板源拷贝
```

---

## 5. 跑通第一章 — 完整流程

闭环:**plan → write → review → revise → decide → memory**

```powershell
cd <book 目录>

# 0. 确认模型可用
author model doctor
author model smoke              # 真模型 ping chief-writer

# 1. 规划第一章
author plan --chapter 1 --model --write

# 2. 写第一章(chief-writer 出稿,长度按 .authoros/config.yaml 的 target ±容差控制)
author write --chapter 1 --model --write

# 3. 评审(并行 4 顾问 + editor 综合 + 5 类模拟读者)
author review --chapter 1 --mode all --model --write

# 4. chief-writer 自己看评审,判断要不要修
#    REVISION_NEEDED: yes → 原稿存为 chapters/0001.draft.md,新版覆盖 chapters/0001.md
#    REVISION_NEEDED: no  → 文件不动
author revise --chapter 1 --model --write

# 5. 加权决策(40/30/10/20;无真实反馈时该项不计,不补权)
author decide --chapter 1 --model --write

# 6. 记忆更新建议(产出 memory/chapter-0001.delta.md,手动合并到 memory/* 5 个文件)
author memory update --chapter 1 --model --write

# 看进度
author state
```

**真实反馈线**(可选,decide 前导入):

```powershell
# 你手上有 feedback.txt,每行一条
author feedback import --chapter 1 path\to\feedback.txt
author feedback analyze --chapter 1 --model --write
# 然后 decide 会自动把真实反馈纳入权重(20%)
author decide --chapter 1 --model --write
```

---

## 6. 命令速查

```
author init <name> --quick | --concept "<idea>" | --guided
author init <name> --dir <path>

author model config | doctor | smoke
author model config set --base-url <url> --model <name> --api-key-env <ENV>
author model config reset

author state                                            # 各章产出状态
author brief                                            # 打印 product.md
author profile                                          # 打印 author.md

author plan --chapter <N> | --next [--model] [--write]
author plan status

author write --chapter <N> | --next [--model] [--write]

author review --chapter <N> [--mode internal|reader-sim|all] [--model] [--write]

author revise --chapter <N> [--model] [--write]

author feedback import --chapter <N> <input-file>
author feedback analyze --chapter <N> [--model] [--write]

author decide --chapter <N> [--model] [--write]

author memory update --chapter <N> [--model] [--write]

author skill install [--dir <skills-root>] [--force]
```

所有命令都支持 `--help`。

`--model`:走真模型;省略时多数命令产出"scaffold"占位结构(便于查看结构、不耗 token)。
`--write`:落盘;省略时仅打印预览。
`--next`:用在 plan / write 上,自动找下一个待处理章节。

---

## 7. 字数与容差配置

`.authoros/config.yaml` 控制 chief-writer 写作时的长度目标:

```yaml
chapter_word_count: 3000              # 中文字符目标
chapter_word_count_floor_percent: 80  # 最低 = target × 0.8 = 2400
chapter_word_count_ceiling_percent: 150 # 最高 = target × 1.5 = 4500
```

write 时模型会读 acceptable_range 并尝试落在范围内。超出会在终端报 `OUT OF RANGE`,revise 步骤会强制压缩(或扩张)使其回到范围。

---

## 8. agent profile 自定义

12 个 agent 的 profile 都在 `.authoros/agents/<name>.md`,用户可以**直接编辑**:

```
planner.md            chief-writer.md      world-advisor.md
character-advisor.md  plot-advisor.md      style-advisor.md
editor.md             reader-sim.md        feedback-analyzer.md
decider.md            memory-curator.md    book-setup-editor.md
```

每个 profile 包含 Responsibilities / Required Context / Boundaries 三段。改完立即生效(下次该 agent 调用就用新 profile)。

---

## 9. 决策权重自定义

`.authoros/weights.yaml`(默认值符合 MVP 文档):

```yaml
decision_basis_weights:
  author_long_term_plan:  { weight: 40, enabled_when: always }
  internal_review:        { weight: 30, enabled_when: always }
  simulated_readers:      { weight: 10, enabled_when: always }
  reader_feedback:        { weight: 20, enabled_when: real_feedback_exists,
                            redistribute_when_absent: false }
```

decider 严格执行 `redistribute_when_absent: false` —— 没真实反馈时这 20% **不补权给其它项**,不归一化。

---

## 10. 模拟读者自定义

`.authoros/readers.yaml` 列出 5 类读者人格(都市异能默认):

```yaml
simulated_readers:
  - id: R1
    name: 爽点读者
    cares: [主角有没有赢, 能力用法爽不爽, 憋屈有没有释放]
  ...
```

reader-sim agent 每章按这个清单走,每类人格输出一段反馈。换书种类时可以直接改这里。

---

## 11. 常见问题

**Q: 模型返回空内容,报 finish_reason: length**
A: max_tokens 顶到了。advisor 是 2400,editor 3000,chief-writer 动态(基于 chapter_word_count_ceiling)。一般 chinese chars 1.5K-3K 字够用;如果你的目标长度比默认 3000 大很多,改 `.authoros/config.yaml` 里的 `chapter_word_count`。

**Q: 章节 OUT OF RANGE 怎么办**
A: 跑 `author revise --chapter N --model --write` —— chief-writer 看到 length_state 超范围会主动压缩(或扩张)。

**Q: 我想跳过 review 直接 decide 行不行**
A: 不行。decider 的 required context 包含 internal review 和 reader-sim review,缺会报错。这是设计——加权决策必须有评审输入。

**Q: 记忆 delta 怎么"合并"**
A: 手动。打开 `memory/chapter-NNNN.delta.md`,看 5 段 delta,把要采纳的内容粘到 `memory/canon.md` / `foreshadowing.yaml` / 等文件。AuthorOS v1 故意不自动合并,避免破坏作者人工 curation 的 canon。

**Q: PowerShell 里 `npm` 或 `author` 报 "cannot be loaded because running scripts is disabled"**
A: 默认 ExecutionPolicy 拦 `.ps1`。用 `npm.cmd` / `author.cmd`,或 `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`。详见 §1。

---

## 12. 验证安装是否完整

```powershell
cd authoros-v2     # 或你装到的位置
npm test           # 应该看到 80+ tests pass
node src\cli.ts --help
```

---

完。详细模型行为在 `src/commands/*.ts` 的 prompt 里能看到具体约束,12 个 agent 的 profile 在 init 后的 `.authoros/agents/*.md`。
