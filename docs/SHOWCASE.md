# OpenAI Showcase Submission Draft

This file contains a ready-to-copy submission draft for the OpenAI Showcase Gallery form.

Official form: https://openai.com/form/showcase-submission/

## Project Links

- GitHub URL: https://github.com/nax-sec/AuthorOS
- Cover image URL: https://raw.githubusercontent.com/nax-sec/AuthorOS/main/docs/assets/showcase-cover.svg
- Hosted URL: use the current Cloudflare Tunnel URL if available. If not, leave blank or write "Local demo available on request."

## Title

AuthorOS Private AI Author

## Tagline

A local-first AI author system that turns reader feedback into planned story revisions, with a private web bookshelf for writing and reading serialized fiction.

## Short Description

AuthorOS is a local-first AI author workflow for long-form fiction. It treats each book as a managed creative product: planning chapters, drafting prose, reviewing with internal agents, previewing reader feedback, applying approved revisions, and preserving book memory.

This submission adds a private web agent layer built with Codex. A reader can start a book, switch between books, continue chapters, read the latest chapter, give feedback, preview revisions, approve changes, and download chapters from a simple browser UI.

## What It Does

AuthorOS provides a complete writing loop for serialized fiction:

- Create and preserve multiple books in a local bookshelf.
- Ask intake questions before creating a new story.
- Plan and write chapters through model-backed AuthorOS commands.
- Show live progress for long-running writing jobs.
- Let a reader give feedback in natural language.
- Preview revisions before overwriting any chapter.
- Apply approved revisions while preserving draft history.
- Download the current chapter or all chapters.

## How Codex Was Used

Codex was used as the main engineering partner to design and implement the project end to end. It helped build the TypeScript CLI, agent workflow, private web server, browser UI, test suite, documentation, and deployment workflow. The latest web agent feature was designed, implemented, tested, committed, and pushed through an iterative Codex development session.

## Models And APIs

The project uses an OpenAI-compatible chat completion interface for model-backed author commands. It can be configured for OpenAI models by setting:

```bash
OPENAI_API_KEY=<key>
OPENAI_BASE_URL=https://api.openai.com/v1
AUTHOROS_MODEL=<model>
```

The local development demo may also use a non-OpenAI OpenAI-compatible provider. The model provider is configurable and not hard-coded.

## Tech Stack

- Node.js
- TypeScript
- Built-in HTTP server
- Server-Sent Events for progress updates
- Local filesystem storage
- OpenAI-compatible model API
- Cloudflare Tunnel for temporary sharing

## Setup Steps

```bash
git clone https://github.com/nax-sec/AuthorOS.git
cd AuthorOS
npm install
npm test
npm run build

export OPENAI_API_KEY="<key>"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export AUTHOROS_MODEL="<model>"
export AUTHOROS_PRIVATE_ROOT="$HOME/Books/authoros-web"
export AUTHOROS_WEB_TOKEN="<temporary-access-code>"
export AUTHOROS_WEB_AGENT="hybrid"

node src/cli.ts web --root "$AUTHOROS_PRIVATE_ROOT" --port 8787
```

Open the local app:

```text
http://127.0.0.1:8787
```

For a temporary external demo:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

## Suggested Tags

- Creative writing
- Agentic workflows
- Local-first apps
- AI authoring tools
- Reader feedback
- Codex-built project

## Submission Notes

Be transparent in the form:

- If asked whether Codex was used, answer yes.
- If asked whether OpenAI models are used at runtime, say the runtime model layer is OpenAI-compatible and configurable.
- If asked about other models or APIs, disclose any non-OpenAI provider used in the current local demo.
- If a hosted URL is required, start the local AuthorOS web server and Cloudflare Tunnel before submitting.
