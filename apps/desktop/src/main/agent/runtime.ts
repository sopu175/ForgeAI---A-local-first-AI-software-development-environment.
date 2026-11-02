import { nanoid } from 'nanoid';
import { parseToolEnvelope, stripEnvelope, type AIProvider } from '@forgeai/ai';
import { compactFileTree, packRetrievalResults } from '@forgeai/core';
import {
  estimateTokens,
  truncateMiddle,
  type AgentEvent,
  type AgentKind,
  type AgentReport,
  type AgentRunRequest,
  type ChatMessage,
  type ChatToolCall,
  type ModelRole,
  type RoleBinding,
} from '@forgeai/shared';
import type { Database } from '../db';
import type { CheckpointService } from '../services/checkpoints';
import type { GitService } from '../services/git';
import type { IndexerService } from '../services/indexer';
import type { ProvidersService } from '../services/providers';
import type { SearchService } from '../services/search';
import type { SettingsService } from '../services/settings';
import type { Broadcast, WorkspaceService } from '../services/workspace';
import type { PermissionBroker } from '../permissions';
import { buildSystemPrompt, summarizeToolResult } from './prompts';
import { toolRegistry, ToolRegistry, type ToolContext } from './tools';

export interface SpecUpdateHook {
  updateTask(
    projectId: string,
    feature: string,
    taskId: string,
    status: 'in_progress' | 'done' | 'failed',
    note?: string,
  ): Promise<string>;
}

export interface AgentRunHandle {
  runId: string;
  completion: Promise<{ report: AgentReport; error?: string }>;
}

const ROLE_FOR_AGENT: Record<AgentKind, ModelRole> = {
  coding: 'coding',
  planner: 'plan',
  debugging: 'coding',
  testing: 'coding',
  review: 'review',
  docs: 'chat',
  seo: 'coding',
};

export class AgentRuntimeService {
  private runs = new Map<string, AbortController>();
  private readonly registry: ToolRegistry;

  constructor(
    private readonly db: Database,
    private readonly workspace: WorkspaceService,
    private readonly providers: ProvidersService,
    private readonly settings: SettingsService,
    private readonly indexer: IndexerService,
    private readonly search: SearchService,
    private readonly git: GitService,
    private readonly checkpoints: CheckpointService,
    private readonly permissions: PermissionBroker,
    private readonly broadcast: Broadcast,
    private readonly specHook?: SpecUpdateHook,
    registry?: ToolRegistry,
  ) {
    this.registry = registry ?? toolRegistry;
  }

  cancel(runId: string): void {
    this.runs.get(runId)?.abort(new Error('Agent run cancelled'));
    this.permissions.denyAll();
  }

  cancelAll(): void {
    for (const controller of this.runs.values()) controller.abort(new Error('Application is shutting down'));
    this.permissions.denyAll();
  }

  isRunning(runId: string): boolean {
    return this.runs.has(runId);
  }

  start(request: AgentRunRequest): AgentRunHandle {
    if (!this.workspace.isOpen() || this.workspace.projectId !== request.projectId) {
      throw new Error('Open this project before starting an agent run');
    }
    const runId = `run-${nanoid(10)}`;
    const controller = new AbortController();
    this.runs.set(runId, controller);
    const completion = this.execute(runId, request, controller).finally(() => {
      this.runs.delete(runId);
    });
    return { runId, completion };
  }

