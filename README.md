# AuthorOS

Local-first CLI writing system for an AI author managing one long-form novel.

The AI author treats the book as its own product: it owns the作品定位 (positioning), 作者人格 (author profile), chapter planning, drafting, multi-track review, weighted creative decisions, and typed long-term memory across the full life of the project.

详细使用见 **[USAGE.md](./USAGE.md)**。

## Requirements

- Node.js **24** or newer
- An OpenAI-compatible API (key + base_url + model name)

**运行时零 npm 依赖**(devDep 仅 `typescript`,只在 `npm pack` 时通过 prepack 跑一次)。

## Quickstart

```powershell
# 安装(任选一种 init 模式)
npm install -g .\authoros-0.2.0.tgz
author init "我的小说" --concept "一句话作品概念"    # 模型扩 6 个 identity 文件
# 或 --guided / --quick

cd "我的小说"
author --help

# 装 Claude Code skill(可选)
author skill install
```

> Windows PowerShell 默认 ExecutionPolicy 拦 `.ps1` shim。用 `npm.cmd` / `author.cmd`,或 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。详见 USAGE.md §1。

## Closed creative loop

```text
作品定位 + 作者人格
  -> plan
  -> write (council: planner + chief-writer + 4 advisors + editor)
  -> review (internal + simulated readers + optional real feedback)
  -> revise (chief-writer self-judges from review)
  -> decide (weighted basis)
  -> memory update (typed deltas, manual merge)
  -> next chapter
```

Default decision basis weights(MVP 文档严格执行):

```text
作者长期规划:  40%
内部评审:      30%
模拟读者:      10%
真实读者反馈:  20%   (absent → 不计该项,不补权)
```

## Project layout

```text
my-book/
  product.md / author.md / outline.md / world.md
  characters.yaml / review_rules.md

  plans/NNNN.md
  chapters/NNNN.md           # canonical(revise 后即新版)
  chapters/NNNN.draft.md     # 修订前原稿备份
  reviews/NNNN.internal.md
  reviews/NNNN.reader-sim.md
  feedback/NNNN.raw.jsonl
  feedback/NNNN.analysis.md
  decisions/NNNN.md

  memory/
    canon.md / foreshadowing.yaml / plot_threads.yaml
    character_state.yaml / style.md       # 5 类类型化记忆
    chapter-NNNN.delta.md                  # 每章 memory-curator 输出的待合并 delta

  .authoros/
    config.yaml / state.json / weights.yaml / readers.yaml
    model.json                # 可选,项目级模型覆盖
    agents/<name>.md          # 12 个 editable agent profile
    templates/<name>/         # 冻结的模板源拷贝
```

## Status

完整 MVP 闭环已实装:plan / write / review / revise / feedback / decide / memory。
12 个 agent,13 条 CLI 命令,88 个测试。

## Verify

```powershell
npm.cmd test                  # 88 tests pass
node src\cli.ts --help        # dev 模式直跑(免 build)
```

## Distribute

```powershell
npm pack                      # 自动跑 prepack(tsc 编译 src/→dist/ + copy 模板)
                              # 产出 authoros-0.2.0.tgz(~81 KB,79 文件)

# 收件人:
npm install -g .\authoros-0.2.0.tgz
author skill install          # 可选
```
