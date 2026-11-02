#!/usr/bin/env node
/**
 * Sopu AI Training Data Exporter
 * Extracts high-quality conversation pairs from ForgeAI/Sopu AI's local SQLite database
 * into standard instruction-tuning JSONL format (ShareGPT / HuggingFace format)
 * ready for fine-tuning via Unsloth, MLX, Llama.cpp, or Hugging Face.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function getDbPath() {
  if (process.env.FORGEAI_DB_PATH && fs.existsSync(process.env.FORGEAI_DB_PATH)) {
    return process.env.FORGEAI_DB_PATH;
  }
  const appData =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.config');

  return path.join(appData, 'ForgeAI', 'forgeai.db');
}

const dbPath = getDbPath();
if (!fs.existsSync(dbPath)) {
  console.log(`[export] No existing ForgeAI database found at ${dbPath}`);
  console.log(`[export] Chat or run the agent in Sopu AI first to generate training interactions.`);
  process.exit(0);
}

try {
  const db = new DatabaseSync(dbPath);
  const conversations = db.prepare('SELECT id, title, mode FROM conversations').all();

  const outDir = path.join(process.cwd(), 'training');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'train.jsonl');

  let turnsCount = 0;
  let conversationsCount = 0;
  const stream = fs.createWriteStream(outFile, { encoding: 'utf8' });

  for (const conv of conversations) {
    const messages = db
      .prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conv.id);

    if (messages.length < 2) continue;

    const validMessages = [];
    for (const m of messages) {
      const text = (m.content || '').trim();
      // Skip empty or raw tool calls
      if (!text || text.startsWith('{"name"') || text.startsWith('```json\n{"name"')) continue;
      validMessages.push({ role: m.role, content: text });
    }

    if (validMessages.length >= 2) {
      stream.write(JSON.stringify({ messages: validMessages }) + '\n');
      turnsCount += validMessages.length;
      conversationsCount++;
    }
  }

  stream.end();
  console.log(`✅ [export] Extracted ${conversationsCount} conversations (${turnsCount} turns) into:`);
  console.log(`   ${outFile}`);
  console.log(`\nNext steps for training your custom model:`);
  console.log(`1. Fine-tune base qwen2.5-coder:7b using Unsloth or Apple MLX.`);
  console.log(`2. Export LoRA adapter or merged GGUF.`);
  console.log(`3. Update modelfiles/Modelfile.sopu-coder or push to Ollama:`);
  console.log(`   ollama create sopu-coder -f modelfiles/Modelfile.sopu-coder`);
  console.log(`   ollama push <your-username>/sopu-coder`);
} catch (error) {
  console.error('[export] Failed to export training data:', error instanceof Error ? error.message : error);
  process.exit(1);
}