  private async execute(
    runId: string,
    request: AgentRunRequest,
    controller: AbortController,
  ): Promise<{ report: AgentReport; error?: string }> {
    const startedAt = Date.now();
    let steps = 0;
    let promptTokens = 0;
    let outputTokens = 0;
    let summary = '';
    let summaryIsDeterministic = false;
    let error: string | undefined;
    let cancelled = false;
    const changedFiles = new Map<string, import('@forgeai/shared').FileChange>();
    const commandsRun: string[] = [];
    let checkpoint: Awaited<ReturnType<CheckpointService['beginAgent']>> | null = null;
    let binding: RoleBinding | undefined;
    let provider: AIProvider | undefined;
    const agent = request.agent;

    const emitRun = (event: AgentEvent) => {
      this.broadcast('agent:event', { runId, event });
    };

    try {
      const maxSteps = Math.min(request.maxSteps ?? this.settings.get().agent.maxSteps, 60);
      const allModels = await this.providers.models(false);

      if (request.providerId && request.model) {
        const modelExists = allModels.some((m) => m.providerId === request.providerId && m.id === request.model);
        binding = modelExists
          ? { providerId: request.providerId, model: request.model }
          : await this.providers.resolveRole(ROLE_FOR_AGENT[agent]);
      } else {
        binding = await this.providers.resolveRole(ROLE_FOR_AGENT[agent]);
      }

      provider = this.providers.build(binding.providerId);
      let modelInfo = allModels.find(
        (model) => model.id === binding?.model && model.providerId === binding?.providerId,
      );
      if (!modelInfo) {
        binding = await this.providers.resolveRole('coding');
        provider = this.providers.build(binding.providerId);
        modelInfo = allModels.find(
          (model) => model.id === binding?.model && model.providerId === binding?.providerId,
        );
      }
      if (modelInfo?.capabilities.embedding)
        throw new Error('Embedding models cannot run agents. Select a chat/coding model.');

      const providerConfig = this.providers.list().find((item) => item.id === binding?.providerId);
      const contextLength = providerConfig?.config.contextLength ?? modelInfo?.contextLength ?? 8192;
      emitRun({ type: 'started', runId, agent, model: binding.model });

      const [rules, stack, files] = await Promise.all([
        this.workspace.loadRules().catch(() => []),
        this.workspace.getStack().catch(() => ({
          languages: [],
          frameworks: [],
          packageManagers: [],
          testRunners: [],
          hasGit: false,
          entryPoints: [],
        })),
        this.search.files('', 300).catch(() => []),
      ]);

      const retrievalResults = await this.indexer.search(request.projectId, request.task, 6).catch(() => []);
      const retrieval = packRetrievalResults(retrievalResults, 3000, 6);
      const activeFiles: Array<{ path: string; content: string }> = [];
      for (const relative of (request.contextFiles ?? []).slice(0, 4)) {
        try {
          const file = await this.workspace.readFile(relative);
          activeFiles.push({ path: relative, content: truncateMiddle(file.content, 5000) });
        } catch {
          // Ignore context files that no longer exist.
        }
      }

      const systemPrompt = buildSystemPrompt({
        agent,
        workspaceName: this.workspace.project.name,
        root: this.workspace.root,
        stack,
        rules,
        treeSummary: compactFileTree(files, 200),
        retrieval,
        activeFiles,
        toolNames: this.registry.names(agent),
        maxSteps,
      });

      const taskContent = [
        request.task,
        request.feature && request.specTaskId
          ? `\n\nSpec context: feature "${request.feature}", task ${request.specTaskId}. Mark the task done with update_task only after implementing and verifying it.`
          : '',
        `\n\nWork autonomously within the ${maxSteps}-step budget. If native tools are unavailable, use the JSON envelope protocol exactly.`,
      ].join('');

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: taskContent },
      ];
      // Tool schemas are part of the prompt that Ollama renders, but they are
      // not ChatMessage objects. Account for them when trimming history or the
      // model silently runs out of context and returns an empty turn.
      const toolSchemas = this.registry.schemas(agent);
      const toolTokens = estimateTokens(JSON.stringify(toolSchemas));

      if (this.settings.get().agent.autoCheckpoint) {
        checkpoint = await this.checkpoints.beginAgent(request.projectId, `Agent: ${request.task.slice(0, 80)}`);
      }

      const toolContext: ToolContext = {
        runId,
        projectId: request.projectId,
        agent,
        workspace: this.workspace,
        search: this.search,
        git: this.git,
        indexer: this.indexer,
        permissions: this.permissions,
        db: this.db,
        checkpoint,
        checkpoints: this.checkpoints,
        signal: controller.signal,
        emit: emitRun,
        changedFiles,
        commandsRun,
        reads: new Map(),
        specFeature: request.feature,
        specTaskId: request.specTaskId,
        updateTask:
          request.feature && this.specHook
            ? async (taskId, status, note) =>
                this.specHook!.updateTask(request.projectId, request.feature!, taskId, status, note)
            : undefined,
      };

