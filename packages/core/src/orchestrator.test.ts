import { describe, expect, it } from 'vitest';
import { MultiAgentOrchestrator, planWorkflow } from './orchestrator';

describe('MultiAgentOrchestrator', () => {
  it('plans a specialized frontend & animation workflow when requested', () => {
    const plan = planWorkflow('Create a smooth GSAP hero animation with ScrollTrigger');
    expect(plan.steps.some((s) => s.agent === 'animation')).toBe(true);
    expect(plan.steps.some((s) => s.agent === 'testing')).toBe(true);
    expect(plan.steps.some((s) => s.agent === 'review')).toBe(true);
  });

  it('plans full-stack workflow with backend and frontend handoffs', () => {
    const plan = planWorkflow('Build full-stack user authentication API and login page UI');
    const backendStep = plan.steps.find((s) => s.agent === 'backend');
    const frontendStep = plan.steps.find((s) => s.agent === 'frontend');
    expect(backendStep).toBeDefined();
    expect(frontendStep).toBeDefined();
    // Backend must be sequenced before Frontend
    const backendIdx = plan.steps.indexOf(backendStep!);
    const frontendIdx = plan.steps.indexOf(frontendStep!);
    expect(backendIdx).toBeLessThan(frontendIdx);
  });

  it('sequences Planner for complex architectures', () => {
    const plan = planWorkflow('Large architectural refactor of the entire state management system');
    expect(plan.steps[0]?.agent).toBe('planner');
  });

  it('orchestrates stepping, handoffs, and completion', () => {
    const plan = planWorkflow('Add button');
    const orch = new MultiAgentOrchestrator(plan);
    expect(orch.isFinished).toBe(false);

    while (!orch.isFinished) {
      const step = orch.currentStep;
      if (!step) break;
      orch.advance(`Completed output for ${step.agent}`);
    }

    expect(orch.isFinished).toBe(true);
    expect(plan.status).toBe('completed');
  });

  it('marks workflow failed when a step fails', () => {
    const plan = planWorkflow('Fix bug');
    const orch = new MultiAgentOrchestrator(plan);
    orch.failCurrent('Tests failed with 2 assertions');
    expect(orch.isFinished).toBe(true);
    expect(plan.status).toBe('failed');
    expect(plan.steps[0]?.status).toBe('failed');
  });
});
