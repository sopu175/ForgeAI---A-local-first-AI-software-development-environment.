import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { createFileChange, scanProject } from '@forgeai/core';
import type { Checkpoint, FileChange } from '@forgeai/shared';
import type { Database } from '../db';
import type { WorkspaceService } from './workspace';

interface ManifestEntry {
  path: string;
  existed: boolean;
  backup?: string;
}

interface Manifest {
  version: 1;
  id: string;
  projectId: string;
  label: string;
  kind: Checkpoint['kind'];
  createdAt: number;
  entries: ManifestEntry[];
}

const MAX_BACKUP_BYTES = 30 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface AgentCheckpointHandle {
  id: string;
  record(relativePath: string, before: string, existed: boolean): Promise<void>;
  finalize(): Promise<Checkpoint | null>;
}

export class CheckpointService {
  constructor(
    private readonly db: Database,
    private readonly workspace: WorkspaceService,
    private readonly userDataDir: string,
  ) {}

  list(projectId: string): Checkpoint[] {
    return this.db.listCheckpoints(projectId);
  }

  private baseDir(projectId: string): string {
    return path.join(this.userDataDir, 'checkpoints', projectId);
  }

  private backupName(relativePath: string): string {
    return `${crypto.createHash('sha1').update(relativePath).digest('hex')}.bak`;
  }

