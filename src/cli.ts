#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { initProject } from './commands/init.ts';
import {
  clearModelConfig,
  getModelConfig,
  getModelDoctor,
  renderModelConfig,
  renderModelConfigReset,
  renderModelConfigUpdated,
  renderModelDoctor,
  renderModelSmokeResult,
  runModelSmoke,
  updateModelConfig,
} from './commands/model.ts';
import {
  createChapterPlan,
  getPlanStatus,
  renderPlanResult,
  renderPlanStatus,
} from './commands/plan.ts';
import { getAuthorProfile, getProductBrief, renderIdentityFile } from './commands/brief.ts';
import { getProjectState, renderProjectState } from './commands/state.ts';
import { createChapterDraft, renderWriteResult } from './commands/write.ts';
import { createChapterReview, renderReviewResult, type ReviewMode } from './commands/review.ts';
import { renderReviseResult, reviseChapter } from './commands/revise.ts';
import {
  analyzeFeedback,
  importFeedback,
  renderFeedbackAnalyzeResult,
  renderFeedbackImportResult,
} from './commands/feedback.ts';
import { createChapterDecision, renderDecideResult } from './commands/decide.ts';
import { createMemoryUpdate, renderMemoryUpdateResult } from './commands/memory.ts';
import { installSkill, renderSkillInstallResult } from './commands/skill.ts';
import {
  getAuthorDoctor,
  getAuthorShow,
  initAuthorDirectory,
  openAuthorProfile,
  renderAuthorDoctorResult,
  renderAuthorInitResult,
  renderAuthorShowResult,
  renderEditProfileResult,
} from './commands/author.ts';
import {
  renderSetupResult,
  setupFromConcept,
  setupGuided,
  type AskFn,
} from './commands/setup.ts';
import {
  exportTemplate,
  forgetTemplate,
  listTemplates,
  promoteTemplate,
  renderTemplateExport,
  renderTemplateForget,
  renderTemplateList,
  renderTemplatePromote,
  renderTemplateShow,
  showTemplate,
} from './commands/template.ts';
import {
  getConsoleChanges,
  renderConsoleDryRun,
  renderConsoleLog,
  renderConsoleRollback,
  rollbackConsoleChange,
  runConsoleOneShot,
  runConsoleRepl,
  type ConsoleScope,
} from './commands/console.ts';
import { createOpenAiCompatibleClientFromProject, type LlmClient } from './core/llm.ts';
import type { EnvLike } from './core/modelConfig.ts';
import { resolveAuthorDir } from './core/authorSchema.ts';
import { AuthorOsError } from './core/schema.ts';

export interface Io {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface RunOptions {
  llm?: LlmClient;
  env?: EnvLike;
  now?: Date;
  ask?: AskFn;
}

interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

const defaultIo: Io = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
};

export async function run(
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  io: Io = defaultIo,
  options: RunOptions = {},
): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.stdout(helpText());
    return 0;
  }

  try {
    if (command === 'init') {
      return await runInit(rest, cwd, io, options);
    }

    if (command === 'author') {
      return await runAuthor(rest, io, options);
    }

    if (command === 'model') {
      return await runModel(rest, cwd, io, options);
    }

    if (command === 'plan') {
      return await runPlan(rest, cwd, io, options);
    }

    if (command === 'state') {
      return await runState(rest, cwd, io);
    }

    if (command === 'brief') {
      return await runBrief(rest, cwd, io);
    }

    if (command === 'profile') {
      return await runProfile(rest, cwd, io);
    }

    if (command === 'write') {
      return await runWrite(rest, cwd, io, options);
    }

    if (command === 'review') {
      return await runReview(rest, cwd, io, options);
    }

    if (command === 'revise') {
      return await runRevise(rest, cwd, io, options);
    }

    if (command === 'feedback') {
      return await runFeedback(rest, cwd, io, options);
    }

    if (command === 'decide') {
      return await runDecide(rest, cwd, io, options);
    }

    if (command === 'memory') {
      return await runMemory(rest, cwd, io, options);
    }

    if (command === 'skill') {
      return await runSkill(rest, io);
    }

    if (command === 'template') {
      return await runTemplate(rest, io, options);
    }

    if (command === 'console') {
      return await runConsole(rest, cwd, io, options);
    }

    throw new AuthorOsError(`Unknown command: ${command}`);
  } catch (error) {
    if (error instanceof AuthorOsError) {
      io.stderr(`AuthorOS error: ${error.message}\n`);
      return 1;
    }

    throw error;
  }
}

