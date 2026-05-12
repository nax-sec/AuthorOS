export interface AgentContextSpec {
  agent: string;
  paths: string[];
}

const agentContextPathMap: Record<string, string[]> = {
  planner: [
    'product.md',
    'author.md',
    'outline.md',
    'characters.yaml',
    'memory/canon.md',
    'memory/foreshadowing.yaml',
    'memory/plot_threads.yaml',
    'memory/character_state.yaml',
    'decisions/<previous-chapter>.md when available',
  ],
  'chief-writer': [
    'product.md',
    'author.md',
    'plans/<chapter>.md',
    'characters.yaml',
    'memory/canon.md',
    'memory/style.md',
    'memory/character_state.yaml',
    'chapters/<previous-chapter>.md when available',
  ],
  'world-advisor': [
    'world.md',
    'memory/canon.md',
    'review_rules.md',
    'chapters/<chapter>.md',
  ],
  'character-advisor': [
    'characters.yaml',
    'memory/character_state.yaml',
    'review_rules.md',
    'chapters/<chapter>.md',
  ],
  'plot-advisor': [
    'outline.md',
    'memory/foreshadowing.yaml',
    'memory/plot_threads.yaml',
    'review_rules.md',
    'chapters/<chapter>.md',
  ],
  'style-advisor': [
    'author.md',
    'memory/style.md',
    'chapters/<chapter>.md',
  ],
  editor: [
    'product.md',
    'author.md',
    'review_rules.md',
    'chapters/<chapter>.md',
  ],
  'reader-sim': [
    'product.md',
    '.authoros/readers.yaml',
    'chapters/<chapter>.md',
  ],
  'feedback-analyzer': [
    'product.md',
    'author.md',
    'feedback/<chapter>.raw.jsonl',
    'chapters/<chapter>.md',
  ],
  decider: [
    'product.md',
    'author.md',
    'chapters/<chapter>.md',
    'reviews/<chapter>.internal.md',
    'reviews/<chapter>.reader-sim.md',
    'feedback/<chapter>.analysis.md when available',
    '.authoros/weights.yaml',
  ],
  'memory-curator': [
    'chapters/<chapter>.md',
    'decisions/<chapter>.md',
    'memory/canon.md',
    'memory/foreshadowing.yaml',
    'memory/plot_threads.yaml',
    'memory/character_state.yaml',
    'memory/style.md',
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