      let emptyStreak = 0;
      let intentStreak = 0;
      for (let step = 1; step <= maxSteps; step += 1) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        steps = step;
        // The final step exists to report, not to gather more evidence: any
        // tool result produced now would never be observed. Small local models
        // otherwise keep re-reading files until the budget silently runs out.
        const finalStep = step === maxSteps;
        if (finalStep) {
          // Context trimming may already have dropped the write results by the
          // time the model writes its report, so restate the tool-confirmed
          // ledger. Small models otherwise end with "no edits were made" after
          // writing files.
          const ledger =
            changedFiles.size > 0
              ? `Files already written in this run (tool-confirmed): ${[...changedFiles.keys()].join(', ')}.`
              : 'No files have been written in this run.';
          const runLedger = commandsRun.length > 0 ? ` Commands run: ${commandsRun.join(', ')}.` : '';
          messages.push({
            role: 'user',
            content: `Step budget exhausted. Do not call tools and do not return JSON. Write the final report in plain Markdown: what you found or changed, what was actually written, what you verified, and what remains. ${ledger}${runLedger} Base the report on these tool-confirmed facts and never claim that nothing was written when files are listed.`,
          });
        }
        emitRun({ type: 'step', info: { step, maxSteps } });
        this.trimHistory(messages, contextLength, toolTokens);

        let text = '';
        const calls: ChatToolCall[] = [];
        let runError: string | undefined;
        const stepStarted = Date.now();

        try {
          const stream = provider.chat(
            {
              providerId: binding.providerId,
              model: binding.model,
              messages,
              tools: finalStep ? undefined : toolSchemas,
              temperature: this.settings.get().agent.temperature,
              contextLength,
            },
            controller.signal,
          );
          for await (const delta of stream) {
            if (delta.type === 'text') {
              text += delta.text;
            } else if (delta.type === 'reasoning') {
              emitRun({ type: 'reasoning', text: delta.text });
            } else if (delta.type === 'tool_call') {
              calls.push(delta.call);
            } else if (delta.type === 'usage') {
              promptTokens += delta.promptTokens;
              outputTokens += delta.outputTokens;
              emitRun({
                type: 'usage',
                promptTokens: delta.promptTokens,
                outputTokens: delta.outputTokens,
              });
            } else if (delta.type === 'error') {
              runError = delta.message;
            }
          }
        } catch (chatError) {
          if (controller.signal.aborted) {
            cancelled = true;
            break;
          }
          runError = chatError instanceof Error ? chatError.message : String(chatError);
        }

        if (runError) {
          error = runError;
          emitRun({ type: 'error', message: runError });
          break;
        }
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        this.db.recordUsage({
          projectId: request.projectId,
          model: binding.model,
          promptTokens: Math.round(estimateTokens(messages.map((message) => message.content).join('\n'))),
          outputTokens: Math.round(estimateTokens(text)),
          durationMs: Date.now() - stepStarted,
        });
        if (!finalStep) {
          const envelope = parseToolEnvelope(text);
          const hasCalls = calls.length > 0 || (envelope && envelope.calls.length > 0);
          if (hasCalls) {
            const stripped = stripEnvelope(text).trim();
            if (stripped && !stripped.startsWith('{') && !stripped.startsWith('```json')) {
              emitRun({ type: 'assistant', text: stripped });
            }
          } else if (text.trim() && !text.trim().startsWith('{') && !text.trim().startsWith('```json')) {
            emitRun({ type: 'assistant', text: text.trim() });
          }
        }
        if (finalStep) {
          // Tools are disabled for this turn, so the streamed text is the final
          // answer. Ignore any stray envelope calls rather than executing a
          // tool whose observation could never reach the model. Local models
          // still sometimes answer with {"final":"..."}; unwrap it.
          const answer = this.finalAnswerText(text);
          if (answer) {
            summary = answer;
            emitRun({ type: 'assistant', text: answer });
          }
          break;
        }
        if (text.trim().length === 0 && calls.length === 0) {
          emptyStreak += 1;
          if (emptyStreak >= 2) {
            // Two empty turns in a row usually mean the model is lost in a
            // long tool transcript. Stop the loop and ask once more without
            // tools, using only the recorded observations, so the run can
            // still end with a useful report instead of an error card.
            summary = await this.recoverFinalAnswer({
              provider,
              binding,
              contextLength,
              task: request.task,
              messages,
              signal: controller.signal,
              emit: emitRun,
            });
            if (!summary) {
              summary = this.buildFallbackSummary(steps, changedFiles, commandsRun, messages);
              summaryIsDeterministic = true;
              emitRun({ type: 'assistant', text: summary });
            }
            break;
          }
          messages.push({
            role: 'user',
            content:
              'Your previous response was empty. Continue the task using tools, or provide a final answer. Do not return empty content.',
          });
          continue;
        }
        emptyStreak = 0;

