#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: $0 <empty-output-directory>" >&2
  exit 64
fi

repository_root="$(git rev-parse --show-toplevel)"
output_directory="$1"

cd "$repository_root"

if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "Verified image context requires a clean Git worktree." >&2
  exit 1
fi

case "$output_directory" in
  "$repository_root"|"$repository_root"/*)
    echo "Build context must be outside the repository worktree." >&2
    exit 1
    ;;
esac

if [[ -e "$output_directory" ]] && find "$output_directory" -mindepth 1 -print -quit | grep -q .; then
  echo "Build context directory must be empty." >&2
  exit 1
fi

mkdir -p "$output_directory"

source_sha="$(git rev-parse --verify 'HEAD^{commit}')"
source_tree="$(git rev-parse --verify 'HEAD^{tree}')"

if [[ ! "$source_sha" =~ ^[a-f0-9]{40}$ ]] || [[ ! "$source_tree" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Git did not return immutable commit and tree identifiers." >&2
  exit 1
fi

git archive --format=tar "$source_sha" | tar -xf - -C "$output_directory"

cat > "$output_directory/.kova-source-attestation.json" <<ATTESTATION
{
  "schemaVersion": 1,
  "context": "git-archive",
  "sourceSha": "$source_sha",
  "sourceTree": "$source_tree"
}
ATTESTATION

printf 'SOURCE_SHA=%s\n' "$source_sha"
printf 'SOURCE_TREE=%s\n' "$source_tree"
printf 'BUILD_CONTEXT=%s\n' "$output_directory"
