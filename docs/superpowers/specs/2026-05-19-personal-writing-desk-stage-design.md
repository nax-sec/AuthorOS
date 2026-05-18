# Personal Writing Desk Stage Design

**Goal:** Turn the current vertical cockpit into a calmer single-user writing desk where one work mode is primary at a time.

**Approved Direction:** Use a central stage with four modes: chapter, production, preview, and memory. Keep the left sidebar for navigation and session context. Keep the right side as a collapsible author assistant dock, with model, style, assets, and jobs as compact utility drawers below it.

**Design Notes:**
- The first viewport should feel like an operating desk, not a long admin page.
- The current book context stays visible at the top of the stage.
- The mode switcher replaces anchor-only scrolling and reveals one stage panel at a time.
- Existing DOM ids and test ids remain available so current rendering code continues to work.
- The right assistant dock can collapse to give the manuscript more horizontal room.
- Utility modules use `details` drawers so model config, style profile, assets, and jobs do not dominate the page until needed.
- Visual tone is private editorial software: pale paper surface, ink text, restrained teal, and small cinnabar alerts.

**Testing:**
- Static HTML tests must verify the new mode switcher, stage panels, assistant collapse control, drawer utility rail, and supporting JavaScript hooks.
- Existing tests for model config, quality loop, memory review, style extraction, assets, and assistant actions must continue to pass.
