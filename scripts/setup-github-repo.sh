#!/usr/bin/env bash
#
# One-time helper to set the GitHub repository description and topics for
# discoverability. Run after the repo exists and `gh` is authenticated:
#
#   ./scripts/setup-github-repo.sh [owner/repo]
#
# If no argument is given, it uses the current repo's origin remote.
set -euo pipefail

REPO="${1:-}"

DESCRIPTION="Open-source, self-hosted industrial AI agent desktop app — complete tool-calling agent, no-code automation, privacy-first, with unified DIY panels (table, web, RAG, knowledge graph, workflow). Embedded SurrealDB, no external services."

# Keep in sync with package.json "keywords". GitHub topics must be lowercase,
# digits or hyphens, and <= 50 chars.
TOPICS=(
  ai-agent
  llm
  industrial
  self-hosted
  desktop-app
  tauri
  no-code
  automation
  rag
  knowledge-graph
  workflow
  surrealdb
  privacy
  on-premise
  agent
)

repo_args=()
if [[ -n "$REPO" ]]; then
  repo_args=(--repo "$REPO")
fi

echo "Setting repository description..."
gh repo edit "${repo_args[@]}" --description "$DESCRIPTION" --homepage "https://github.com/veylin-ai/veylin"

echo "Setting repository topics..."
topic_args=()
for t in "${TOPICS[@]}"; do
  topic_args+=(--add-topic "$t")
done
gh repo edit "${repo_args[@]}" "${topic_args[@]}"

echo "Done."
