#!/bin/bash

# Kobold Card Architect - Optimized KoboldCpp Launcher
# Searches /home/peej/ai-tools/ and all subfolders for models.

SEARCH_ROOT="/home/peej/ai-tools"
SEARCH_ROOT2="/run/media/peej/2C2889EF2889B87A/Users/power/Desktop/back up/AI/models"

LLM_MODEL=""
SD_MODEL=""
SD_VAE=""

# ── Known SD model keywords — used to exclude them from the LLM list ────────
is_sd_model() {
    local name
    name=$(basename "$1" | tr '[:upper:]' '[:lower:]')
    [[ "$name" == *flux* || "$name" == *sd_* || "$name" == *stable_diff* || \
       "$name" == *z_image* || "$name" == *animagine* || "$name" == *pony* || \
       "$name" == *xl_base* || "$name" == *xl_refiner* || "$name" == *sdxl* || \
       "$name" == *turbo* && "$name" != *instruct* ]]
}

# Helper to resolve a bare filename against SEARCH_ROOT
resolve_path() {
    if [ -f "$1" ]; then
        echo "$1"
    else
        local found
        found=$(find "$SEARCH_ROOT" -type f -name "$(basename "$1")" 2>/dev/null | head -1)
        echo "$found"
    fi
}

# ── Argument mode: start-kobold.sh <llm> [sd_model] ─────────────────────────
if [ -n "$1" ]; then
    LLM_MODEL=$(resolve_path "$1")
    if [ -z "$LLM_MODEL" ]; then
        echo "❌ Error: LLM model '$1' not found under $SEARCH_ROOT."
        exit 1
    fi
    if [ -n "$2" ]; then
        SD_MODEL=$(resolve_path "$2")
        if [ -z "$SD_MODEL" ]; then
            echo "❌ Error: SD model '$2' not found under $SEARCH_ROOT."
            exit 1
        fi
    fi