  private async writeBackup(dir: string, relativePath: string, content: string): Promise<string> {
    const name = this.backupName(relativePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), content, 'utf8');
    return name;
  }

  private async writeManifest(dir: string, manifest: Manifest): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }

  private async readManifest(dir: string): Promise<Manifest> {
    return JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  }

  async create(projectId: string, label: string): Promise<Checkpoint> {
    if (this.workspace.projectId !== projectId) throw new Error('Open this project before creating a checkpoint');
    const id = `cp-${Date.now().toString(36)}-${nanoid(6)}`;
    const dir = path.join(this.baseDir(projectId), id);
    const createdAt = Date.now();
    const entries: ManifestEntry[] = [];
    const files = await scanProject(this.workspace.root, { maxFileSizeKb: 512 });
    let totalBytes = 0;
    for (const file of files.slice(0, 1200)) {
      if (totalBytes + file.size > MAX_BACKUP_BYTES) break;
      if (file.size > MAX_FILE_BYTES) continue;
      try {
        const content = await fs.readFile(path.join(this.workspace.root, file.path), 'utf8');
        const backup = await this.writeBackup(dir, file.path, content);
        entries.push({ path: file.path, existed: true, backup });
        totalBytes += file.size;
      } catch {
        // Skip unreadable files.
      }
    }
    const manifest: Manifest = {
      version: 1,
      id,
      projectId,
      label,
      kind: 'manual',
      createdAt,
      entries,
    };
    await this.writeManifest(dir, manifest);
    this.db.createCheckpoint({
      id,
      projectId,
      label,
      kind: 'manual',
      files: entries.map((entry) => entry.path),
      dir,
    });
    return {
      id,
      projectId,
      label,
      kind: 'manual',
      createdAt,
      fileCount: entries.length,
      files: entries.map((entry) => entry.path),
    };
  }

  async beginAgent(projectId: string, label: string): Promise<AgentCheckpointHandle> {
    const id = `cp-${Date.now().toString(36)}-${nanoid(6)}`;
    const dir = path.join(this.baseDir(projectId), id);
    const createdAt = Date.now();
    const entries = new Map<string, ManifestEntry>();
    let manifestWritten = false;
    const write = async (kind: Checkpoint['kind']) => {
      const manifest: Manifest = {
        version: 1,
        id,
        projectId,
        label,
        kind,
        createdAt,
        entries: [...entries.values()],
      };
      await this.writeManifest(dir, manifest);
      manifestWritten = true;
    };
    const handle: AgentCheckpointHandle = {
      id,
      record: async (relativePath, before, existed) => {
        if (entries.has(relativePath)) return;
        const backup = existed ? await this.writeBackup(dir, relativePath, before) : undefined;
        entries.set(relativePath, { path: relativePath, existed, backup });
        await write('agent');
        this.db.updateCheckpointFiles(id, [...entries.keys()], dir);
      },
      finalize: async () => {
        if (entries.size === 0) {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
          this.db.deleteCheckpoint(id);
          return null;
        }
        if (!manifestWritten) await write('agent');
        return {
          id,
          projectId,
          label,
          kind: 'agent',
          createdAt,
          fileCount: entries.size,
          files: [...entries.keys()],
        };
      },
    };
    // Register early so a crash still leaves a discoverable (possibly empty) checkpoint.
    this.db.createCheckpoint({ id, projectId, label, kind: 'agent', files: [], dir });
    return handle;
  }

  async diff(projectId: string, checkpointId: string): Promise<FileChange[]> {
    const row = this.db.getCheckpointRow(checkpointId);
    if (!row || row.projectId !== projectId || !row.dir) return [];
    const manifest = await this.readManifest(row.dir);
    const changes: FileChange[] = [];
    for (const entry of manifest.entries) {
      let current = '';
      let exists = true;
      try {
        current = await fs.readFile(await this.workspace.resolveSafe(entry.path, false), 'utf8');
      } catch {
        exists = false;
      }
      let backup = '';
      if (entry.existed && entry.backup) {
        backup = await fs.readFile(path.join(row.dir, entry.backup), 'utf8').catch(() => '');
      }
      if (current === backup) continue;
      changes.push(
        createFileChange(entry.path, current, backup, {
          changeType: backup === '' ? 'delete' : exists ? 'update' : 'create',
        }),
      );
    }
    return changes;
  }

  async restore(projectId: string, checkpointId: string): Promise<void> {
    if (this.workspace.projectId !== projectId) throw new Error('Open this project before restoring a checkpoint');
    const row = this.db.getCheckpointRow(checkpointId);
    if (!row || row.projectId !== projectId) throw new Error('Checkpoint not found');
    if (!row.dir) throw new Error('This checkpoint has no stored files');
    const manifest = await this.readManifest(row.dir);

    // Snapshot the current state first so a restore can itself be undone.
    const rollbackId = `cp-${Date.now().toString(36)}-${nanoid(6)}`;
    const rollbackDir = path.join(this.baseDir(projectId), rollbackId);
    const rollbackEntries: ManifestEntry[] = [];
    for (const entry of manifest.entries) {
      try {
        const absolute = await this.workspace.resolveSafe(entry.path, false);
        const content = await fs.readFile(absolute, 'utf8');
        const backup = await this.writeBackup(rollbackDir, entry.path, content);
        rollbackEntries.push({ path: entry.path, existed: true, backup });
      } catch {
        rollbackEntries.push({ path: entry.path, existed: false });
      }
    }
    if (rollbackEntries.length > 0) {
      const rollbackManifest: Manifest = {
        version: 1,
        id: rollbackId,
        projectId,
        label: `Before restore of ${row.label}`,
        kind: 'rollback',
        createdAt: Date.now(),
        entries: rollbackEntries,
      };
      await this.writeManifest(rollbackDir, rollbackManifest);
      this.db.createCheckpoint({
        id: rollbackId,
        projectId,
        label: rollbackManifest.label,
        kind: 'rollback',
        files: rollbackEntries.map((entry) => entry.path),
        dir: rollbackDir,
      });
    }

    for (const entry of manifest.entries) {
      const absolute = await this.workspace.resolveSafe(entry.path);
      if (entry.existed && entry.backup) {
        const content = await fs.readFile(path.join(row.dir, entry.backup), 'utf8');
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, content, 'utf8');
      } else {
        await fs.rm(absolute, { force: true }).catch(() => undefined);
      }
    }
  }
}
