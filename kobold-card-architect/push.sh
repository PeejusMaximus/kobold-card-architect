#!/bin/bash
# push.sh — stage, commit, and push kobold-card-architect to GitHub
# Usage: ./push.sh "your commit message"
#        ./push.sh              (uses a default timestamped message)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Use provided message or fall back to a timestamped default
MESSAGE="${1:-"Update $(date '+%Y-%m-%d %H:%M')"}"

echo "📁 Working in: $SCRIPT_DIR"
echo ""

# Show what's changed
git status --short

# Nothing to commit? Exit cleanly
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo ""
  echo "✅ Nothing to commit — already up to date."
  exit 0
fi

echo ""
echo "📝 Committing: \"$MESSAGE\""
git add .
git commit -m "$MESSAGE"

echo ""
echo "🚀 Pushing to GitHub..."
git push

echo ""
echo "✅ Done! https://github.com/PeejusMaximus/kobold-card-architect"