else
    # ── Interactive mode ─────────────────────────────────────────────────────
    echo "================================================================="
    echo "  Kobold Card Architect - Interactive AI Server Launcher"
    echo "================================================================="
    echo "Searching $SEARCH_ROOT for models..."
    echo ""

    # ── LLM selection — all .gguf files, excluding known SD model names ──────
    llm_files=()
    while IFS= read -r f; do
        is_sd_model "$f" || llm_files+=("$f")
    done < <({ find "$SEARCH_ROOT" -type f -name "*.gguf" 2>/dev/null; find "$SEARCH_ROOT2" -path "*/gguf/llm/*" -name "*.gguf" -o -path "*/LLM/*" -name "*.gguf" 2>/dev/null; } | sort -u)

    if [ ${#llm_files[@]} -eq 0 ]; then
        echo "❌ No LLM .gguf models found under $SEARCH_ROOT."
        exit 1
    fi

    echo "Select an LLM to load:"
    PS3="Enter number: "
    select llm_choice in "${llm_files[@]}"; do
        if [ -n "$llm_choice" ]; then
            LLM_MODEL="$llm_choice"
            break
        else
            echo "Invalid selection."
        fi
    done

    # ── SD model selection — .gguf SD models + .safetensors ─────────────────
    echo ""
    echo "Scanning for Stable Diffusion models (.gguf SD + .safetensors)..."
    sd_files=()
    while IFS= read -r f; do
        is_sd_model "$f" && sd_files+=("$f")
    done < <({ find "$SEARCH_ROOT" -type f -name "*.gguf" 2>/dev/null; find "$SEARCH_ROOT2" -path "*/diffusion_models/*" -name "*.gguf" -o -path "*/checkpoints/*" -name "*.gguf" 2>/dev/null; } | sort -u)
    while IFS= read -r f; do
        sd_files+=("$f")
    done < <({ find "$SEARCH_ROOT" -type f -name "*.safetensors" 2>/dev/null; find "$SEARCH_ROOT2" \( -path "*/checkpoints/*" -o -path "*/diffusion_models/*" \) -name "*.safetensors" 2>/dev/null; } | sort -u)

    if [ ${#sd_files[@]} -gt 0 ]; then
        echo ""
        echo "Select a Stable Diffusion model for Portrait Generation:"
        select sd_choice in "None (Skip)" "${sd_files[@]}"; do
            if [ "$REPLY" -eq 1 ]; then
                SD_MODEL=""
                break
            elif [ -n "$sd_choice" ]; then
                SD_MODEL="$sd_choice"
                break
            else
                echo "Invalid selection."
            fi
        done
    fi

    # ── VAE selection (optional, for Flux/SDXL) ───────────────────────────────
    if [ -n "$SD_MODEL" ]; then
        # Also offer clip1 selection for Flux/Z-Image Turbo models
        clip_files=()
        while IFS= read -r f; do
            clip_files+=("$f")
        done < <({ find "$SEARCH_ROOT" -type f \( -name "*clip*.safetensors" -o -name "*clip*.gguf" \) 2>/dev/null; find "$SEARCH_ROOT2" -path "*/clip/*" -type f \( -name "*.safetensors" -o -name "*.gguf" \) 2>/dev/null; } | grep -vi "vision\|mmproj\|bge\|arctic\|embed" | sort -u)

        if [ ${#clip_files[@]} -gt 0 ]; then
            echo ""
            echo "Select a CLIP text encoder (required for Flux/Z-Image Turbo GGUF):"
            select clip_choice in "None (Skip)" "${clip_files[@]}"; do
                if [ "$REPLY" -eq 1 ]; then
                    SD_CLIP1=""
                    break
                elif [ -n "$clip_choice" ]; then
                    SD_CLIP1="$clip_choice"
                    break
                else
                    echo "Invalid selection."
                fi
            done
        fi

        vae_files=()
        while IFS= read -r f; do
            vae_files+=("$f")
        done < <({ find "$SEARCH_ROOT" -type f -name "*.safetensors" 2>/dev/null; find "$SEARCH_ROOT2" -path "*/vae/*" -name "*.safetensors" 2>/dev/null; } | grep -i "vae\|ae\." | sort -u)

        if [ ${#vae_files[@]} -gt 0 ]; then
            echo ""
            echo "Select a VAE (optional, needed for Flux/SDXL):"
            select vae_choice in "None (Skip)" "${vae_files[@]}"; do
                if [ "$REPLY" -eq 1 ]; then
                    SD_VAE=""
                    break
                elif [ -n "$vae_choice" ]; then
                    SD_VAE="$vae_choice"
                    break
                else
                    echo "Invalid selection."
                fi
            done
        fi
    fi
fi

# ── Launch ───────────────────────────────────────────────────────────────────

CONTEXT_SIZE=12288

KOBOLD_ARGS=(
    "--model"       "$LLM_MODEL"
    "--host"        "0.0.0.0"    # Allows the browser app to reach the API
    "--port"        "5001"       # Matches VITE_LOCAL_AI_URL default
    "--contextsize" "$CONTEXT_SIZE"
    "--gpulayers"   "-1"         # Offload all layers to GPU automatically
    "--usecublas"               # CUDA acceleration (graceful fallback if absent)
    "--flashattention"          # Faster, lower-VRAM attention
    "--quantkv"     "1"         # Q8 KV cache — saves VRAM with minimal quality loss
    "--threads"     "0"         # Auto CPU threads
)

echo ""
echo "================================================================="
if [ -n "$SD_MODEL" ]; then
    echo "[Info] Enabling Stable Diffusion portrait generation..."
    KOBOLD_ARGS+=(
        "--sdmodel"        "$SD_MODEL"
        "--sdflashattention"            # Speed up SD and reduce VRAM
        "--sdoffloadcpu"               # Run SD diffusion on CPU (keeps VRAM for LLM)
        "--sdvaecpu"                   # Run VAE on CPU (consistent with CPU offload)
    )
    if [ -n "${SD_CLIP1:-}" ]; then
        KOBOLD_ARGS+=("--sdclip1" "$SD_CLIP1")
        echo "[Info] CLIP1: $SD_CLIP1"
    fi
    if [ -n "$SD_VAE" ]; then
        KOBOLD_ARGS+=("--sdvae" "$SD_VAE")
        echo "[Info] VAE: $SD_VAE"
    fi
    echo "[Info] SD Model: $SD_MODEL"
fi

echo "[Info] LLM: $LLM_MODEL"
echo "[Info] Port: 5001 | Context: $CONTEXT_SIZE | Host: 0.0.0.0"
echo "================================================================="
echo ""

# Find and execute KoboldCpp
if command -v koboldcpp &>/dev/null; then
    koboldcpp "${KOBOLD_ARGS[@]}"
elif [ -f "./koboldcpp" ]; then
    ./koboldcpp "${KOBOLD_ARGS[@]}"
elif [ -f "./koboldcpp-linux-x64" ]; then
    ./koboldcpp-linux-x64 "${KOBOLD_ARGS[@]}"
elif [ -f "./koboldcpp.py" ]; then
    python3 ./koboldcpp.py "${KOBOLD_ARGS[@]}"
else
    echo ""
    echo "❌ Error: koboldcpp binary not found in PATH or current directory."
    echo "Place koboldcpp-linux-x64 in this folder or install koboldcpp globally."
    exit 1
fi