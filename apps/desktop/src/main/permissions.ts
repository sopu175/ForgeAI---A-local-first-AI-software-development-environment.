import { nanoid } from 'nanoid';
import type { PermissionDecision, PermissionKind, PermissionRequest, PermissionResponse } from '@forgeai/shared';
import type { Database } from './db';
import type { SettingsService } from './services/settings';
import type { Broadcast } from './services/workspace';

interface PendingPermission {
  request: PermissionRequest;
  resolve: (response: PermissionResponse) => void;
  timer: NodeJS.Timeout;
}

export class PermissionBroker {
  private pending = new Map<string, PendingPermission>();
  private sessionAllowed = new Set<PermissionKind>();

  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly broadcast: Broadcast,
  ) {}

  pendingRequests(): PermissionRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  async require(
    input: Omit<PermissionRequest, 'id' | 'createdAt'>,
  ): Promise<{ decision: PermissionDecision; acceptedHunks?: number[] }> {
    const policy = this.policyFor(input.kind);
    if (input.dangerous) {
      // Always require an explicit human decision for destructive commands.
    } else if (policy === 'auto' || this.sessionAllowed.has(input.kind)) {
      const decision: PermissionDecision = 'approved';
      this.audit(input, decision);
      return { decision };
    }

    const request: PermissionRequest = {
      ...input,
      id: `perm-${nanoid(10)}`,
      createdAt: Date.now(),
    };
    this.broadcast('permission:request', request);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(request.id);
        if (!entry) return;
        this.pending.delete(request.id);
        this.audit(input, 'denied');
        this.broadcast('permission:resolved', { id: request.id, decision: 'denied' });
        entry.resolve({ id: request.id, decision: 'denied' });
      }, 5 * 60_000);
      timer.unref?.();
      this.pending.set(request.id, {
        request,
        timer,
        resolve: (response) => {
          this.audit(input, response.decision);
          this.broadcast('permission:resolved', { id: request.id, decision: response.decision });
          resolve({ decision: response.decision, acceptedHunks: response.acceptedHunks });
        },
      });
    });
  }

  respond(response: PermissionResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(response.id);
    if (response.decision === 'session') {
      this.sessionAllowed.add(entry.request.kind);
    }
    this.audit(
      {
        ...entry.request,
        toolName: entry.request.toolName,
      },
      response.decision,
    );
    this.broadcast('permission:resolved', { id: response.id, decision: response.decision });
    entry.resolve(response);
  }

  denyAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.audit(entry.request, 'denied');
      this.broadcast('permission:resolved', { id, decision: 'denied' });
      entry.resolve({ id, decision: 'denied' });
      this.pending.delete(id);
    }
  }

  resetSession(): void {
    this.sessionAllowed.clear();
  }

  private policyFor(kind: PermissionKind): 'once' | 'session' | 'auto' | 'always' {
    const approval = this.settings.get().approval;
    switch (kind) {
      case 'write':
        return approval.writes;
      case 'delete':
        return approval.deletes === 'session' ? 'session' : 'always';
      case 'command':
        return approval.commands;
      case 'install':
        return approval.installs;
      case 'network':
        return approval.network;
      case 'commit':
        return approval.commits;
      case 'restore':
        return 'always';
      default:
        return 'once';
    }
  }

  private audit(
    request: Omit<PermissionRequest, 'id' | 'createdAt'> | PermissionRequest,
    decision: PermissionDecision,
  ): void {
    this.db.auditPermission({
      tool: request.toolName ?? request.kind,
      request: {
        title: request.title,
        detail: request.detail,
        command: request.command,
        paths: request.paths,
      },
      decision,
    });
  }
}
