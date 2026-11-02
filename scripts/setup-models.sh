#!/usr/bin/env bash
# ==============================================================================
# Sopu AI / ForgeAI — Automated Model Setup & Git Recipe Builder
# ==============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELFILES_DIR="$ROOT_DIR/modelfiles"

echo "🤖 Setting up Sopu AI optimized local models..."

# 1. Verify Ollama is available
if ! command -v ollama >/dev/null 2>&1; then
  echo "❌ Error: ollama is not installed or not in PATH."
  echo "   Install it from https://ollama.com/download"
  exit 1
fi

# 2. Check if Ollama server is responding
if ! curl -s -f http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "⏳ Starting Ollama in background..."
  ollama serve >/dev/null 2>&1 &
  sleep 3
fi

# 3. Pull required base weights
echo "📦 Step 1/3: Pulling base weights..."
echo " -> Pulling qwen2.5-coder:7b (Base for sopu-coder)..."
ollama pull qwen2.5-coder:7b

echo " -> Pulling qwen3.5:4b (Base for sopu-coder-fast)..."
ollama pull qwen3.5:4b

echo " -> Pulling nomic-embed-text (Base for codebase vector indexing)..."
ollama pull nomic-embed-text

# 4. Build custom optimized models from Git-tracked Modelfiles
echo "⚡ Step 2/3: Creating optimized Sopu AI models from Modelfiles..."
if [ -f "$MODELFILES_DIR/Modelfile.sopu-coder" ]; then
  echo " -> Creating sopu-coder..."
  ollama create sopu-coder -f "$MODELFILES_DIR/Modelfile.sopu-coder"
else
  echo "⚠️ Warning: $MODELFILES_DIR/Modelfile.sopu-coder not found!"
fi

if [ -f "$MODELFILES_DIR/Modelfile.sopu-coder-fast" ]; then
  echo " -> Creating sopu-coder-fast..."
  ollama create sopu-coder-fast -f "$MODELFILES_DIR/Modelfile.sopu-coder-fast"
else
  echo "⚠️ Warning: $MODELFILES_DIR/Modelfile.sopu-coder-fast not found!"
fi

# 5. Verify models
echo "✅ Step 3/3: Verifying installed models..."
ollama list

echo ""
echo "🎉 Setup complete! All optimized models are ready for Sopu AI."
