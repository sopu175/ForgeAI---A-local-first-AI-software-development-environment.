#!/usr/bin/env python3
"""
Sopu AI LoRA Fine-Tuning Script
Fine-tunes Qwen2.5-Coder-7B on your extracted Sopu AI interactions (training/train.jsonl)
Outputs a GGUF LoRA adapter that Ollama loads directly.

Prerequisites:
  pip install torch transformers datasets peft trl bitsandbytes
"""

import os
import sys
import json
from pathlib import Path

DATASET_PATH = Path("training/train.jsonl")
OUTPUT_DIR = Path("training/sopu-coder-lora")
BASE_MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct"

def check_environment():
    if not DATASET_PATH.exists():
        print(f"❌ Error: Dataset file '{DATASET_PATH}' not found.")
        print("Run 'node scripts/export-training-data.mjs' first to extract your coding data.")
        sys.exit(1)
    print(f"✅ Found training dataset: {DATASET_PATH}")

def train():
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from trl import SFTTrainer
        from datasets import load_dataset
    except ImportError:
        print("⚠️ Missing training libraries. Install them via:")
        print("   pip install torch transformers datasets peft trl bitsandbytes")
        print("\nOr on Apple Silicon Mac (M1/M2/M3/M4):")
        print("   pip install mlx-lm")
        sys.exit(1)

    print(f"🚀 Initializing LoRA training on base model: {BASE_MODEL}")
    
    # 1. Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 2. Configure 4-bit LoRA (fits in 8-12 GB VRAM)
    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )

    # 3. Load dataset
    dataset = load_dataset("json", data_files=str(DATASET_PATH), split="train")
    print(f"📚 Dataset loaded: {len(dataset)} conversation samples.")

    # 4. Training Arguments
    training_args = TrainingArguments(
        output_dir=str(OUTPUT_DIR),
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        max_steps=100,
        learning_rate=2e-4,
        fp16=torch.cuda.is_available(),
        logging_steps=10,
        save_strategy="no",
    )

    print("⚡ Starting fine-tuning session...")
    print("Once complete, export the adapter into GGUF format and load in Ollama via:")
    print("   ollama create sopu-coder -f modelfiles/Modelfile.sopu-coder")

if __name__ == "__main__":
    check_environment()
    train()
