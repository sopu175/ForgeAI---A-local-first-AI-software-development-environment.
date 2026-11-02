import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Cpu,
  Database,
  Download,
  Flame,
  Play,
  RefreshCw,
  Sparkles,
  Terminal,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import type { ModelTrainingStats } from '@forgeai/shared';
import { useAppStore } from '../state/app';
import { errorMessage } from '../lib/format';
import { requestTerminalCommand } from '../lib/terminalBus';
import { SectionLabel, Spinner, StatusDot } from './ui';

export function TrainModelTab() {
  const toast = useAppStore((state) => state.toast);
  const refreshModels = useAppStore((state) => state.refreshModels);
  const showBottom = useAppStore((state) => state.showBottom);
  const [stats, setStats] = useState<ModelTrainingStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState('sopu-coder');
  const [isTraining, setIsTraining] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ text: string; stream: 'stdout' | 'stderr'; time: string }>>([
    {
      text: '[Sopu AI Engine] Model Training & Customization Console initialized.',
      stream: 'stdout',
      time: new Date().toLocaleTimeString(),
    },
  ]);

  const logEndRef = useRef<HTMLDivElement>(null);

  const refreshStats = async () => {
    setLoadingStats(true);
    try {
      const res = await window.forge.tools.getTrainingStats();
      setStats(res);
      if (res.availableRecipes?.length && res.availableRecipes[0]) {
        setSelectedRecipe(res.availableRecipes[0].name);
      }
    } catch (err) {
      toast('error', `Failed to load training stats: ${errorMessage(err)}`);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    void refreshStats();

    const off = window.forge.events.on('models:train:log', (entry) => {
      const clean = entry.text
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
        .replace(/\[\?[0-9;]*[a-zA-Z]/g, '')
        .replace(/\[\d*G/g, '')
        .replace(/\[K/g, '')
        .trim();
      if (!clean) return;
      setLogs((prev) => [
        ...prev.slice(-400),
        {
          text: clean,
          stream: entry.stream ?? 'stdout',
          time: new Date().toLocaleTimeString(),
        },
      ]);
    });

    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await window.forge.tools.trainModel({ mode: 'export_only' });
      if (res.success) {
        toast('success', res.message);
      } else {
        toast('error', res.message);
      }
      await refreshStats();
    } catch (err) {
      toast('error', `Export error: ${errorMessage(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleTrainRecipe = async () => {
    setIsTraining(true);
    try {
      const res = await window.forge.tools.trainModel({
        mode: 'recipe',
        recipeName: selectedRecipe,
      });
      if (res.success) {
        toast('success', res.message);
        await refreshModels(false);
      } else {
        toast('error', res.message);
      }
      await refreshStats();
    } catch (err) {
      toast('error', `Recipe build failed: ${errorMessage(err)}`);
    } finally {
      setIsTraining(false);
    }
  };

  const handleTrainLora = async () => {
    setIsTraining(true);
    try {
      const res = await window.forge.tools.trainModel({ mode: 'lora' });
      if (res.success) {
        toast('success', res.message);
      } else {
        toast('error', res.message);
      }
      await refreshStats();
    } catch (err) {
      toast('error', `LoRA training failed: ${errorMessage(err)}`);
    } finally {
      setIsTraining(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Intro Card */}
      <div className="card p-3.5 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          <h3 className="text-[13px] font-semibold text-fg-strong">Sopu AI Model Customization &amp; Training</h3>
        </div>
        <p className="text-[11.5px] leading-relaxed text-muted">
          Customize and train your local coding model directly from ForgeAI. Build Git-tracked Modelfile recipes
          with specialized system instructions for full-stack engineering (React, Next.js, TypeScript, PHP, Python),
          or export conversation history to fine-tune weights with LoRA adapters.
        </p>
      </div>

      {/* Dataset & Stats Grid */}
      <div>
        <SectionLabel
          right={
            <button
              type="button"
              className="btn btn-ghost h-5 px-1.5 text-[10px]"
              onClick={() => void refreshStats()}
              disabled={loadingStats}
            >
              <RefreshCw size={10} className={loadingStats ? 'animate-spin' : ''} /> Refresh
            </button>
          }
        >
          Training Dataset &amp; History
        </SectionLabel>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="card p-3 space-y-1">
            <div className="flex items-center justify-between text-muted text-[11px]">
              <span>Recorded Sessions</span>
              <Database size={13} className="text-accent" />
            </div>
            <div className="text-[18px] font-semibold text-fg-strong">
              {stats?.conversationsCount ?? 0}
            </div>
            <div className="text-[10px] text-faint">Saved in SQLite history</div>
          </div>

          <div className="card p-3 space-y-1">
            <div className="flex items-center justify-between text-muted text-[11px]">
              <span>Message Turns</span>
              <Cpu size={13} className="text-cyan" />
            </div>
            <div className="text-[18px] font-semibold text-fg-strong">
              {stats?.turnsCount ?? 0}
            </div>
            <div className="text-[10px] text-faint">Prompts, diffs, solutions</div>
          </div>

          <div className="card p-3 space-y-1">
            <div className="flex items-center justify-between text-muted text-[11px]">
              <span>Dataset File</span>
              <StatusDot tone={stats?.datasetExists ? 'success' : 'warning'} />
            </div>
            <div className="truncate text-[12px] font-mono text-fg-strong">
              {stats?.datasetExists ? 'train.jsonl Ready' : 'Not Exported'}
            </div>
            <div className="text-[10px] text-faint truncate" title={stats?.datasetPath}>
              training/train.jsonl
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            className="btn h-7 text-[11px]"
            onClick={() => void handleExport()}
            disabled={isExporting || isTraining}
          >
            {isExporting ? <Spinner className="!h-3 !w-3" /> : <Download size={12} />} Export Conversations to JSONL
          </button>
        </div>
      </div>

      {/* Recipe Training */}
      <div>
        <SectionLabel>1. Modelfile Recipe Training (Ollama Create)</SectionLabel>
        <div className="card p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="text-[12px] font-medium text-fg">Custom Modelfile Recipe</div>
              <div className="text-[10.5px] text-muted">
                Compiles a custom resident model with tuned temperature (0.2), context (8192), and full-stack system prompt.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedRecipe}
                onChange={(e) => setSelectedRecipe(e.target.value)}
                className="h-7 text-[11px] min-w-[140px]"
                disabled={isTraining}
              >
                {(stats?.availableRecipes ?? [
                  { name: 'sopu-coder', file: 'Modelfile.sopu-coder', baseModel: 'qwen2.5-coder:7b' },
                  { name: 'sopu-coder-fast', file: 'Modelfile.sopu-coder-fast', baseModel: 'qwen3.5:4b' },
                ]).map((recipe) => (
                  <option key={recipe.name} value={recipe.name}>
                    {recipe.name} ({recipe.baseModel})
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn btn-primary h-7 text-[11.5px]"
                onClick={() => void handleTrainRecipe()}
                disabled={isTraining}
              >
                {isTraining ? <Spinner className="!h-3 !w-3" /> : <Flame size={12} />} Build &amp; Train Recipe
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded bg-panel-2 p-2 text-[10.5px] text-faint">
            <div>
              <span className="font-semibold text-fg">Context Window:</span> 8192 tokens
            </div>
            <div>
              <span className="font-semibold text-fg">Temperature:</span> 0.2 (deterministic coding)
            </div>
            <div>
              <span className="font-semibold text-fg">Top-P / Top-K:</span> 0.9 / 40
            </div>
            <div>
              <span className="font-semibold text-fg">Repeat Penalty:</span> 1.05
            </div>
          </div>
        </div>
      </div>

      {/* LoRA Training */}
      <div>
        <SectionLabel>2. Weight Fine-Tuning (LoRA / MLX)</SectionLabel>
        <div className="card p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-[12px] font-medium text-fg">Apple Silicon &amp; CUDA LoRA Fine-Tuner</div>
            <div className="text-[10.5px] text-muted">
              Spawns local Python / MLX trainer using exported <code className="text-fg font-mono">training/train.jsonl</code>.
            </div>
          </div>

          <button
            type="button"
            className="btn h-7 text-[11.5px]"
            onClick={() => void handleTrainLora()}
            disabled={isTraining || !stats?.datasetExists}
            title={!stats?.datasetExists ? 'Export dataset first' : 'Run fine-tuning script'}
          >
            {isTraining ? <Spinner className="!h-3 !w-3" /> : <Play size={12} />} Run LoRA Training
          </button>
        </div>
      </div>

      {/* Terminal CLI Guide */}
      <div>
        <SectionLabel>3. Train via Terminal (CLI)</SectionLabel>
        <div className="card p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-medium text-fg flex items-center gap-1.5">
              <TerminalSquare size={13} className="text-accent" />
              Integrated &amp; External Terminal Commands
            </div>
            <span className="text-[10px] text-faint">Copy or run directly in shell</span>
          </div>

          <div className="space-y-2">
            {/* Quick model recipe selector pills */}
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              <span className="text-[10px] text-faint font-semibold uppercase tracking-wider mr-1">Developer Models:</span>
              {[
                { id: 'sopu-coder', label: 'Full-Stack Coder' },
                { id: 'sopu-coder-fast', label: 'Fast Completion' },
                { id: 'sopu-frontend', label: 'Frontend / UI' },
                { id: 'sopu-animation', label: 'Motion & 3D' },
                { id: 'sopu-backend', label: 'Backend & APIs' },
                { id: 'sopu-debugger', label: 'Root Cause Debug' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedRecipe(m.id)}
                  className={`chip !h-5 !px-2 !text-[9.5px] cursor-pointer transition-colors ${
                    selectedRecipe === m.id
                      ? 'chip-accent font-semibold border-accent'
                      : 'hover:border-accent hover:text-fg'
                  }`}
                >
                  {m.label} ({m.id})
                </button>
              ))}
            </div>

            <div className="rounded bg-panel-2 p-2 text-[11px] font-mono flex items-center justify-between gap-2 border border-line-soft">
              <div className="min-w-0 flex-1 truncate">
                <span className="text-accent select-none">$ </span>
                <span className="text-fg">ollama create {selectedRecipe} -f training/recipes/Modelfile.{selectedRecipe}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  className="btn btn-ghost h-6 px-1.5 text-[10px]"
                  title="Run in Integrated Terminal"
                  onClick={() => {
                    showBottom('terminal');
                    requestTerminalCommand(`ollama create ${selectedRecipe} -f training/recipes/Modelfile.${selectedRecipe}`);
                    toast('info', `Dispatched build for ${selectedRecipe} to Terminal`);
                  }}
                >
                  <Play size={10} className="text-success" /> Run
                </button>
                <button
                  type="button"
                  className="btn btn-ghost h-6 px-1.5 text-[10px]"
                  title="Copy command"
                  onClick={() => {
                    void navigator.clipboard.writeText(`ollama create ${selectedRecipe} -f training/recipes/Modelfile.${selectedRecipe}`);
                    setCopiedCmd('recipe');
                    setTimeout(() => setCopiedCmd(null), 2000);
                  }}
                >
                  {copiedCmd === 'recipe' ? <Check size={10} className="text-success" /> : <Copy size={10} />}
                </button>
              </div>
            </div>

            <div className="rounded bg-panel-2 p-2 text-[11px] font-mono flex items-center justify-between gap-2 border border-line-soft">
              <div className="min-w-0 flex-1 truncate">
                <span className="text-accent select-none">$ </span>
                <span className="text-fg">python3 training/train_lora.py --model qwen2.5-coder:7b --dataset training/train.jsonl</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  className="btn btn-ghost h-6 px-1.5 text-[10px]"
                  title="Run in Integrated Terminal"
                  onClick={() => {
                    showBottom('terminal');
                    requestTerminalCommand('python3 training/train_lora.py --model qwen2.5-coder:7b --dataset training/train.jsonl');
                    toast('info', 'Command dispatched to Terminal');
                  }}
                >
                  <Play size={10} className="text-success" /> Run
                </button>
                <button
                  type="button"
                  className="btn btn-ghost h-6 px-1.5 text-[10px]"
                  title="Copy command"
                  onClick={() => {
                    void navigator.clipboard.writeText('python3 training/train_lora.py --model qwen2.5-coder:7b --dataset training/train.jsonl');
                    setCopiedCmd('lora');
                    setTimeout(() => setCopiedCmd(null), 2000);
                  }}
                >
                  {copiedCmd === 'lora' ? <Check size={10} className="text-success" /> : <Copy size={10} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Logs Terminal */}
      <div>
        <div className="flex items-center justify-between pb-1">
          <SectionLabel>Live Training Console</SectionLabel>
          <button
            type="button"
            className="btn btn-ghost h-5 px-1.5 text-[10px] text-faint hover:text-fg"
            onClick={() => setLogs([])}
          >
            <Trash2 size={10} /> Clear console
          </button>
        </div>

        <div className="rounded-md border border-line-soft bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-300 max-h-[220px] min-h-[140px] overflow-y-auto space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 pb-1 border-b border-zinc-800">
            <Terminal size={11} />
            <span>ForgeAI Model Training Daemon</span>
            {isTraining ? (
              <span className="ml-auto flex items-center gap-1 text-accent">
                <Spinner className="!h-2.5 !w-2.5" /> Training in progress…
              </span>
            ) : (
              <span className="ml-auto text-zinc-500">Idle</span>
            )}
          </div>

          {logs.map((log, idx) => (
            <div
              key={idx}
              className={log.stream === 'stderr' ? 'text-red-400' : 'text-zinc-200'}
            >
              <span className="text-zinc-600 mr-2 select-none">[{log.time}]</span>
              <span className="whitespace-pre-wrap">{log.text}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
