# Personal Writing Desk Design

## Goal

Turn the private web cockpit into a single-author writing desk that can stay open all day: status and recovery stay visible, the current chapter remains the center of gravity, and assistant/chat actions feel like a resident shell rather than a separate feature.

## Scope

This slice is a UI and interaction shell refactor only. It does not change model calls, book generation, memory logic, or file formats. Existing endpoints and data contracts stay intact.

## Design

The page becomes a full-height app shell:

- **Top session bar:** compact service/book/task status plus a restore action. This is the persistent session shell, not the author assistant.
- **Left command rail:** next action, model health, daily session, and bookshelf. It answers "what should I do now?"
- **Center writing surface:** current book context, commitment, chapter reader, production line, preview comparison, and memory review. It answers "what am I writing and what is blocked?"
- **Right assistant dock:** resident author assistant with chat, grouped quick actions, model config, style tools, assets, and task center. It answers "how do I ask the system to do work?"

The author assistant remains the conversational actor. The persistent session shell is the always-visible state layer: current book, current task, last completed action, and restore path.

## Interaction Rules

- Keep the first viewport useful: current book, next action, assistant composer, and model health must be visible on desktop.
- Add a center focus nav for jumping between chapter, production line, preview, and memory sections.
- Keep the assistant dock sticky so the conversation remains available while the writer scrolls the center surface.
- Preserve all existing `data-testid` markers, and add new markers for the redesigned shell so tests can guard the layout contract.
- Mobile collapses to a single column while keeping the session bar and assistant usable.

## Testing

- HTML structure test verifies the redesigned shell markers and jump anchors exist.
- Existing web, cockpit, quality, model, style, and private tests must continue to pass.
- Browser smoke verifies the local page renders the new shell, no console errors appear, and the key regions are visible.
