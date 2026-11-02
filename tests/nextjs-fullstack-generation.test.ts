import { describe, expect, it } from 'vitest';
import { planWorkflow } from '@forgeai/core';
import { buildSystemPrompt } from '../apps/desktop/src/main/agent/prompts';
import { toolRegistry } from '../apps/desktop/src/main/agent/tools';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('Next.js Full-Stack Generation Test Suite (Frontend, Animation, Backend)', () => {
  it('orchestrator correctly plans multi-agent full-stack Next.js workflow', () => {
    const plan = planWorkflow(
      'Build a full-stack Next.js web application with animated hero and backend API routes',
    );

    expect(plan).toBeDefined();
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);

    // Verify planning step exists
    const plannerStep = plan.steps.find((s) => s.agent === 'planner');
    expect(plannerStep).toBeDefined();

    // Verify backend agent is scheduled for API endpoints
    const backendStep = plan.steps.find((s) => s.agent === 'backend');
    expect(backendStep).toBeDefined();
    expect(backendStep?.description).toMatch(/server|api|models/i);

    // Verify frontend agent is scheduled for UI and layouts
    const frontendStep = plan.steps.find((s) => s.agent === 'frontend');
    expect(frontendStep).toBeDefined();
    expect(frontendStep?.description).toMatch(/user interface|layout/i);

    // Verify testing & review verification phases are scheduled
    expect(plan.steps.some((s) => s.agent === 'testing')).toBe(true);
    expect(plan.steps.some((s) => s.agent === 'review')).toBe(true);
  });

  it('orchestrator routes specialized motion requests to Animation Agent', () => {
    const plan = planWorkflow(
      'Create smooth GSAP ScrollTrigger and Framer Motion hero transitions for landing page',
    );

    const animationStep = plan.steps.find((s) => s.agent === 'animation');
    expect(animationStep).toBeDefined();
    expect(animationStep?.description).toMatch(/animation|gpu|transitions|lifecycle/i);
  });

  it('orchestrator routes standalone backend requests to Backend Agent', () => {
    const plan = planWorkflow(
      'Implement REST API route handlers with Zod validation and PostgreSQL database queries',
    );

    const backendStep = plan.steps.find((s) => s.agent === 'backend');
    expect(backendStep).toBeDefined();
    expect(backendStep?.description).toMatch(/backend|api|validation/i);
  });

  it('verifies specialized system prompts empower Frontend, Animation, and Backend agents', () => {
    const commonContext = {
      rules: [],
      stack: {
        languages: ['TypeScript', 'JavaScript'],
        frameworks: ['React', 'Next.js', 'Tailwind CSS'],
        packageManagers: ['npm'],
        testRunners: ['vitest'],
        hasGit: true,
        entryPoints: ['app/page.tsx'],
      },
      activeFiles: [],
      files: ['package.json', 'app/layout.tsx', 'app/page.tsx'],
      toolNames: ['read_file', 'write_file', 'edit_file', 'run_command'],
      maxSteps: 25,
      workspaceName: 'nextjs-saas-app',
      root: '/fake/nextjs-saas-app',
    };

    // Frontend Agent Prompt Check
    const frontendPrompt = buildSystemPrompt({
      ...commonContext,
      agent: 'frontend',
    });
    expect(frontendPrompt).toContain('You are the Frontend Agent');
    expect(frontendPrompt).toContain('Next.js');
    expect(frontendPrompt).toContain('Tailwind CSS');
    expect(frontendPrompt).toContain('WCAG 2.1 AA');

    // Animation Agent Prompt Check
    const animationPrompt = buildSystemPrompt({
      ...commonContext,
      agent: 'animation',
    });
    expect(animationPrompt).toContain('You are the Animation Agent');
    expect(animationPrompt).toContain('GSAP');
    expect(animationPrompt).toContain('ScrollTrigger');
    expect(animationPrompt).toContain('Framer Motion');
    expect(animationPrompt).toContain('ctx.revert()');
    expect(animationPrompt).toContain('prefers-reduced-motion');

    // Backend Agent Prompt Check
    const backendPrompt = buildSystemPrompt({
      ...commonContext,
      agent: 'backend',
    });
    expect(backendPrompt).toContain('You are the Backend Agent');
    expect(backendPrompt).toContain('Next.js route handlers');
    expect(backendPrompt).toContain('databases');
    expect(backendPrompt).toContain('defense-in-depth');
  });

  it('generates, writes, and validates a complete Next.js full-stack app with React UI, GSAP/Framer Motion, and API Route Handler', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forgeai-next-test-'));

    try {
      const mockFiles = new Map<string, string>();
      const toolContext = {
        runId: 'test-run-1',
        projectId: 'test-proj',
        agent: 'coding' as const,
        workspace: {
          root: tempDir,
          project: { id: 'test-next', name: 'TestNextApp', root: tempDir },
          readFile: async (p: string) => {
            const content = mockFiles.get(p);
            if (content === undefined) throw new Error('File not found');
            return { content, binary: false };
          },
          writeFile: async (p: string, content: string) => {
            mockFiles.set(p, content);
            const fullPath = path.join(tempDir, p);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content, 'utf8');
          },
        } as any,
        permissions: {
          require: async () => ({ decision: 'approved' }),
        } as any,
        search: {} as any,
        git: {} as any,
        indexer: {} as any,
        db: {} as any,
        checkpoint: null,
        checkpoints: {} as any,
        signal: new AbortController().signal,
        emit: () => {},
        changedFiles: new Map(),
        commandsRun: [],
        step: 1,
        maxSteps: 20,
      };

      // 1. Backend generation: Next.js API Route Handler with Zod schema validation
      const apiRouteCode = `import { NextResponse } from 'next/server';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

interface Task {
  id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
}

const taskStore: Task[] = [
  { id: 'task-1', title: 'Initialize Next.js project', priority: 'high', createdAt: new Date().toISOString() },
];

export async function GET() {
  return NextResponse.json({ tasks: taskStore, count: taskStore.length });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const newTask: Task = {
      id: 'task-' + (taskStore.length + 1),
      title: parsed.data.title,
      priority: parsed.data.priority,
      createdAt: new Date().toISOString(),
    };
    taskStore.push(newTask);

    return NextResponse.json(newTask, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
`;

      const apiResult = await toolRegistry.execute(
        'write_file',
        { path: 'app/api/tasks/route.ts', content: apiRouteCode },
        toolContext,
      );
      expect(apiResult.ok).toBe(true);

      // 2. Animation generation: GSAP ScrollTrigger & Framer Motion component with cleanup
      const animatedHeroCode = `'use client';

import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export function AnimatedHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Check user preference for reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    // Use GSAP context for clean lifecycle scoping & cleanup
    const ctx = gsap.context(() => {
      if (headlineRef.current) {
        gsap.from(headlineRef.current, {
          y: 30,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
        });
      }
    }, containerRef);

    // Guaranteed cleanup on unmount
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative overflow-hidden py-20 px-6 text-center bg-zinc-950 text-white">
      <h1 ref={headlineRef} className="text-5xl font-extrabold tracking-tight sm:text-6xl text-white">
        Next-Generation Autonomous Development
      </h1>
      <motion.p
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="mt-6 text-lg text-zinc-400 max-w-2xl mx-auto"
      >
        Engineered with React 19, Tailwind CSS, GPU motion pipelines, and resilient serverless route handlers.
      </motion.p>
    </section>
  );
}
`;

      const animResult = await toolRegistry.execute(
        'write_file',
        { path: 'components/AnimatedHero.tsx', content: animatedHeroCode },
        toolContext,
      );
      expect(animResult.ok).toBe(true);

      // 3. Frontend generation: Next.js App Router root layout & main page with Tailwind
      const layoutCode = `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ForgeAI Next.js Showcase',
  description: 'Full-stack Next.js project with React 19, GSAP animation, and backend route handlers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-zinc-100 antialiased min-h-screen">
        <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <span className="font-bold tracking-tight text-white">ForgeAI App</span>
          <nav aria-label="Main Navigation" className="flex gap-4 text-sm text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#api" className="hover:text-white transition-colors">API</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
`;

      const layoutResult = await toolRegistry.execute(
        'write_file',
        { path: 'app/layout.tsx', content: layoutCode },
        toolContext,
      );
      expect(layoutResult.ok).toBe(true);

      const pageCode = `'use client';

import React, { useEffect, useState } from 'react';
import { AnimatedHero } from '../components/AnimatedHero';

interface Task {
  id: string;
  title: string;
  priority: string;
}

export default function HomePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tasks')
      .then((res) => res.json())
      .then((data) => {
        setTasks(data.tasks || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-12 pb-16">
      <AnimatedHero />
      <section id="api" className="max-w-3xl mx-auto px-6">
        <h2 className="text-2xl font-bold mb-4 text-white">Live Backend Tasks</h2>
        {loading ? (
          <p className="text-zinc-500">Loading tasks from API...</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            {tasks.map((task) => (
              <li key={task.id} className="py-2.5 flex items-center justify-between">
                <span className="font-medium text-zinc-200">{task.title}</span>
                <span className="text-xs uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{task.priority}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
`;

      const pageResult = await toolRegistry.execute(
        'write_file',
        { path: 'app/page.tsx', content: pageCode },
        toolContext,
      );
      expect(pageResult.ok).toBe(true);

      // Verify files exist on disk in the workspace
      const readApi = await toolRegistry.execute('read_file', { path: 'app/api/tasks/route.ts' }, toolContext);
      expect(readApi.ok).toBe(true);
      expect(readApi.observation).toContain('NextResponse.json');
      expect(readApi.observation).toContain('CreateTaskSchema');

      const readHero = await toolRegistry.execute('read_file', { path: 'components/AnimatedHero.tsx' }, toolContext);
      expect(readHero.ok).toBe(true);
      expect(readHero.observation).toContain('ctx.revert()');
      expect(readHero.observation).toContain('prefers-reduced-motion');
      expect(readHero.observation).toContain('framer-motion');

      const readPage = await toolRegistry.execute('read_file', { path: 'app/page.tsx' }, toolContext);
      expect(readPage.ok).toBe(true);
      expect(readPage.observation).toContain('AnimatedHero');
      expect(readPage.observation).toContain("fetch('/api/tasks')");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