        const uniqueCalls = dedupeCalls(calls);
        if (uniqueCalls.length === 0) {
          const envelope = parseToolEnvelope(text);
          if (envelope && envelope.calls.length > 0) {
            const pseudoCalls: ChatToolCall[] = envelope.calls.map((call, index) => ({
              id: `call_${step}_${index}_${nanoid(4)}`,
              name: call.name,
              arguments: call.arguments,
            }));
            messages.push({ role: 'assistant', content: text, toolCalls: pseudoCalls });
            const pseudoResults = await this.runToolCalls(
              pseudoCalls,
              toolContext,
              emitRun,
              this.settings.get().agent.parallelReadOnly,
            );
            for (const { call, observation } of pseudoResults) {
              const capped = this.capObservation(observation);
              messages.push({ role: 'tool', content: capped, toolCallId: call.id });
            }
            if (envelope.final) summary = envelope.final;
            if (controller.signal.aborted) {
              cancelled = true;
              break;
            }
            continue;
          }
          if (envelope?.final) {
            summary = envelope.final;
            break;
          }
          // Small models often narrate the next action ("Let me fix this:")
          // and stop without calling a tool. Treat that as a request to
          // continue instead of a final answer, but only twice so a stalled
          // model cannot consume the whole budget.
          if (intentStreak < 2 && step < maxSteps && looksLikeContinuation(text)) {
            intentStreak += 1;
            messages.push({ role: 'assistant', content: text });
            messages.push({
              role: 'user',
              content:
                'You described the next action but did not call a tool, so nothing happened. Call the appropriate tool now with valid arguments. If the work is already complete, write the final answer without mentioning further actions.',
            });
            continue;
          }
          summary = this.finalAnswerText(text);
          break;
        }
        intentStreak = 0;

