import { join } from 'node:path';
import { agentContextPaths } from './agentContext.ts';
import { loadCascadedMarkdown } from './cascade.ts';
import { resolveAuthorDir } from './authorSchema.ts';
import { AuthorOsError } from './schema.ts';

export interface AgentProfileTemplate {
  name: string;
  path: string;
  content: string;
}

const agentResponsibilities: Record<string, string[]> = {
  planner: [
    'Plans the next chapter before drafting: chapter goal, conflict, scheduled 爽点, hook, information release, character moves, foreshadowing touch points.',
    'Reads the author plan and current memory; produces a concise chapter intent the chief-writer can obey.',
  ],
  'chief-writer': [
    'Drafts the chapter prose from the planner output. Owns voice and chapter direction.',
    'Keeps one stable creative direction even when advisors disagree.',
    'Uses advisor output only after the editor turns it into decisions.',
  ],
  'world-advisor': [
    'Checks world rules, costs, setting logic, power limits, and continuity risks.',
    'Reports contradictions and missing constraints without rewriting prose.',
  ],
  'character-advisor': [
    'Checks character motivation, agency, relationship movement, and emotional truth.',
    'Flags moments where characters act for plot convenience instead of believable pressure.',
  ],
  'plot-advisor': [
    'Checks promise/payoff movement, hook strength, conflict escalation, and pacing.',
    'Separates blocking structural risks from optional improvements.',
  ],
  'style-advisor': [
    'Checks tone, sentence texture, genre fit, readability, and voice drift.',
    'Protects the intended style without taking over the chief-writer voice.',
  ],
  editor: [
    'Converts advisor notes into accepted, rejected, blocking, and deferred decisions.',
    'Protects the chief-writer direction unless a blocking risk is concrete.',
  ],
  'reader-sim': [
    'Reads the chapter as each project-configured reader persona and reports their authentic reactions.',
    'Does not rewrite prose; supplies a reader-side signal that complements internal review.',
  ],
  'feedback-analyzer': [
    'Classifies imported real reader feedback into: high-signal, noise, emotional, misread, data-shaped.',
    'Surfaces what to adopt, what to defer, what to verify, and what not to chase.',
  ],
  decider: [
    'Produces the weighted creative decision report for the chapter.',
    'Inputs: author plan, internal review, simulated readers, real feedback analysis (if present).',
    'Default weights: author plan 40 / internal review 30 / simulated readers 10 / real feedback 20.',
    'When real feedback is absent: skip that line, do not redistribute its weight, do not normalize to 100.',
  ],
  'memory-curator': [
    'Extracts typed memory deltas after each chapter:',
    '  canon (newly confirmed setting), foreshadowing (introduced/advanced/redeemed),',
    '  plot threads (state moves), character state (relationship/knowledge/ability changes), style (rule updates).',
    'Emits deltas only; never rewrites whole memory files.',
  ],
  'book-setup-editor': [
    'At project init, interviews the author and turns their intent into 6 identity files: product.md, author.md, world.md, outline.md, characters.yaml, review_rules.md.',
    'Treats template files only as structural reference (section headings, expected fields). Content MUST reflect the author\'s book — never copy template defaults verbatim when concrete user input is available.',
    'Concept mode: receives a one-shot concept string and writes all 6 files in parallel, each tailored to the concept.',
    'Guided mode: asks one focused Chinese question per section, then writes that section based on the answer; accepts shortcuts: 你建议 (propose) / 跳过 (template default) / 暂定 (template default + TBD marker).',
    'Output Markdown / YAML only — no commentary. Match the template structure faithfully so downstream agents (chief-writer, advisors, decider, memory-curator) can read the files without changes.',
  ],
  'author-console': [
    'Receives natural-language author directives and identifies which shape layer should change: outline, world, characters, review rules, memory proposal, agent profile, template, or author preference.',
    'Outputs exactly four blocks: [scope], [impact], [diff], [next].',
    'Never edits chapter prose directly; route prose changes through an author revise --instruction command in [next].',
    'Any write must first present a unified diff for user apply or one-shot --write.',
  ],
};

export function defaultAgentProfiles(): readonly AgentProfileTemplate[] {
  return Object.entries(agentResponsibilities).map(([name, responsibilities]) => ({
    name,
    path: agentProfilePath(name),
    content: renderAgentProfile(name, responsibilities),
  }));
}

export function defaultAgentProfileContent(name: string): string {
  const responsibilities = agentResponsibilities[name];
  if (!responsibilities) {
    return renderAgentProfile(name, [
      'This agent profile was generated as a fallback.',
      'Clarify responsibilities before using it for production writing.',
    ]);
  }

  return renderAgentProfile(name, responsibilities);
}

export function agentProfilePath(name: string): string {
  return `.authoros/agents/${name}.md`;
}

export async function readAgentProfile(projectDir: string, name: string): Promise<string> {
  const relativePath = `agents/${name}.md`;
  try {
    return await loadCascadedMarkdown({
      builtinRoot: join(projectDir, '.authoros'),
      authorRoot: resolveAuthorDir(undefined),
      bookRoot: join(projectDir, '.authoros'),
    }, relativePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AuthorOsError(
        `agent profile missing at ${agentProfilePath(name)}. Run author init or restore the profile.`,
      );
    }
    throw error;
  }
}

function renderAgentProfile(name: string, responsibilities: string[]): string {
  const contextPaths = agentContextPaths(name);
  return [
    `# ${name}`,
    '',
    '## Responsibilities',
    '',
    ...responsibilities.map((item) => `- ${item}`),
    '',
    '## Required Context',
    '',
    ...(contextPaths.length > 0
      ? contextPaths.map((path) => `- ${path}`)
      : ['- No context contract is registered yet.']),
    '',
    '## Boundaries',
    '',
    '- Follow user-confirmed canon and current top-level identity files (product.md, author.md).',
    '- Precedence: canon > author profile > product positioning > current chapter plan.',
    '- State uncertainty instead of inventing hidden decisions.',
    '- Keep outputs in Markdown unless the command asks for another format.',
    '',
  ].join('\n');
}