async function runInit(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(initHelpText());
    return 0;
  }

  const projectName = parsed.positionals[0];
  if (!projectName?.trim()) {
    throw new AuthorOsError('Project name is required. Example: author init "我的小说" --quick');
  }
  const template = stringFlag(parsed.flags.template) ?? 'urban_power_anomaly';
  const targetDir = stringFlag(parsed.flags.dir);
  const force = parsed.flags.force === true;

  const quick = parsed.flags.quick === true;
  const guided = parsed.flags.guided === true;
  const concept = stringFlag(parsed.flags.concept);
  const strategyConfirm = parsed.flags['strategy-confirm'] === true;
  const noDistill = parsed.flags['no-distill'] === true;

  const modeCount = [quick, guided, concept !== undefined].filter(Boolean).length;
  if (modeCount === 0) {
    throw new AuthorOsError([
      'author init requires one of:',
      '  --quick                       use template defaults only (skip model setup)',
      '  --concept "<one-line idea>"   let book-setup-editor expand a concept into the 6 identity files',
      '  --guided                      interactive Q&A; build identity files by section',
      'Run `author init --help` for details.',
    ].join('\n'));
  }
  if (modeCount > 1) {
    throw new AuthorOsError('Use only one of --quick, --concept, --guided.');
  }

  const env = options.env ?? process.env;
  const authorDir = resolveAuthorDir(undefined, env);
  const result = await initProject({ projectName, template, cwd, targetDir, authorDir, force });

  let setupOutput: string | null = null;
  if (concept !== undefined) {
    const llm = options.llm ?? await createWritingClient(result.targetDir, env);
    const setupResult = await setupFromConcept({
      projectDir: result.targetDir,
      projectName: result.projectName,
      template: result.template,
      authorDir,
      concept,
      llm,
      ask: options.ask ?? defaultReadlineAsk,
      io,
      strategyConfirm,
      noDistill,
    });
    setupOutput = renderSetupResult(setupResult);
  } else if (guided) {
    const llm = options.llm ?? await createWritingClient(result.targetDir, env);
    const ask = options.ask ?? defaultReadlineAsk;
    const setupResult = await setupGuided({
      projectDir: result.targetDir,
      projectName: result.projectName,
      template: result.template,
      authorDir,
      llm,
      ask,
      io,
      noDistill,
    });
    setupOutput = renderSetupResult(setupResult);
  }

  const lines = [
    `Created AuthorOS project: ${result.projectName}`,
    `Path: ${result.targetDir}`,
    `Template (reference): ${result.template}`,
    `Mode: ${quick ? 'quick (template defaults)' : guided ? 'guided' : 'concept'}`,
  ];
  if (setupOutput) {
    lines.push('');
    lines.push(setupOutput.trimEnd());
  }
  lines.push('');
  lines.push('Next:');
  lines.push(`  cd "${result.targetDir}"`);
  if (quick) {
    lines.push('  # NOTE: identity files are template defaults. Edit them or rerun with --concept/--guided.');
  } else {
    lines.push('  author brief        # view product.md');
    lines.push('  author profile      # view author.md');
    lines.push('  author plan --chapter 1 --model --write');
  }
  lines.push('');
  io.stdout(lines.join('\n'));
  return 0;
}

async function runAuthor(args: string[], io: Io, options: RunOptions): Promise<number> {
  const [subcommand = 'show', ...rest] = args;
  const env = options.env ?? process.env;

  if (subcommand === '--help' || subcommand === '-h') {
    io.stdout(authorHelpText());
    return 0;
  }

  const parsed = parseArgs(rest);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(authorHelpText());
    return 0;
  }
  const dir = stringFlag(parsed.flags.dir) ?? stringFlag(parsed.flags['author-dir']);

  if (subcommand === 'init') {
    io.stdout(renderAuthorInitResult(await initAuthorDirectory({
      dir,
      force: parsed.flags.force === true,
      env,
    })));
    return 0;
  }

  if (subcommand === 'show') {
    io.stdout(renderAuthorShowResult(getAuthorShow(dir, env)));
    return 0;
  }

  if (subcommand === 'doctor') {
    io.stdout(renderAuthorDoctorResult(await getAuthorDoctor(dir, env)));
    return 0;
  }

  if (subcommand === 'edit-profile') {
    io.stdout(renderEditProfileResult(await openAuthorProfile(dir, env)));
    return 0;
  }

  throw new AuthorOsError(`Unknown author subcommand: ${subcommand}`);
}

