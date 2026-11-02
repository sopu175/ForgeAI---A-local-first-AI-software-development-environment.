import { DEFAULT_SETTINGS, type AppSettings, type ModelRole, type RoleBinding } from '@forgeai/shared';
import type { Database } from '../db';

const KEY = 'app:settings';

export type SettingsPatch = Omit<
  Partial<AppSettings>,
  'approval' | 'indexing' | 'completion' | 'agent' | 'editor' | 'preview' | 'terminal'
> & {
  approval?: Partial<AppSettings['approval']>;
  indexing?: Partial<AppSettings['indexing']>;
  completion?: Partial<AppSettings['completion']>;
  agent?: Partial<AppSettings['agent']>;
  editor?: Partial<AppSettings['editor']>;
  preview?: Partial<AppSettings['preview']>;
  terminal?: Partial<AppSettings['terminal']>;
};

function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    ...base,
    ...patch,
    editor: { ...base.editor, ...(patch.editor ?? {}) },
    preview: { ...base.preview, ...(patch.preview ?? {}) },
    terminal: { ...base.terminal, ...(patch.terminal ?? {}) },
    approval: { ...base.approval, ...(patch.approval ?? {}) },
    indexing: { ...base.indexing, ...(patch.indexing ?? {}) },
    completion: { ...base.completion, ...(patch.completion ?? {}) },
    agent: { ...base.agent, ...(patch.agent ?? {}) },
    modelRoles: { ...base.modelRoles, ...(patch.modelRoles ?? {}) },
    telemetry: false,
  };
}

export class SettingsService {
  private cached: AppSettings | null = null;

  constructor(private readonly db: Database) {}

  get(): AppSettings {
    if (this.cached) return this.cached;
    const raw = this.db.getSetting(KEY);
    if (!raw) {
      this.cached = structuredClone(DEFAULT_SETTINGS);
      return this.cached;
    }
    try {
      this.cached = mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw) as Partial<AppSettings>);
    } catch {
      this.cached = structuredClone(DEFAULT_SETTINGS);
    }
    return this.cached;
  }

  update(patch: SettingsPatch): AppSettings {
    const next = mergeSettings(this.get(), patch);
    this.cached = next;
    this.db.setSetting(KEY, JSON.stringify(next));
    return next;
  }

  role(role: ModelRole): RoleBinding | undefined {
    return this.get().modelRoles[role];
  }

  setRole(role: ModelRole, binding: RoleBinding): AppSettings {
    return this.update({ modelRoles: { ...this.get().modelRoles, [role]: binding } });
  }

  clearRole(role: ModelRole): AppSettings {
    const roles = { ...this.get().modelRoles };
    delete roles[role];
    return this.update({ modelRoles: roles });
  }
}
