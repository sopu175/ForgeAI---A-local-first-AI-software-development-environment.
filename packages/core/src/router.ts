import type {
  ModelCapabilities,
  ModelInfo,
  ModelRole,
  RoleBinding,
} from '@forgeai/shared';

export type RoutingTask =
  | 'chat'
  | 'plan'
  | 'coding'
  | 'frontend'
  | 'animation'
  | 'backend'
  | 'seo'
  | 'testing'
  | 'review'
  | 'docs'
  | 'fast'
  | 'embedding';

export interface RouteRequest {
  task: RoutingTask;
  requiredCapabilities?: Partial<ModelCapabilities>;
  minContextTokens?: number;
  userOverride?: RoleBinding;
}

export interface RouteDecision {
  binding: RoleBinding;
  reason: string;
  fallbackUsed: boolean;
  model: ModelInfo;
}

const TASK_TO_PRIMARY_ROLE: Record<RoutingTask, ModelRole> = {
  chat: 'chat',
  plan: 'plan',
  coding: 'coding',
  frontend: 'frontend',
  animation: 'animation',
  backend: 'backend',
  seo: 'seo',
  testing: 'testing',
  review: 'review',
  docs: 'chat',
  fast: 'fast',
  embedding: 'embedding',
};

const FALLBACK_CHAIN: Record<RoutingTask, ModelRole[]> = {
  chat: ['coding', 'fast'],
  plan: ['coding', 'review', 'chat'],
  coding: ['frontend', 'backend', 'chat'],
  frontend: ['coding', 'chat'],
  animation: ['frontend', 'coding', 'chat'],
  backend: ['coding', 'chat'],
  seo: ['coding', 'chat'],
  testing: ['coding', 'chat'],
  review: ['plan', 'coding', 'chat'],
  docs: ['chat', 'coding'],
  fast: ['coding', 'chat'],
  embedding: [],
};

export class ModelRouter {
  constructor(
    private readonly getModels: () => ModelInfo[],
    private readonly getRoleBindings: () => Partial<Record<ModelRole, RoleBinding>>,
  ) {}

  route(request: RouteRequest): RouteDecision {
    const models = this.getModels();
    const installed = models.filter((m) => m.installed);
    const bindings = this.getRoleBindings();

    // 1. User Override Check
    if (request.userOverride) {
      const match = installed.find(
        (m) => m.providerId === request.userOverride!.providerId && m.id === request.userOverride!.model,
      );
      if (match) {
        if (this.satisfies(match, request.requiredCapabilities)) {
          return {
            binding: request.userOverride,
            reason: `User explicit override for ${request.task}`,
            fallbackUsed: false,
            model: match,
          };
        }
      }
    }

    // 2. Primary Configured Role
    const primaryRole = TASK_TO_PRIMARY_ROLE[request.task];
    const primaryBinding = bindings[primaryRole];
    if (primaryBinding) {
      const match = installed.find(
        (m) => m.providerId === primaryBinding.providerId && m.id === primaryBinding.model,
      );
      if (match && this.satisfies(match, request.requiredCapabilities)) {
        return {
          binding: primaryBinding,
          reason: `Configured primary role for ${primaryRole}`,
          fallbackUsed: false,
          model: match,
        };
      }
    }

    // 3. Fallback Roles in Chain
    const fallbacks = FALLBACK_CHAIN[request.task] ?? [];
    for (const fallbackRole of fallbacks) {
      const fallbackBinding = bindings[fallbackRole];
      if (fallbackBinding) {
        const match = installed.find(
          (m) => m.providerId === fallbackBinding.providerId && m.id === fallbackBinding.model,
        );
        if (match && this.satisfies(match, request.requiredCapabilities)) {
          return {
            binding: fallbackBinding,
            reason: `Fallback to configured ${fallbackRole} role for ${request.task}`,
            fallbackUsed: true,
            model: match,
          };
        }
      }
    }

    // 4. Any Installed Compatible Model
    const candidates = installed.filter((m) => {
      if (request.task === 'embedding') return m.capabilities.embedding;
      return !m.capabilities.embedding && this.satisfies(m, request.requiredCapabilities);
    });

    if (candidates.length > 0) {
      const best = candidates[0]!;
      return {
        binding: { providerId: best.providerId, model: best.id },
        reason: `Automated capability match (${best.id}) for ${request.task}`,
        fallbackUsed: true,
        model: best,
      };
    }

    // 5. Unrecoverable
    const missing = request.requiredCapabilities?.tools
      ? 'tool-calling'
      : request.task === 'embedding'
        ? 'embedding'
        : 'text generation';
    throw new Error(
      `No available model found with ${missing} capability for ${request.task}. Check Models in Settings to download or enable a compatible model.`,
    );
  }

  private satisfies(model: ModelInfo, required?: Partial<ModelCapabilities>): boolean {
    if (!required) return true;
    if (required.tools && !model.capabilities.tools) return false;
    if (required.embedding && !model.capabilities.embedding) return false;
    if (required.vision && !model.capabilities.vision) return false;
    if (required.thinking && !model.capabilities.thinking) return false;
    return true;
  }
}
