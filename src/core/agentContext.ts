import { bookSchema } from './bookSchema.ts';

export interface AgentContextSpec {
  agent: string;
  paths: string[];
}

const identityFile = (file: string): string => {
  const entry = bookSchema.identityFiles.find((item) => item.file === file);
  return entry?.file ?? file;
};

const memoryFile = (file: string): string => {
  const entry = bookSchema.memoryFiles.find((item) => item.file === file);
  return entry?.file ?? file;
};

const agentContextPathMap: Record<string, string[]> = {
  planner: [
    identityFile('product.md'),
    identityFile('author.md'),
    identityFile('outline.md'),
    identityFile('characters.yaml'),
    memoryFile('memory/canon.md'),
    memoryFile('memory/foreshadowing.yaml'),
    memoryFile('memory/plot_threads.yaml'),
    memoryFile('memory/character_state.yaml'),
    'decisions/<previous-chapter>.md when available',
  ],
  'chief-writer': [
    identityFile('product.md'),
    identityFile('author.md'),
    'plans/<chapter>.md',
    identityFile('characters.yaml'),
    memoryFile('memory/canon.md'),
    memoryFile('memory/style.md'),
    memoryFile('memory/character_state.yaml'),
    'chapters/<previous-chapter>.md when available',
  ],
  'world-advisor': [
    identityFile('world.md'),
    memoryFile('memory/canon.md'),
    identityFile('review_rules.md'),
    'chapters/<chapter>.md',
  ],
  'character-advisor': [
    identityFile('characters.yaml'),
    memoryFile('memory/character_state.yaml'),
    identityFile('review_rules.md'),
    'chapters/<chapter>.md',
  ],
  'plot-advisor': [
    identityFile('outline.md'),
    memoryFile('memory/foreshadowing.yaml'),
    memoryFile('memory/plot_threads.yaml'),
    identityFile('review_rules.md'),
    'chapters/<chapter>.md',
  ],
  'style-advisor': [
    identityFile('author.md'),
    memoryFile('memory/style.md'),
    'chapters/<chapter>.md',
  ],
  editor: [
    identityFile('product.md'),
    identityFile('author.md'),
    identityFile('review_rules.md'),
    'chapters/<chapter>.md',
  ],
  'reader-sim': [
    identityFile('product.md'),
    '.authoros/readers.yaml',
    'chapters/<chapter>.md',
  ],
  'feedback-analyzer': [
    identityFile('product.md'),
    identityFile('author.md'),
    'feedback/<chapter>.raw.jsonl',
    'chapters/<chapter>.md',
  ],
  decider: [
    identityFile('product.md'),
    identityFile('author.md'),
    'chapters/<chapter>.md',
    'reviews/<chapter>.internal.md',
    'reviews/<chapter>.reader-sim.md',
    'feedback/<chapter>.analysis.md when available',
    '.authoros/weights.yaml',
  ],
  'memory-curator': [
    'chapters/<chapter>.md',
    'decisions/<chapter>.md',
    memoryFile('memory/canon.md'),
    memoryFile('memory/foreshadowing.yaml'),
    memoryFile('memory/plot_threads.yaml'),
    memoryFile('memory/character_state.yaml'),
    memoryFile('memory/style.md'),
  ],
};

export function agentContextPaths(agent: string): string[] {
  const paths = agentContextPathMap[agent];
  return paths ? [...paths] : [];
}

export function agentContextSpecs(): AgentContextSpec[] {
  return Object.entries(agentContextPathMap).map(([agent, paths]) => ({
    agent,
    paths: [...paths],
  }));
}