        messages.push({ role: 'assistant', content: text, toolCalls: uniqueCalls });
        const observations = await this.runToolCalls(
          uniqueCalls,
          toolContext,
          emitRun,
          this.settings.get().agent.parallelReadOnly,
        );
        for (const { call, observation } of observations) {
          const capped = this.capObservation(observation);
          messages.push({ role: 'tool', content: capped, toolCallId: call.id });
        }
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
      }

      const hitStepLimit = steps >= maxSteps;
      if (!summary && !cancelled && provider && binding) {
        // The model never wrote a closing message (it spent the budget on
        // tools or stalled after a failed call). Ask once more with tools
        // disabled so the run still ends with a report of what really happened.
        summary = await this.recoverFinalAnswer({
          provider,
          binding,
          contextLength,
          task: request.task,
          messages,
          signal: controller.signal,
          emit: emitRun,
        });
      }
      if (controller.signal.aborted) cancelled = true;
      if (!summary) {
        summaryIsDeterministic = true;
        if (cancelled) {
          summary = 'Agent run cancelled by the user.';
        } else if (hitStepLimit) {
          summary = `Reached the step limit (${steps}) while still gathering information, so the agent stopped before writing a final answer. Files changed: ${[...changedFiles.keys()].join(', ') || 'none'}. The tool timeline above shows everything it collected; increase the step budget or ask for a smaller task to get a written report.`;
        } else {
          summary = `Agent stopped without a final answer after ${steps} ${steps === 1 ? 'step' : 'steps'}. Files changed: ${[...changedFiles.keys()].join(', ') || 'none'}. The tool timeline shows what completed; retry or ask for the remaining change.`;
        }
      }
      summary = this.finalAnswerText(summary) || summary;
      // Context trimming can make the model forget its own writes. When the
      // report denies making changes but the tool timeline applied some, trust
      // the timeline and replace the contradictory draft.
      const deniesWrites = reportDeniesWrites(summary);
      if (!cancelled && !summaryIsDeterministic && changedFiles.size > 0 && deniesWrites) {
        summary = `${this.buildFallbackSummary(steps, changedFiles, commandsRun, messages)}\n\n_Note: the draft reply claimed nothing was written, but the tool timeline confirms the writes listed below were applied._`;
      }
      if (!cancelled && agent !== 'planner' && agent !== 'review') {
        const warnings = await this.verifyDomReferences(changedFiles, files);
        if (warnings.length > 0) summary += `\n\n**Verification warnings:** ${warnings.join(' ')}`;
        const written = [...changedFiles.keys()];
        const facts = [
          written.length > 0 ? `Files written: ${written.join(', ')}.` : 'No files were written in this run.',
          commandsRun.length > 0 ? `Commands run: ${commandsRun.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
        summary += `\n\n**Verified run facts:** ${facts}`;
      }
    } catch (fatal) {
      error = fatal instanceof Error ? fatal.message : String(fatal);
      emitRun({ type: 'error', message: error });
      summary = summary || `Agent failed: ${error}`;
      cancelled = controller.signal.aborted;
    } finally {
      if (checkpoint) {
        try {
          await checkpoint.finalize();
        } catch {
          // A checkpoint failure must not mask the agent report.
        }
      }
    }

    const report: AgentReport = {
      runId,
      summary,
      filesChanged: [...changedFiles.keys()],
      commandsRun,
      steps,
      durationMs: Date.now() - startedAt,
      promptTokens,
      outputTokens,
      cancelled,
    };
    emitRun(cancelled ? { type: 'cancelled' } : { type: 'done', report });
    return { report, error };
  }

  private async executeTool(
    call: ChatToolCall,
    context: ToolContext,
    emit: (event: AgentEvent) => void,
  ): Promise<string> {
    emit({ type: 'tool_call', call });
    const result = await this.registry.execute(call.name, call.arguments, context);
    emit({
      type: 'tool_result',
      callId: call.id,
      name: call.name,
      ok: result.ok,
      preview: summarizeToolResult(result.observation, 900),
    });
    return summarizeToolResult(result.observation, 20_000);
  }

  /**
   * Executes one turn's tool calls. Independent read-only calls run together,
   * because a small model often asks for several files at once and the round
   * trips — not the work — dominate the step. Anything that can write, delete
   * or spawn stays strictly sequential so approvals and diffs keep their order.
   */
  private async runToolCalls(
    calls: readonly ChatToolCall[],
    context: ToolContext,
    emit: (event: AgentEvent) => void,
    parallel: boolean,
  ): Promise<Array<{ call: ChatToolCall; observation: string }>> {
    const results: Array<{ call: ChatToolCall; observation: string }> = [];
    for (const batch of planToolBatches(calls, (name) => this.registry.isReadOnly(name), parallel)) {
      if (context.signal.aborted) break;
      if (batch.length === 1) {
        const call = batch[0]!;
        results.push({ call, observation: await this.executeTool(call, context, emit) });
        continue;
      }
      const settled = await Promise.all(
        batch.map(async (call) => ({ call, observation: await this.executeTool(call, context, emit) })),
      );
      results.push(...settled);
    }
    return results;
  }

  /**
   * One last completion with tools disabled. After a long tool loop the model
   * can return an empty turn; giving it a compact observation digest and a
   * single job ("write the report") reliably recovers usable output.
   */
  private async recoverFinalAnswer(args: {
    provider: AIProvider;
    binding: RoleBinding;
    contextLength: number;
    task: string;
    messages: ChatMessage[];
    signal: AbortSignal;
    emit: (event: AgentEvent) => void;
  }): Promise<string> {
    const observations = args.messages
      .filter((message) => message.role === 'tool')
      .slice(-5)
      .map((message, index) => `Observation ${index + 1}:\n${truncateMiddle(message.content, 2400)}`)
      .join('\n\n');
    const digest = observations || 'No tool results were produced before the model stopped responding.';
    let text = '';
    try {
      const stream = args.provider.chat(
        {
          providerId: args.binding.providerId,
          model: args.binding.model,
          messages: [
            {
              role: 'system',
              content:
                'You are ForgeAI. The tool loop has stopped, so write the final report from the recorded results below. Do not call tools. Do not return empty text. Be concise: state what was found or changed, what was verified, what remains, and the next concrete step. If the work is read-only, give the findings themselves.',
            },
            {
              role: 'user',
              content: `Task:\n${args.task}\n\nRecorded tool results:\n${digest}\n\nWrite the final report now.`,
            },
          ],
          temperature: 0.2,
          maxTokens: 1200,
          contextLength: args.contextLength,
        },
        args.signal,
      );
      for await (const delta of stream) {
        if (delta.type === 'text') text += delta.text;
        else if (delta.type === 'error') return '';
      }
    } catch {
      return '';
    }
    const final = text.trim();
    if (!final) return '';
    args.emit({ type: 'assistant', text: final });
    return final;
  }

  /**
   * Extracts human-facing text from a final answer. Small local models
   * sometimes answer with the fallback JSON envelope even when tools are
   * disabled, so unwrap {"final": "..."} before rendering it as a report.
   */
  private finalAnswerText(text: string): string {
    const envelope = parseToolEnvelope(text);
    if (envelope?.final) return envelope.final.trim();
    return stripEnvelope(text).trim() || text.trim();
  }

  /**
   * Cheap post-run guard for web apps: every id a changed script looks up with
   * getElementById must exist in an HTML/JSX/TSX file. Catches the common
   * "I added the counter logic but not the element" failure without invoking
   * the model or a browser.
   */
  private async verifyDomReferences(
    changedFiles: ReadonlyMap<string, unknown>,
    files: readonly string[],
  ): Promise<string[]> {
    const changedScripts = [...changedFiles.keys()].filter((file) => /\.(m?js|ts)$/i.test(file));
    if (changedScripts.length === 0) return [];
    const markup = [...new Set([...files, ...changedFiles.keys()])].filter((file) => /\.(html?|jsx|tsx)$/i.test(file));
    // Large repos or heavy component trees would make this slow and noisy.
    if (markup.length === 0 || markup.length > 80) return [];

    const ids = new Set<string>();
    for (const file of markup) {
      try {
        const { content } = await this.workspace.readFile(file);
        for (const match of content.matchAll(/\bid\s*=\s*["'`]([^"'`]+)["'`]/g)) {
          if (match[1]) ids.add(match[1]);
        }
      } catch {
        // Deleted or unreadable markup does not invalidate the changed script.
      }
    }

    const referenced = new Map<string, string[]>();
    for (const file of changedScripts.slice(0, 10)) {
      try {
        const { content } = await this.workspace.readFile(file);
        for (const match of content.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
          const id = match[1];
          if (!id) continue;
          const owners = referenced.get(id) ?? [];
          owners.push(file);
          referenced.set(id, owners);
        }
      } catch {
        // The script may have been deleted again by a later step.
      }
    }

    return [...referenced.entries()]
      .filter(([id]) => !ids.has(id))
      .slice(0, 5)
      .map(
        ([id, owners]) =>
          `${owners.join(', ')} references #${id}, but no element with that id exists in the HTML/JSX files.`,
      );
  }

  /** Deterministic report when even the tool-free recovery returns nothing. */
  private buildFallbackSummary(
    steps: number,
    changedFiles: ReadonlyMap<string, { path: string }>,
    commandsRun: string[],
    messages: ChatMessage[],
  ): string {
    const lastTool = [...messages]
      .reverse()
      .find((message) => message.role === 'tool')
      ?.content.trim();
    const parts = [
      `The agent completed ${steps} ${steps === 1 ? 'step' : 'steps'} but the model returned no final text.`,
    ];
    if (changedFiles.size > 0) parts.push(`Files changed: ${[...changedFiles.keys()].join(', ')}.`);
    if (commandsRun.length > 0) parts.push(`Commands run: ${commandsRun.join(', ')}.`);
    if (lastTool) parts.push(`Last tool result:\n${truncateMiddle(lastTool, 1500)}`);
    parts.push(
      'Review the timeline above for the full evidence, then retry with a shorter task if you need a written summary.',
    );
    return parts.join('\n\n');
  }

  /**
   * Cap observation text once at the moment it is inserted. This bounds memory
   * usage and keeps the prompt history append-only so the local model's Metal/CUDA
   * KV cache remains valid across multi-step agent turns.
   */
  private capObservation(content: string, maxChars = 2800): string {
    if (!content || content.length <= maxChars) return content;
    return `${truncateMiddle(content, maxChars)}\n… [observation capped to preserve KV cache]`;
  }

  /**
   * Keeps the conversation within the model context window while preserving the
   * KV cache prefix. Never rewrites older observations in-place (which would invalidate
   * cached attention matrices); drops whole oldest assistant/tool pairs when budget is blown.
   */
  private trimHistory(messages: ChatMessage[], contextLength: number, toolTokens = 0): void {
    const budget = Math.max(1024, Math.floor(contextLength - toolTokens - 2048));
    const total = () =>
      messages.reduce((sum, message) => sum + estimateTokens(message.content) + (message.toolCalls ? 80 : 0), 0);
    if (total() <= budget) return;

    while (total() > budget && messages.length > 4) {
      const index = messages.findIndex(
        (message, at) => at >= 2 && message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0,
      );
      if (index === -1) break;
      let removeCount = 1;
      while (index + removeCount < messages.length && messages[index + removeCount]?.role === 'tool') {
        removeCount += 1;
      }
      messages.splice(index, removeCount);
    }
  }
}

