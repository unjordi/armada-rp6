#!/usr/bin/env bash
# Markdown release notes from the first-parent commits of a range.
#
# Usage: release-notes.sh --version VERSION [--from REV] [--to REV] [--repo DIR]
#                         [--fallback-count N] [--max-bytes N]
#
#   --from REV          exclusive start of the range; when empty or not a commit
#                       of the repository, the last --fallback-count commits are used
#   --to REV            inclusive end (default HEAD)
#   --fallback-count N  default 20
#   --max-bytes N       output cap in bytes (default 8192); longer output is cut
#                       at a line boundary and ends with "…"
#
# Output:
#   ## <version>
#
#   - <commit title>
#     <first paragraph of the commit body, on one line>
#
# Trailer lines (Co-Authored-By, Claude-Session, Rama, MR/PR, Signed-off-by) are dropped.
set -euo pipefail

version="" from="" to="HEAD" repo="." fallback=20 max_bytes=8192
while (($#)); do
    case "$1" in
        --version) version="${2-}"; shift 2 ;;
        --from) from="${2-}"; shift 2 ;;
        --to) to="${2-}"; shift 2 ;;
        --repo) repo="${2-}"; shift 2 ;;
        --fallback-count) fallback="${2-}"; shift 2 ;;
        --max-bytes) max_bytes="${2-}"; shift 2 ;;
        *) echo "release-notes: unknown argument: $1" >&2; exit 2 ;;
    esac
done
[[ -n "${version}" ]] || { echo "release-notes: --version is required" >&2; exit 2; }
[[ "${fallback}" =~ ^[0-9]+$ && "${max_bytes}" =~ ^[0-9]+$ && "${max_bytes}" -ge 16 ]] || {
    echo "release-notes: --fallback-count and --max-bytes must be integers (max-bytes >= 16)" >&2; exit 2; }

range=(-n "${fallback}" "${to}")
if [[ -n "${from}" ]] && git -C "${repo}" cat-file -e "${from}^{commit}" 2>/dev/null; then
    range=("${from}..${to}")
fi

# One record per commit, separated by RS (0x1e); the body is everything after the title.
render() {
    printf '## %s\n\n' "${version}"
    local record title body line para
    while IFS= read -r -d $'\x1e' record; do
        record="${record#$'\n'}"
        [[ -n "${record//[[:space:]]/}" ]] || continue
        title="${record%%$'\n'*}"
        body=""
        [[ "${record}" == *$'\n'* ]] && body="${record#*$'\n'}"
        para=""
        while IFS= read -r line; do
            if [[ "${line}" =~ ^[[:space:]]*(Co-Authored-By|Claude-Session|Rama|MR/PR|Signed-off-by):  ]]; then
                continue
            fi
            if [[ -z "${line//[[:space:]]/}" ]]; then
                [[ -z "${para}" ]] && continue
                break
            fi
            para+="${para:+ }${line#"${line%%[![:space:]]*}"}"
        done <<<"${body}"
        printf -- '- %s\n' "${title}"
        [[ -z "${para}" ]] || printf '  %s\n' "${para:0:300}"
    done < <(git -C "${repo}" log --first-parent --format='%B%x1e' "${range[@]}")
}

render | LC_ALL=C awk -v max="${max_bytes}" '
    { n = length($0) + 1
      if (!cut && used + n <= max) { out = out $0 "\n"; used += n }
      else if (!cut) { cut = 1 } }
    END {
      if (cut) { while (used + 4 > max && length(out) > 0) {
                   sub(/[^\n]*\n$/, "", out); used = length(out) }
                 printf "%s…\n", out }
      else printf "%s", out }'
