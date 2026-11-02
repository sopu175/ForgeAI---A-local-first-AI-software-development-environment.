import { promises as fs } from 'node:fs';
import path from 'node:path';
import { compactFileTree, packRetrievalResults, parseTasksMarkdown, serializeTasksMarkdown } from '@forgeai/core';
import type { ChatMessage, ProjectStack, RuleFile, SpecDocument, SpecMeta, SpecPhase, SpecTask } from '@forgeai/shared';
import { estimateTokens } from '@forgeai/shared';
import type { Database } from '../db';
import type { IndexerService } from '../services/indexer';
import type { ProvidersService } from '../services/providers';
import type { SearchService } from '../services/search';
import type { SettingsService } from '../services/settings';
import type { Broadcast, WorkspaceService } from '../services/workspace';
import type { SpecUpdateHook } from '../agent/runtime';
import { SPEC_SYSTEM_PROMPT } from '../agent/prompts';
import { buildDesignPrompt, buildRequirementsPrompt, buildTasksPrompt, type SpecPromptInput } from './prompts';

const FEATURE_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const DOC_PARTS = ['requirements', 'design', 'tasks'] as const;
type DocPart = (typeof DOC_PARTS)[number];

export class SpecService implements SpecUpdateHook {
  constructor(
    private readonly db: Database,
    private readonly workspace: WorkspaceService,
    private readonly providers: ProvidersService,
    private readonly settings: SettingsService,
    private readonly indexer: IndexerService,
    private readonly search: SearchService,
    private readonly broadcast: Broadcast,
  ) {}

  private assertFeature(feature: string): void {
    if (!FEATURE_RE.test(feature)) {
      throw new Error('Feature names must use lowercase letters, numbers, dash or underscore (max 64 chars)');
    }
  }

  private featureDir(feature: string): string {
    this.assertFeature(feature);
    return path.join(this.workspace.root, '.kiro', 'specs', feature);
  }

  private async readDocFile(feature: string, file: string): Promise<string> {
    try {
      return await fs.readFile(path.join(this.featureDir(feature), file), 'utf8');
    } catch {
      return '';
    }
  }