async function defaultReadlineAsk(prompt: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function runModel(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const [subcommand = 'config', ...rest] = args;
  const env = options.env ?? process.env;

  if (subcommand === '--help' || subcommand === '-h') {
    io.stdout(modelHelpText());
    return 0;
  }

  if (subcommand === 'config') {
    return await runModelConfig(rest, cwd, io, env);
  }

  if (subcommand === 'doctor') {
    return await runModelDoctor(rest, cwd, io, env);
  }

  if (subcommand === 'smoke') {
    return await runModelSmokeCommand(rest, cwd, io, options, env);
  }

  throw new AuthorOsError(`Unknown model subcommand: ${subcommand}`);
}

async function runModelConfig(args: string[], cwd: string, io: Io, env: EnvLike): Promise<number> {
  const [action = 'show', ...rest] = args;

  if (action === '--help' || action === '-h') {
    io.stdout(modelConfigHelpText());
    return 0;
  }

  if (action === 'show') {
    io.stdout(renderModelConfig(await getModelConfig(cwd, env)));
    return 0;
  }

  if (action === 'set') {
    const parsed = parseArgs(rest);
    if (parsed.flags.help || parsed.flags.h) {
      io.stdout(modelConfigHelpText());
      return 0;
    }

    io.stdout(renderModelConfigUpdated(await updateModelConfig(cwd, {
      apiKeyEnv: stringFlag(parsed.flags['api-key-env']),
      baseUrl: stringFlag(parsed.flags['base-url']),
      model: stringFlag(parsed.flags.model),
    })));
    return 0;
  }

  if (action === 'reset') {
    io.stdout(renderModelConfigReset(await clearModelConfig(cwd)));
    return 0;
  }

  throw new AuthorOsError(`Unknown model config action: ${action}`);
}

async function runModelDoctor(args: string[], cwd: string, io: Io, env: EnvLike): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(modelDoctorHelpText());
    return 0;
  }

  io.stdout(renderModelDoctor(await getModelDoctor(cwd, env)));
  return 0;
}

async function runModelSmokeCommand(
  args: string[],
  cwd: string,
  io: Io,
  options: RunOptions,
  env: EnvLike,
): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(modelSmokeHelpText());
    return 0;
  }

  const llm = options.llm ?? await createWritingClient(cwd, env);

  try {
    io.stdout(renderModelSmokeResult(await runModelSmoke(cwd, llm, env)));
    return 0;
  } catch (error) {
    if (error instanceof AuthorOsError) {
      throw error;
    }
    throw new AuthorOsError(`Model smoke failed. ${errorMessage(error)}`);
  }
}

async function runPlan(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(planHelpText());
    return 0;
  }

  if (parsed.positionals[0] === 'status') {
    io.stdout(renderPlanStatus(await getPlanStatus(cwd)));
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  const next = parsed.flags.next === true;

  if (chapter === undefined && !next) {
    throw new AuthorOsError('author plan requires --chapter <N> or --next.');
  }

  if (chapter !== undefined && next) {
    throw new AuthorOsError('Use either --chapter or --next, not both.');
  }

  const env = options.env ?? process.env;
  const useModel = parsed.flags.model === true;
  const llm = useModel ? options.llm ?? await createWritingClient(cwd, env) : undefined;

  io.stdout(renderPlanResult(await createChapterPlan(cwd, {
    chapter,
    next,
    llm,
    now: options.now,
    write: parsed.flags.write === true,
  })));
  return 0;
}

async function runState(args: string[], cwd: string, io: Io): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(stateHelpText());
    return 0;
  }

  io.stdout(renderProjectState(await getProjectState(cwd)));
  return 0;
}

async function runBrief(args: string[], cwd: string, io: Io): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(briefHelpText());
    return 0;
  }

  io.stdout(renderIdentityFile(await getProductBrief(cwd)));
  return 0;
}

async function runProfile(args: string[], cwd: string, io: Io): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(profileHelpText());
    return 0;
  }

  io.stdout(renderIdentityFile(await getAuthorProfile(cwd)));
  return 0;
}

async function runWrite(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(writeHelpText());
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  const next = parsed.flags.next === true;
  if (chapter === undefined && !next) {
    throw new AuthorOsError('author write requires --chapter <N> or --next.');
  }
  if (chapter !== undefined && next) {
    throw new AuthorOsError('Use either --chapter or --next, not both.');
  }

  const env = options.env ?? process.env;
  const useModel = parsed.flags.model === true;
  const llm = useModel ? options.llm ?? await createWritingClient(cwd, env) : undefined;

  io.stdout(renderWriteResult(await createChapterDraft(cwd, {
    chapter,
    next,
    llm,
    now: options.now,
    write: parsed.flags.write === true,
  })));
  return 0;
}

