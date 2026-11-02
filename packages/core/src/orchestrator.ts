import type { AgentKind } from '@forgeai/shared';

export interface WorkflowStep {
  id: string;
  agent: AgentKind;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  filesAllowed?: string[];
  output?: string;
  error?: string;
}

export interface WorkflowPlan {
  id: string;
  goal: string;
  requiresTesting: boolean;
  requiresReview: boolean;
  steps: WorkflowStep[];
  status: 'idle' | 'running' | 'completed' | 'failed';
}

export function planWorkflow(goal: string, contextSummary?: string): WorkflowPlan {
  const lower = `${goal} ${contextSummary ?? ''}`.toLowerCase();
  const steps: WorkflowStep[] = [];

  // 1. Planning phase for complex multi-step requests
  const isComplex =
    /refactor|redesign|implement|architecture|migration|full-stack|full stack|system/i.test(lower) ||
    goal.length > 80;

  if (isComplex) {
    steps.push({
      id: 'step-plan',
      agent: 'planner',
      description: 'Analyze project context, verify dependencies, and draft execution plan.',
      status: 'pending',
    });
  }

  // 2. Determine specialist implementation agent(s)
  const isAnimation = /animation|motion|gsap|three\.?js|framer|canvas|transition|scrolltrigger/i.test(lower);
  const isFrontend = isAnimation || /ui|frontend|react|next|component|page|layout|css|tailwind|html|button|modal/i.test(lower);
  const isBackend = /backend|api|database|sql|sqlite|postgres|auth|route|endpoint|server/i.test(lower);
  const isSEO = /seo|metadata|sitemap|robots|canonical|open graph|og:|twitter card|meta description/i.test(lower);

  if (isFrontend && isBackend) {
    steps.push({
      id: 'step-backend',
      agent: 'backend',
      description: 'Implement server APIs, models, and endpoints.',
      status: 'pending',
    });
    steps.push({
      id: 'step-frontend',
      agent: 'frontend',
      description: 'Build user interface, layouts, and API integrations.',
      status: 'pending',
    });
  } else if (isAnimation) {
    steps.push({
      id: 'step-animation',
      agent: 'animation',
      description: 'Implement interactive animations, GPU transitions, and lifecycle cleanup.',
      status: 'pending',
    });
  } else if (isFrontend) {
    steps.push({
      id: 'step-frontend',
      agent: 'frontend',
      description: 'Implement UI components, styling, and interactions.',
      status: 'pending',
    });
  } else if (isBackend) {
    steps.push({
      id: 'step-backend',
      agent: 'backend',
      description: 'Implement backend APIs, validation, and data persistence.',
      status: 'pending',
    });
  } else if (isSEO) {
    steps.push({
      id: 'step-seo',
      agent: 'seo',
      description: 'Audit and update technical SEO metadata, canonical URLs, and schema markup.',
      status: 'pending',
    });
  } else {
    steps.push({
      id: 'step-code',
      agent: 'coding',
      description: 'Implement the requested change end-to-end.',
      status: 'pending',
    });
  }

  // 3. Testing phase
  const requiresTesting = !isSEO && !goal.toLowerCase().startsWith('explain');
  if (requiresTesting) {
    steps.push({
      id: 'step-test',
      agent: 'testing',
      description: 'Verify changes with deterministic unit/integration tests.',
      status: 'pending',
    });
  }

  // 4. Code Review phase
  steps.push({
    id: 'step-review',
    agent: 'review',
    description: 'Review git diffs for correctness, security, regressions, and style.',
    status: 'pending',
  });

  return {
    id: `wf-${Date.now()}`,
    goal,
    requiresTesting,
    requiresReview: true,
    steps,
    status: 'idle',
  };
}

export class MultiAgentOrchestrator {
  private plan: WorkflowPlan;
  private currentStepIndex = 0;

  constructor(plan: WorkflowPlan) {
    this.plan = plan;
  }

  get currentStep(): WorkflowStep | undefined {
    return this.plan.steps[this.currentStepIndex];
  }

  get isFinished(): boolean {
    return this.currentStepIndex >= this.plan.steps.length || this.plan.status === 'failed';
  }

  get steps(): WorkflowStep[] {
    return this.plan.steps;
  }

  advance(stepOutput?: string): WorkflowStep | null {
    if (this.currentStep) {
      this.currentStep.status = 'completed';
      this.currentStep.output = stepOutput;
    }
    this.currentStepIndex += 1;
    if (this.currentStepIndex < this.plan.steps.length) {
      const next = this.plan.steps[this.currentStepIndex]!;
      next.status = 'running';
      return next;
    }
    this.plan.status = 'completed';
    return null;
  }

  failCurrent(error: string): void {
    if (this.currentStep) {
      this.currentStep.status = 'failed';
      this.currentStep.error = error;
    }
    this.plan.status = 'failed';
  }
}

