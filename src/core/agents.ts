export interface AgentDefinition {
  name: string;
  description: string;
}

export const agentRoster: readonly AgentDefinition[] = [
  { name: 'planner', description: 'Plans the next chapter: goals, conflict, hook, information release, character moves' },
  { name: 'chief-writer', description: 'Drafts chapter prose; owns voice and chapter direction' },
  { name: 'world-advisor', description: 'Diagnoses world / power-rule / canon-consistency risks' },
  { name: 'character-advisor', description: 'Diagnoses character motivation, agency, and relationship truth' },
  { name: 'plot-advisor', description: 'Diagnoses promise/payoff, pacing, hook strength, conflict escalation' },
  { name: 'style-advisor', description: 'Diagnoses tone, voice, genre fit, readability' },
  { name: 'editor', description: 'Synthesizes advisor reports into accepted / rejected / blocking decisions' },
  { name: 'reader-sim', description: 'Simulates the project-configured reader personas and reports their reactions' },
  { name: 'feedback-analyzer', description: 'Classifies imported real reader feedback into actionable categories' },
  { name: 'decider', description: 'Produces the weighted creative decision report from internal review, reader sim, feedback, and author plan' },
  { name: 'memory-curator', description: 'Extracts typed memory deltas: canon / foreshadowing / plot threads / character state / style' },
  { name: 'book-setup-editor', description: 'At init time, interviews the author and turns their intent into the 6 identity files (product/author/world/outline/characters/review_rules)' },
  { name: 'author-console', description: 'Director seat for author/book shape edits through a 4-block diff protocol' },
] as const;

export const agentNames = agentRoster.map((agent) => agent.name) as readonly string[];