async function runReview(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(reviewHelpText());
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  if (chapter === undefined) {
    throw new AuthorOsError('author review requires --chapter <N>.');
  }

  const modeFlag = stringFlag(parsed.flags.mode) ?? 'internal';
  if (modeFlag !== 'internal' && modeFlag !== 'reader-sim' && modeFlag !== 'all') {
    throw new AuthorOsError('--mode must be one of: internal, reader-sim, all.');
  }
  const mode = modeFlag as ReviewMode;

  const env = options.env ?? process.env;
  const useModel = parsed.flags.model === true;
  const llm = useModel ? options.llm ?? await createWritingClient(cwd, env) : undefined;

  io.stdout(renderReviewResult(await createChapterReview(cwd, {
    chapter,
    mode,
    llm,
    now: options.now,
    write: parsed.flags.write === true,
  })));
  return 0;
}

async function runRevise(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(reviseHelpText());
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  if (chapter === undefined) {
    throw new AuthorOsError('author revise requires --chapter <N>.');
  }

  const env = options.env ?? process.env;
  const useModel = parsed.flags.model === true;
  const llm = useModel ? options.llm ?? await createWritingClient(cwd, env) : undefined;

  io.stdout(renderReviseResult(await reviseChapter(cwd, {
    chapter,
    llm,
    now: options.now,
    write: parsed.flags.write === true,
    instruction: stringFlag(parsed.flags.instruction),
  })));
  return 0;
}

async function runFeedback(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(feedbackHelpText());
    return 0;
  }

  if (subcommand === 'import') {
    return await runFeedbackImport(rest, cwd, io, options);
  }
  if (subcommand === 'analyze') {
    return await runFeedbackAnalyze(rest, cwd, io, options);
  }
  throw new AuthorOsError(`Unknown feedback subcommand: ${subcommand}`);
}

async function runFeedbackImport(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(feedbackHelpText());
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  if (chapter === undefined) {
    throw new AuthorOsError('author feedback import requires --chapter <N>.');
  }
  const inputPath = parsed.positionals[0];
  if (!inputPath) {
    throw new AuthorOsError('author feedback import requires an input file path.');
  }

  io.stdout(renderFeedbackImportResult(await importFeedback(cwd, {
    chapter,
    inputPath,
    cwd,
    now: options.now,
  })));
  return 0;
}

async function runFeedbackAnalyze(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(feedbackHelpText());
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  if (chapter === undefined) {
    throw new AuthorOsError('author feedback analyze requires --chapter <N>.');
  }

  const env = options.env ?? process.env;
  const useModel = parsed.flags.model === true;
  const llm = useModel ? options.llm ?? await createWritingClient(cwd, env) : undefined;

  io.stdout(renderFeedbackAnalyzeResult(await analyzeFeedback(cwd, {
    chapter,
    llm,
    now: options.now,
    write: parsed.flags.write === true,
  })));
  return 0;
}

async function runDecide(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(decideHelpText());
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  if (chapter === undefined) {
    throw new AuthorOsError('author decide requires --chapter <N>.');
  }

  const env = options.env ?? process.env;
  const useModel = parsed.flags.model === true;
  const llm = useModel ? options.llm ?? await createWritingClient(cwd, env) : undefined;

  io.stdout(renderDecideResult(await createChapterDecision(cwd, {
    chapter,
    llm,
    now: options.now,
    write: parsed.flags.write === true,
  })));
  return 0;
}

async function runMemory(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(memoryHelpText());
    return 0;
  }

  if (subcommand !== 'update') {
    throw new AuthorOsError(`Unknown memory subcommand: ${subcommand}`);
  }

  const parsed = parseArgs(rest);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(memoryHelpText());
    return 0;
  }

  const chapter = optionalPositiveIntegerFlag(parsed.flags.chapter, 'chapter');
  if (chapter === undefined) {
    throw new AuthorOsError('author memory update requires --chapter <N>.');
  }

  const env = options.env ?? process.env;
  const useModel = parsed.flags.model === true;
  const llm = useModel ? options.llm ?? await createWritingClient(cwd, env) : undefined;

  io.stdout(renderMemoryUpdateResult(await createMemoryUpdate(cwd, {
    chapter,
    llm,
    now: options.now,
    write: parsed.flags.write === true,
  })));
  return 0;
}

async function runSkill(args: string[], io: Io): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(skillHelpText());
    return 0;
  }

  if (subcommand !== 'install') {
    throw new AuthorOsError(`Unknown skill subcommand: ${subcommand}`);
  }

  const parsed = parseArgs(rest);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(skillHelpText());
    return 0;
  }

  const targetDir = stringFlag(parsed.flags.dir);
  const force = parsed.flags.force === true;

  io.stdout(renderSkillInstallResult(await installSkill({ targetDir, force })));
  return 0;
}

