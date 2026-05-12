---
name: authoros
description: Use when the user wants to write a novel with AuthorOS — the local-first CLI writing system that runs a closed loop of 12 collaborating agents (planner / chief-writer / 4 advisors / editor / reader-sim / feedback-analyzer / decider / memory-curator / book-setup-editor). Trigger phrases include "authoros", "作者OS", "用 author init / plan / write / review / revise / decide / memory", "起一本书", "跑下一章", "AI 作者", "本地小说创作". Skip when the user only references general writing or a different writing tool.
---

# AuthorOS Usage Skill

AuthorOS is a Node.js CLI that operates a single long-form novel as an AI author's product. It implements the MVP closed loop:

```
作品定位 + 作者人格 → plan → write → review → revise → decide → memory
```

## Installation

```powershell
npm install -g authoros-0.2.0.tgz
author skill install   # registers this SKILL.md into ~/.claude/skills/authoros/
```

After install, `author --help` lists the 13 commands. `author skill install` is idempotent.

## Required environment for any `--model` command

```powershell
$env:OPENAI_API_KEY="<key>"
$env:OPENAI_BASE_URL="<base>"   # e.g. https://api.openai.com/v1
$env:AUTHOROS_MODEL="<name>"    # e.g. gpt-4o, mimo-v2.5-pro
```

Or per-book via `author model config set --base-url ... --model ...`. API key value is **never** persisted (only env var name is stored).

## Starting a new book

`author init` REQUIRES one of three mode flags:

```powershell
author init "我的小说" --concept "<一句话概念>"   # 模型一次扩 6 个 identity 文件
author init "我的小说" --guided                  # 交互式 Q&A,6 段每段一问
author init "我的小说" --quick                   # 仅模板默认,手动编辑
author init "我的小说" --quick --dir D:\path     # 指定路径
```

`book-setup-editor` agent runs the setup. Template (only `urban_power_anomaly` shipped) is structural reference, not canonical content.

## Running one full chapter (the canonical loop)

```powershell
cd <book 目录>

# Verify model is reachable
author model doctor
author model smoke

# The 7-command sequence
author plan --chapter 1 --model --write
author write --chapter 1 --model --write
author review --chapter 1 --mode all --model --write
author revise --chapter 1 --model --write
author decide --chapter 1 --model --write
author memory update --chapter 1 --model --write

# Inspect progress
author state
```

For chapter N+1, replace `--chapter 1` with `--chapter N+1`, or use `--next` on plan/write to auto-pick.

## Optional feedback line (between revise and decide)

```powershell
author feedback import --chapter 1 path\to\feedback.txt
author feedback analyze --chapter 1 --model --write
# decide will automatically include feedback at 20% weight
```

If feedback is absent, decide skips the 20% line and does NOT redistribute weight — strict MVP rule.

## Important design facts agents should know

1. **`chapters/NNNN.md` is canonical** after revise. If chief-writer revised, original is at `chapters/NNNN.draft.md`. decide and memory always read the canonical version.
2. **Length is controlled by `.authoros/config.yaml`**: `chapter_word_count` (default 3000), `chapter_word_count_floor_percent` (80), `chapter_word_count_ceiling_percent` (150). chief-writer is told the acceptable_range at every call.
3. **Decision weights** in `.authoros/weights.yaml`: 作者长期规划 40% / 内部评审 30% / 模拟读者 10% / 真实反馈 20%. Never redistribute when a source is absent.
4. **Memory updates emit deltas only** to `memory/chapter-NNNN.delta.md`. AuthorOS v1 intentionally does NOT auto-edit the 5 typed memory files (canon.md / foreshadowing.yaml / plot_threads.yaml / character_state.yaml / style.md). User merges manually after review.
5. **Agent profiles** at `.authoros/agents/<name>.md` are editable; changes take effect on the next call.
6. **Reader personas** at `.authoros/readers.yaml` (5 types by default); reader-sim agent rotates through all of them.

## Common command flags

- `--model` — call real LLM; without it, commands produce a "scaffold" placeholder
- `--write` — persist to disk; without it, only preview is printed
- `--next` — on plan/write, auto-pick the next pending chapter
- `--mode internal|reader-sim|all` — on review; default is `internal`

## Troubleshooting cheats

- `finish_reason: length` → max_tokens 不够。chief-writer is dynamic (based on chapter_word_count_ceiling); advisors at 2400; editor at 3000. Adjust `chapter_word_count` if you need bigger chapters.
- `OUT OF RANGE` after write → run revise; it will compress (over) or expand (under) within the range constraint.
- decide errors "missing required context" → run `author review --chapter N --mode all --model --write` first; decide requires both internal and reader-sim reviews.
- `Project name is required` / `requires one of --quick/--concept/--guided` → 显式选模式 flag.

## When asked to "continue writing chapter N"

1. Run `author state` first to see what stages chapter N has and what's missing.
2. Resume from the first missing stage in plan → write → review → revise → decide → memory order.
3. If everything for N is complete, suggest moving to N+1 with `author plan --next`.

## Reference files inside an AuthorOS book

- Per-command logic lives in the installed package; see `npm root -g`/authoros/src/commands/`.
- Agent context contract: `src/core/agentContext.ts` (which files each agent reads)
- Agent roster: `src/core/agents.ts`
- Detailed user-facing manual: `USAGE.md` shipped with the package

When in doubt, run `author <command> --help` for command-specific guidance.
