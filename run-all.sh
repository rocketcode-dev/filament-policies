#!/usr/bin/env bash

set -uo pipefail

root_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
package_directories=(
  "$root_directory/foundation"
  "$root_directory/redis"
)

# Shell globbing keeps policy packages in a stable alphabetical order and also
# includes packages added after this script was written.
for manifest in "$root_directory"/policies/*/package.json; do
  [[ -f "$manifest" ]] || continue
  package_directories+=("${manifest%/package.json}")
done

failures=()

run_stage() {
  local package_directory=$1
  local package_name=$2
  local stage=$3

  printf '\n%s %s\n' "$package_name" "$stage"
  printf '%s\n' '------------------------------------------------------------------------'

  if (cd "$package_directory" && npm run "$stage"); then
    return 0
  fi

  failures+=("$package_name $stage")
  return 0
}

for package_directory in "${package_directories[@]}"; do
  package_name=$(node -e 'process.stdout.write(require(process.argv[1]).name)' \
    "$package_directory/package.json")

  run_stage "$package_directory" "$package_name" test
  run_stage "$package_directory" "$package_name" demo
done

printf '\n%s\n' '========================================================================'
if ((${#failures[@]} == 0)); then
  printf 'All %d package test/demo pairs passed.\n' "${#package_directories[@]}"
  exit 0
fi

printf '%d stage(s) failed:\n' "${#failures[@]}"
for failure in "${failures[@]}"; do
  printf '  - %s\n' "$failure"
done
exit 1