async function runTemplate(args: string[], io: Io, options: RunOptions): Promise<number> {
  const [subcommand = 'list', ...rest] = args;
  const env = options.env ?? process.env;

  if (subcommand === '--help' || subcommand === '-h') {
    io.stdout(templateHelpText());
    return 0;
  }

  const parsed = parseArgs(rest);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(templateHelpText());
    return 0;
  }
  const dir = stringFlag(parsed.flags.dir) ?? stringFlag(parsed.flags['author-dir']);

  if (subcommand === 'list') {
    io.stdout(renderTemplateList(await listTemplates(dir, env)));
    return 0;
  }

  const key = parsed.positionals[0];
  if (!key) {
    throw new AuthorOsError(`author template ${subcommand} requires a template key.`);
  }

  if (subcommand === 'show') {
    io.stdout(renderTemplateShow(await showTemplate(key, dir, env)));
    return 0;
  }

  if (subcommand === 'promote') {
    io.stdout(renderTemplatePromote(await promoteTemplate(key, dir, env)));
    return 0;
  }

  if (subcommand === 'forget') {
    io.stdout(renderTemplateForget(await forgetTemplate(key, dir, env)));
    return 0;
  }

  if (subcommand === 'export') {
    const outputFile = parsed.positionals[1];
    if (!outputFile) {
      throw new AuthorOsError('author template export requires an output file path.');
    }
    io.stdout(renderTemplateExport(await exportTemplate(key, outputFile, dir, env)));
    return 0;
  }

  throw new AuthorOsError(`Unknown template subcommand: ${subcommand}`);
}

async function runConsole(args: string[], cwd: string, io: Io, options: RunOptions): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.flags.help || parsed.flags.h) {
    io.stdout(consoleHelpText());
    return 0;
  }

  const scope = optionalConsoleScope(stringFlag(parsed.flags.scope));
  const env = options.env ?? process.env;

  const rollbackId = stringFlag(parsed.flags.rollback);
  if (rollbackId) {
    io.stdout(renderConsoleRollback(await rollbackConsoleChange(cwd, rollbackId, {
      scope,
      env,
      now: options.now,
    })));
    return 0;
  }
  if (parsed.flags.rollback === true) {
    throw new AuthorOsError('author console --rollback requires a change id.');
  }
  if (parsed.positionals[0] === 'log') {
    io.stdout(renderConsoleLog(await getConsoleChanges(cwd, { scope, env })));
    return 0;
  }

  const positionals = [...parsed.positionals];
  if (typeof parsed.flags.write === 'string') {
    positionals.unshift(parsed.flags.write);
    parsed.flags.write = true;
  }
  if (typeof parsed.flags['dry-run'] === 'string') {
    positionals.unshift(parsed.flags['dry-run']);
    parsed.flags['dry-run'] = true;
  }
  if (parsed.flags.write === true && parsed.flags['dry-run'] === true) {
    throw new AuthorOsError('Use either --write or --dry-run, not both.');
  }
  const llm = options.llm ?? await createWritingClient(cwd, env);
  const instruction = positionals.join(' ').trim();

  if (!instruction) {
    await runConsoleRepl(cwd, {
      llm,
      env,
      scope,
      ask: options.ask ?? defaultReadlineAsk,
      io,
    });
    return 0;
  }

  io.stdout(renderConsoleDryRun(await runConsoleOneShot(cwd, {
    instruction,
    llm,
    env,
    now: options.now,
    scope,
    write: parsed.flags.write === true,
  })));
  return 0;
}

function optionalConsoleScope(value: string | undefined): ConsoleScope | undefined {
  if (value === undefined) return undefined;
  if (value === 'book' || value === 'author' || value === 'both') return value;
  throw new AuthorOsError('--scope must be one of: author, book, both.');
}