/**
 * Detects a short assistant turn that announces the next action but contains
 * no tool call, e.g. "Let me fix the edit by being more specific:". Small local
 * models emit these after a failed call and then stop, ending the run with no
 * work done. A real final report is usually longer and does not end on a colon.
 */
function looksLikeContinuation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 700) return false;
  if (/:\s*$/.test(trimmed)) return true;
  return /^(let me|i'?ll|i will|now i|next,? i|first,? i|i need to|i'?m going to|i am going to)\b/i.test(trimmed);
}

/** True when a draft report claims that no file was touched. */
export function reportDeniesWrites(text: string): boolean {
  return /\b(no (edits?|changes?|files?|modifications?)|nothing (was|has been) (changed|written|modified)|did not (make|write|change) any|could not make any changes)\b/i.test(
    text,
  );
}

/**
 * Groups one turn's tool calls into execution batches. Consecutive read-only
 * calls share a batch (up to four) so they can run concurrently; anything else
 * gets a batch of its own. With `parallel` off every call is its own batch.
 */
export function planToolBatches(
  calls: readonly ChatToolCall[],
  isReadOnly: (name: string) => boolean,
  parallel: boolean,
): ChatToolCall[][] {
  const batches: ChatToolCall[][] = [];
  for (const call of calls) {
    const last = batches[batches.length - 1];
    const joinable =
      parallel &&
      isReadOnly(call.name) &&
      Boolean(last) &&
      (last?.length ?? 0) < 4 &&
      (last ?? []).every((entry) => isReadOnly(entry.name));
    if (joinable && last) {
      last.push(call);
      continue;
    }
    batches.push([call]);
  }
  return batches;
}

function dedupeCalls(calls: ChatToolCall[]): ChatToolCall[] {
  const seen = new Set<string>();
  const unique: ChatToolCall[] = [];
  for (const call of calls) {
    const key = `${call.name}:${JSON.stringify(call.arguments)}:${call.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...call, id: call.id || nanoid(8) });
  }
  return unique;
}

export function agentKindLabel(agent: AgentKind): string {
  const labels: Record<AgentKind, string> = {
    coding: 'Coding Agent',
    planner: 'Planner Agent',
    debugging: 'Debugging Agent',
    testing: 'Testing Agent',
    review: 'Review Agent',
    docs: 'Docs Agent',
    seo: 'SEO Agent',
  };
  return labels[agent];
}