  private async writeDocFile(feature: string, file: string, content: string): Promise<void> {
    const dir = this.featureDir(feature);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, file), content, 'utf8');
  }

  private async saveMeta(meta: SpecMeta): Promise<void> {
    meta.updatedAt = Date.now();
    this.db.saveSpecMeta(this.workspace.projectId, meta);
    await this.writeDocFile(meta.feature, 'spec.json', JSON.stringify(meta, null, 2));
    this.broadcast('spec:changed', { projectId: this.workspace.projectId, feature: meta.feature });
  }

  private async loadMeta(feature: string): Promise<SpecMeta | undefined> {
    const raw = await this.readDocFile(feature, 'spec.json');
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as SpecMeta;
        if (parsed.feature === feature) return parsed;
      } catch {
        // fall through to DB
      }
    }
    return this.db.getSpecMeta(this.workspace.projectId, feature);
  }

  async list(): Promise<SpecDocument[]> {
    const specsRoot = path.join(this.workspace.root, '.kiro', 'specs');
    let entries: string[] = [];
    try {
      entries = await fs.readdir(specsRoot);
    } catch {
      return [];
    }
    const docs: SpecDocument[] = [];
    for (const feature of entries) {
      if (!FEATURE_RE.test(feature)) continue;
      try {
        docs.push(await this.get(feature));
      } catch {
        // ignore corrupt spec directories
      }
    }
    return docs.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  }

  async get(feature: string): Promise<SpecDocument> {
    const meta = await this.loadMeta(feature);
    const [requirements, design, tasksMd] = await Promise.all([
      this.readDocFile(feature, 'requirements.md'),
      this.readDocFile(feature, 'design.md'),
      this.readDocFile(feature, 'tasks.md'),
    ]);
    if (!meta) {
      const now = Date.now();
      const fallback: SpecMeta = {
        feature,
        title: titleCase(feature),
        description: '',
        phase: design ? 'design' : requirements ? 'requirements' : 'requirements',
        approvals: { requirements: Boolean(requirements), design: Boolean(design), tasks: false },
        tasks: parseTasksMarkdown(tasksMd),
        createdAt: now,
        updatedAt: now,
      };
      await this.saveMeta(fallback);
      return { meta: fallback, requirements, design, tasks: tasksMd };
    }
    if (meta.tasks.length === 0 && tasksMd.trim()) {
      meta.tasks = parseTasksMarkdown(tasksMd);
    }
    return { meta, requirements, design, tasks: tasksMd };
  }

  async create(feature: string, description: string): Promise<SpecDocument> {
    this.assertFeature(feature);
    const existing = await this.loadMeta(feature);
    if (existing) throw new Error(`Spec "${feature}" already exists`);
    const now = Date.now();
    const meta: SpecMeta = {
      feature,
      title: titleCase(feature),
      description,
      phase: 'requirements',
      approvals: { requirements: false, design: false, tasks: false },
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };
    const requirements = `# ${meta.title}\n\n> Draft requirements for: ${description}\n\nRun **Generate requirements** to let the local model turn this into a structured specification.\n`;
    const design = `# Design: ${meta.title}\n\n> Generated after requirements are approved.\n`;
    const tasks = `# Implementation Tasks\n\n> Generated after the design is approved.\n`;
    await this.writeDocFile(feature, 'requirements.md', requirements);
    await this.writeDocFile(feature, 'design.md', design);
    await this.writeDocFile(feature, 'tasks.md', tasks);
    await this.saveMeta(meta);
    return { meta, requirements, design, tasks };
  }

  async updatePart(feature: string, part: DocPart, content: string): Promise<SpecDocument> {
    if (!DOC_PARTS.includes(part)) throw new Error('Invalid document part');
    const doc = await this.get(feature);
    await this.writeDocFile(feature, `${part}.md`, content);
    const meta = doc.meta;
    meta.approvals[part] = false;
    if (part === 'requirements') {
      meta.approvals.design = false;
      meta.approvals.tasks = false;
      meta.phase = 'requirements';
    } else if (part === 'design') {
      meta.approvals.tasks = false;
      meta.phase = 'design';
    } else {
      meta.phase = 'tasks';
      meta.tasks = parseTasksMarkdown(content);
    }
    await this.saveMeta(meta);
    return {
      ...doc,
      meta,
      [part === 'requirements' ? 'requirements' : part === 'design' ? 'design' : 'tasks']: content,
    };
  }

  async generate(feature: string, phase: SpecPhase): Promise<SpecDocument> {
    if (phase !== 'requirements' && phase !== 'design' && phase !== 'tasks') {
      throw new Error('Spec generation supports requirements, design and tasks phases');
    }
    const doc = await this.get(feature);
    const meta = doc.meta;
    const binding = await this.providers.resolveRole('plan');
    const provider = this.providers.build(binding.providerId);
    const [rules, stack, files] = await Promise.all([
      this.workspace.loadRules().catch((): RuleFile[] => []),
      this.workspace.getStack().catch((): ProjectStack => ({
        languages: [],
        frameworks: [],
        packageManagers: [],
        testRunners: [],
        hasGit: false,
        entryPoints: [],
      })),
      this.search.files('', 200).catch((): string[] => []),
    ]);
    const retrieved = await this.indexer
      .search(this.workspace.projectId, `${meta.title} ${meta.description}`, 8)
      .catch(() => []);
    const context = packRetrievalResults(retrieved, 3000, 8);
    const input: SpecPromptInput = {
      feature: meta.feature,
      title: meta.title,
      description: meta.description,
      phase,
      stack,
      rules,
      context,
      tree: compactFileTree(files, 180),
      requirements: doc.requirements,
      design: doc.design,
    };
    const userPrompt =
      phase === 'requirements'
        ? buildRequirementsPrompt(input)
        : phase === 'design'
          ? buildDesignPrompt(input)
          : buildTasksPrompt(input);
    const messages: ChatMessage[] = [
      { role: 'system', content: SPEC_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
    const providerConfig = this.providers.list().find((item) => item.id === binding.providerId);
    const started = Date.now();
    let text = '';
    let reasoning = '';
    let promptTokens = 0;
    let outputTokens = 0;
    const controller = new AbortController();
    for await (const delta of provider.chat(
      {
        providerId: binding.providerId,
        model: binding.model,
        messages,
        temperature: 0.2,
        maxTokens: 4096,
        contextLength: providerConfig?.config.contextLength ?? 8192,
      },
      controller.signal,
    )) {
      if (delta.type === 'text') text += delta.text;
      else if (delta.type === 'reasoning') reasoning += delta.text;
      else if (delta.type === 'usage') {
        promptTokens = delta.promptTokens;
        outputTokens = delta.outputTokens;
      } else if (delta.type === 'error') throw new Error(delta.message);
    }
    void reasoning;
    const cleaned = stripOuterFence(text).trim();
    if (!cleaned) throw new Error('The model returned an empty document. Check the selected plan model and try again.');
    this.db.recordUsage({
      projectId: this.workspace.projectId,
      model: binding.model,
      promptTokens: promptTokens || Math.round(estimateTokens(userPrompt)),
      outputTokens: outputTokens || Math.round(estimateTokens(cleaned)),
      durationMs: Date.now() - started,
    });

    if (phase === 'requirements') {
      await this.writeDocFile(feature, 'requirements.md', cleaned);
      meta.phase = 'requirements';
      meta.approvals.requirements = false;
      const result = await this.get(feature);
      meta.updatedAt = Date.now();
      await this.saveMeta(meta);
      return { ...result, meta };
    }
    if (phase === 'design') {
      await this.writeDocFile(feature, 'design.md', cleaned);
      meta.phase = 'design';
      meta.approvals.design = false;
      const result = await this.get(feature);
      await this.saveMeta(meta);
      return { ...result, meta };
    }
    const parsed = parseTasksMarkdown(cleaned);
    if (parsed.length === 0) {
      throw new Error(
        'The model did not produce tasks in the required format. Try generating again, or edit tasks.md manually.',
      );
    }
    const tasksMd = serializeTasksMarkdown(parsed);
    await this.writeDocFile(feature, 'tasks.md', tasksMd);
    meta.tasks = parsed;
    meta.phase = 'tasks';
    meta.approvals.tasks = false;
    await this.saveMeta(meta);
    return { meta, requirements: doc.requirements, design: doc.design, tasks: tasksMd };
  }

  async approve(feature: string, phase: SpecPhase): Promise<SpecDocument> {
    if (phase !== 'requirements' && phase !== 'design' && phase !== 'tasks') {
      throw new Error('Only requirements, design and tasks can be approved');
    }
    const doc = await this.get(feature);
    const meta = doc.meta;
    if (phase === 'requirements' && !doc.requirements.trim())
      throw new Error('Generate requirements before approving them');
    if (phase === 'design' && !doc.design.trim()) throw new Error('Generate a design before approving it');
    if (phase === 'tasks' && meta.tasks.length === 0) throw new Error('Generate tasks before approving them');
    meta.approvals[phase] = true;
    if (phase === 'requirements') meta.phase = 'design';
    if (phase === 'design') meta.phase = 'tasks';
    if (phase === 'tasks') {
      meta.phase = 'implementation';
      meta.tasks = meta.tasks.map((task) => ({ ...task, approved: true }));
    }
    await this.writeDocFile(feature, 'tasks.md', serializeTasksMarkdown(meta.tasks, doc.tasks.split('\n')[0] ?? ''));
    await this.saveMeta(meta);
    return { ...doc, meta, tasks: await this.readDocFile(feature, 'tasks.md') };
  }

  async updateTask(
    projectId: string,
    feature: string,
    taskId: string,
    patchOrStatus: Partial<SpecTask> | SpecTask['status'],
    note?: string,
  ): Promise<string> {
    if (projectId !== this.workspace.projectId) throw new Error('This spec belongs to a different project');
    const doc = await this.get(feature);
    const meta = doc.meta;
    const task = meta.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found in ${feature}`);
    const patch: Partial<SpecTask> = typeof patchOrStatus === 'string' ? { status: patchOrStatus } : patchOrStatus;
    Object.assign(task, patch);
    if (meta.approvals.tasks && meta.tasks.every((candidate) => candidate.status === 'done')) {
      meta.phase = 'done';
    } else if (meta.approvals.tasks) {
      meta.phase = 'implementation';
    }
    await this.writeDocFile(feature, 'tasks.md', serializeTasksMarkdown(meta.tasks));
    await this.saveMeta(meta);
    if (note) await this.appendImplementationReport(feature, `**${taskId}** ${note}\n`);
    return `Task ${taskId} (${task.title}) is now ${task.status}.`;
  }

  async appendImplementationReport(feature: string, content: string): Promise<void> {
    const file = 'implementation-report.md';
    let existing = await this.readDocFile(feature, file);
    if (!existing.trim()) existing = `# Implementation report: ${titleCase(feature)}\n\n`;
    const stamp = new Date().toISOString();
    await this.writeDocFile(feature, file, `${existing.trimEnd()}\n\n## ${stamp}\n${content.trim()}\n`);
  }

  async remove(feature: string): Promise<void> {
    this.assertFeature(feature);
    await fs.rm(this.featureDir(feature), { recursive: true, force: true });
    this.db.deleteSpecMeta(this.workspace.projectId, feature);
    this.broadcast('spec:changed', { projectId: this.workspace.projectId, feature });
  }
}

function titleCase(feature: string): string {
  return feature
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}