function optionalPositiveIntegerFlag(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === true) {
    throw new AuthorOsError(`--${name} requires a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AuthorOsError(`--${name} must be a positive integer.`);
  }
  return parsed;
}

async function createWritingClient(cwd: string, env: EnvLike): Promise<LlmClient> {
  try {
    return await createOpenAiCompatibleClientFromProject(cwd, env);
  } catch (error) {
    if (error instanceof Error) {
      throw new AuthorOsError(
        `${error.message} Configure with: author model config set --model <name>; author model config set --api-key-env <ENV>.`,
      );
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--') {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      const key = rawKey.trim();

      if (!key) {
        throw new AuthorOsError(`Invalid flag: ${arg}`);
      }

      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
        continue;
      }

      const next = args[index + 1];
      if (next && !next.startsWith('-') && key !== 'force') {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }

      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const shortFlags = arg.slice(1).split('');
      for (const flag of shortFlags) {
        flags[flag] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function helpText(): string {
  return [
    'AuthorOS CLI',
    '',
    'Usage:',
    '  author init <project-name> [--template <key>] [--dir path] [--force]',
    '  author author init | show | doctor | edit-profile',
    '  author model config | doctor | smoke',
    '  author state | brief | profile',
    '  author plan --chapter <N> | --next [--model] [--write]',
    '  author write --chapter <N> | --next [--model] [--write]',
    '  author review --chapter <N> [--mode internal|reader-sim|all] [--model] [--write]',
    '  author revise --chapter <N> [--model] [--write]',
    '  author feedback import --chapter <N> <input-file>',
    '  author feedback analyze --chapter <N> [--model] [--write]',
    '  author decide --chapter <N> [--model] [--write]',
    '  author memory update --chapter <N> [--model] [--write]',
    '  author template list | show | promote | forget | export',
    '  author console ["instruction"] [--dry-run] [--write] [--scope author|book|both]',
    '  author skill install [--dir <skills-root>] [--force]',
    '',
    'Creative loop:',
    '  brief / profile -> plan -> write -> review -> revise -> feedback (optional) -> decide -> memory update',
    '',
    'Commands:',
    '  init       Create a single-book AuthorOS project',
    '  author     Manage the author-level AuthorOS directory',
    '  model      Configure and verify the model provider',
    '  state      Show per-chapter artifact progress',
    '  brief      Print product.md (作品定位)',
    '  profile    Print author.md (作者人格)',
    '  plan       Generate a chapter plan (planner)',
    '  write      Draft a chapter (chief-writer)',
    '  review     Run internal review (4 advisors + editor) and/or 5 simulated readers',
    '  revise     chief-writer judges review; applies surgical changes only if needed',
    '  feedback   Import and analyze real reader feedback',
    '  decide     Produce the weighted creative decision report (decider)',
    '  memory     Emit typed memory delta proposals (memory-curator)',
    '  template   Manage seed and author-level templates',
    '  console    Author control seat for shape edits through a 4-block diff protocol',
    '  skill      Install the bundled Claude Code skill (SKILL.md)',
    '',
  ].join('\n');
}

function authorHelpText(): string {
  return [
    'Manage the author-level AuthorOS directory.',
    '',
    'Usage:',
    '  author author init [--dir <path>] [--force]',
    '  author author show [--dir <path>]',
    '  author author doctor [--dir <path>]',
    '  author author edit-profile [--dir <path>]',
    '',
    'Options:',
    '  --dir <path>        Author directory. Default: AUTHOROS_AUTHOR_DIR or ~/.authoros',
    '  --author-dir <path> Alias for --dir',
    '  --force             Allow init into an existing non-empty directory',
    '',
  ].join('\n');
}

function skillHelpText(): string {
  return [
    'Install the bundled AuthorOS skill into Claude Code.',
    '',
    'Usage:',
    '  author skill install',
    '  author skill install --dir <skills-root>',
    '  author skill install --force',
    '',
    'Default target: <home>/.claude/skills/authoros/SKILL.md',
    '',
    'Options:',
    '  --dir <path>   Override the skills root (default: ~/.claude/skills)',
    '  --force        Overwrite an existing SKILL.md even if it differs',
    '',
    'Restart Claude Code after install for the skill to register.',
    '',
  ].join('\n');
}

function templateHelpText(): string {
  return [
    'Manage seed and author-level templates.',
    '',
    'Usage:',
    '  author template list',
    '  author template show <key>',
    '  author template promote <key>',
    '  author template forget <key>',
    '  author template export <key> <file.zip>',
    '',
    'Options:',
    '  --dir <path>        Author directory. Default: AUTHOROS_AUTHOR_DIR or ~/.authoros',
    '  --author-dir <path> Alias for --dir',
    '',
  ].join('\n');
}

function consoleHelpText(): string {
  return [
    'Author control console (author-console agent).',
    '',
    'Usage:',
    '  author console',
    '  author console "change product positioning"',
    '  author console --dry-run "change product positioning"',
    '  author console --write "change product positioning"',
    '  author console --scope author|book|both "change shape"',
    '',
    'One-shot defaults to dry-run. --write applies the returned unified diff and writes a changes/ snapshot record.',
    'REPL prompts for apply / edit / abort / drill <file> after each model proposal.',
    '',
  ].join('\n');
}

function stateHelpText(): string {
  return [
    'Show per-chapter artifact progress.',
    '',
    'Usage:',
    '  author state',
    '',
    'Scans plans/, chapters/, reviews/, feedback/, decisions/ and reports',
    'which stages have been produced for each chapter, plus the next chapter',
    'pending for plan / draft / decision.',
    '',
  ].join('\n');
}

function briefHelpText(): string {
  return [
    'Print the current product.md (作品定位) for this book.',
    '',
    'Usage:',
    '  author brief',
    '',
    'Edit product.md directly to change positioning; agents read it on every model call.',
    '',
  ].join('\n');
}

function profileHelpText(): string {
  return [
    'Print the current author.md (作者人格) for this book.',
    '',
    'Usage:',
    '  author profile',
    '',
    'Edit author.md directly to change author preferences; agents read it on every model call.',
    '',
  ].join('\n');
}

function planHelpText(): string {
  return [
    'Plan the next chapter (planner agent).',
    '',
    'Usage:',
    '  author plan --chapter 1',
    '  author plan --chapter 1 --model --write',
    '  author plan --next --model --write',
    '  author plan status',
    '',
    'Options:',
    '  --chapter <N>      Plan a specific chapter number',
    '  --next             Plan the next chapter without a plan file yet',
    '  --model            Ask the configured model to write the plan',
    '  --write            Save to plans/NNNN.md instead of printing only',
    '',
    'Without --model, the command prints a scaffold so structure can be reviewed before paying for tokens.',
    '',
  ].join('\n');
}

function initHelpText(): string {
  return [
    'Create a single-book AuthorOS project. Pick exactly one of --quick / --concept / --guided.',
    '',
    'Usage:',
    '  author init "我的小说" --concept "都市异能,主角是数据分析师,能力是回溯..."',
    '  author init "我的小说" --guided',
    '  author init "我的小说" --quick                # template defaults only',
    '  author init demo --dir ./demo --quick',
    '',
    'Modes:',
    '  --quick                       Use template defaults for product/author/world/outline/characters/review_rules.',
    '                                Edit the files manually afterward.',
    '  --concept "<text>"            book-setup-editor expands the concept into all 6 identity files in one batch.',
    '                                Requires a configured model (OPENAI_API_KEY + AUTHOROS_MODEL).',
    '  --guided                      Interactive Q&A. book-setup-editor asks one question per section;',
    '                                you can answer, or type 你建议 / 跳过 / 暂定.',
    '                                Requires a configured model and an interactive terminal.',
    '',
    'Options:',
    '  --template <name>             Template key (default: urban_power_anomaly). Templates are reference structure,',
    '                                not canonical content (except in --quick mode).',
    '                                Supported: urban_power_anomaly, xianxia, western_fantasy, mystery_thriller,',
    '                                sci_fi, rules_horror, wuxia, dog_blood_romance, system_literature,',
    '                                apocalypse, period_drama, campus_realism',
    '  --dir <path>                  Target directory. Defaults to the project name.',
    '  --strategy-confirm           Print setup strategy and ask before generating identity files.',
    '  --no-distill                  Skip candidate template extraction after concept/guided setup.',
    '  --force                       Allow writing into an existing non-empty directory.',
    '',
  ].join('\n');
}

function modelHelpText(): string {
  return [
    'Configure and verify the model provider for this AuthorOS book.',
    '',
    'Usage:',
    '  author model config',
    '  author model config set --base-url https://api.openai.com/v1 --model <name>',
    '  author model config set --api-key-env AUTHOROS_API_KEY',
    '  author model config reset',
    '  author model doctor',
    '  author model smoke',
    '',
  ].join('\n');
}

function modelConfigHelpText(): string {
  return [
    'View or update the project model provider config.',
    '',
    'Usage:',
    '  author model config',
    '  author model config show',
    '  author model config set --base-url https://api.openai.com/v1 --model <name>',
    '  author model config set --api-key-env AUTHOROS_API_KEY',
    '  author model config reset',
    '',
    'Options:',
    '  --api-key-env <name>  Environment variable that stores the API key. Default: OPENAI_API_KEY',
    '  --base-url <url>      OpenAI-compatible base URL. Default: OPENAI_BASE_URL or https://api.openai.com/v1',
    '  --model <name>        Default model. Default: AUTHOROS_MODEL or OPENAI_MODEL',
    '',
    'The API key VALUE is never stored. Keep it in the shell environment.',
    '',
  ].join('\n');
}

function modelDoctorHelpText(): string {
  return [
    'Check model connection readiness without calling the network.',
    '',
    'Usage:',
    '  author model doctor',
    '',
    'Reports api key env status, base URL, model, and any blockers.',
    '',
  ].join('\n');
}

function modelSmokeHelpText(): string {
  return [
    'Run a tiny live model smoke test by pinging the chief-writer agent.',
    '',
    'Usage:',
    '  author model smoke',
    '',
    'Requires a configured model and a reachable API. See `author model doctor`.',
    '',
  ].join('\n');
}

function writeHelpText(): string {
  return [
    'Draft a chapter (chief-writer).',
    '',
    'Usage:',
    '  author write --chapter 1',
    '  author write --chapter 1 --model --write',
    '  author write --next --model --write',
    '',
    'Requires plans/NNNN.md (run author plan first).',
    '',
    'Options:',
    '  --chapter <N>      Draft a specific chapter',
    '  --next             Draft the smallest chapter that has a plan but no draft',
    '  --model            Ask the configured model to draft',
    '  --write            Save to chapters/NNNN.md',
    '',
  ].join('\n');
}

function reviewHelpText(): string {
  return [
    'Review a chapter draft.',
    '',
    'Usage:',
    '  author review --chapter 1 --mode internal',
    '  author review --chapter 1 --mode reader-sim',
    '  author review --chapter 1 --mode all --model --write',
    '',
    'Modes:',
    '  internal      world / character / plot / style advisors + editor synthesis',
    '                -> reviews/NNNN.internal.md',
    '  reader-sim    5 simulated reader personas from .authoros/readers.yaml',
    '                -> reviews/NNNN.reader-sim.md',
    '  all           run both (default if you forget --mode? no, must pass)',
    '',
    'Options:',
    '  --chapter <N>      Required. Chapter to review.',
    '  --mode <name>      internal | reader-sim | all. Default: internal.',
    '  --model            Ask the configured model for each agent step',
    '  --write            Save the review file(s)',
    '',
  ].join('\n');
}

function reviseHelpText(): string {
  return [
    'chief-writer judges the review and applies surgical changes if needed.',
    '',
    'Usage:',
    '  author revise --chapter 1 --model --write',
    '',
    'Requires chapters/NNNN.md and reviews/NNNN.internal.md.',
    'Optional: reviews/NNNN.reader-sim.md (used if present).',
    '',
    'Behavior:',
    '  - chief-writer decides REVISION_NEEDED: yes | no based on review.',
    '  - "no" -> chapter unchanged, rationale logged.',
    '  - "yes" -> chapter rewritten with constraints (>=80% verbatim, no new plot beats);',
    '            original draft backed up to chapters/NNNN.draft.md (only on first revision).',
    '  - chapters/NNNN.md is always the canonical version; decide / memory read it.',
    '',
    'Options:',
    '  --chapter <N>      Required',
    '  --model            Required to actually decide; without --model the step is a no-op stub',
    '  --write            Apply changes (move backup, overwrite chapter file)',
    '  --instruction <t>   Force a directive-driven revision; internal review becomes supplementary',
    '',
  ].join('\n');
}

function feedbackHelpText(): string {
  return [
    'Import or analyze real reader feedback.',
    '',
    'Usage:',
    '  author feedback import --chapter 1 path/to/feedback.txt',
    '  author feedback analyze --chapter 1 --model --write',
    '',
    'import:  each non-empty line of the input file becomes one feedback entry;',
    '         results append to feedback/NNNN.raw.jsonl as {"chapter","text","received"}.',
    '',
    'analyze: feedback-analyzer reads the JSONL + chapter and emits',
    '         feedback/NNNN.analysis.md classified into 高频 / 情绪 / 有效 /',
    '         噪声 / 误读 / 待验证 / 不应迎合.',
    '',
    'Options:',
    '  --chapter <N>      Required.',
    '  --model            (analyze only) Ask the configured model for classification',
    '  --write            (analyze only) Save the analysis file',
    '',
  ].join('\n');
}

function decideHelpText(): string {
  return [
    'Produce the weighted creative decision (decider).',
    '',
    'Usage:',
    '  author decide --chapter 1 --model --write',
    '',
    'Requires chapters/NNNN.md, reviews/NNNN.internal.md, reviews/NNNN.reader-sim.md.',
    'Optional: feedback/NNNN.analysis.md (counted at 20% if present, skipped otherwise).',
    '',
    'Default weights (in .authoros/weights.yaml):',
    '  作者长期规划 40 / 内部评审 30 / 模拟读者 10 / 真实反馈 20',
    '',
    'Options:',
    '  --chapter <N>      Required',
    '  --model            Use the configured model',
    '  --write            Save to decisions/NNNN.md',
    '',
  ].join('\n');
}

function memoryHelpText(): string {
  return [
    'Emit typed memory delta proposals (memory-curator).',
    '',
    'Usage:',
    '  author memory update --chapter 1 --model --write',
    '',
    'Outputs memory/chapter-NNNN.delta.md with proposed changes to:',
    '  canon / foreshadowing / plot_threads / character_state / style',
    '',
    'The delta file is a proposal; you merge changes into memory/* manually.',
    'AuthorOS v1 intentionally does not auto-edit canon or YAMLs.',
    '',
    'Options:',
    '  --chapter <N>      Required',
    '  --model            Use the configured model',
    '  --write            Save the delta file',
    '',
  ].join('\n');
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;

if (entryUrl === import.meta.url) {
  process.exitCode = await run();
}
