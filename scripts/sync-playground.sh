#!/usr/bin/env sh
# Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU AFFERO GENERAL PUBLIC LICENSE for more details.
#
# You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
# along with this program.  If not, see <https://www.gnu.org/licenses/>.
# ==================================================================
#
# Align the local playground directory with the K8s pod's playground
# directory (mounted at /app/playground via the persistence PVC).
#
# Transport is `kubectl cp` (whole-tree copy, entry-by-entry so that
# system dirs can be excluded). The pod is resolved live via a label
# selector so it survives pod restarts/renames.
#
# Usage:
#   sync-playground.sh [DIRECTION] [OPTIONS]
#
# DIRECTION (positional, optional):
#   push          Local  -> Pod   (local is the source of truth)
#   pull          Pod    -> Local  (pod is the source of truth)
#   (omitted)     Interactive mode: list both sides, then prompt for
#                 direction and scope (a series, a story, or all).
#
# OPTIONS:
#   -r, --route PATH     Sync only this sub-path under playground/, e.g.
#                        a series ("伊洛瑟恩") or a story ("伊洛瑟恩/日常").
#                        Default: the whole playground tree.
#   -c, --clean          Clean the destination scope before writing
#                        (mirror semantics). Always preceded by a backup
#                        of the destination unless --no-backup is given.
#   -n, --dry-run        Print the plan (what would be copied / cleaned /
#                        backed up) without making any changes.
#   -l, --list           List series/stories on both sides with a diff
#                        marker, then exit. Implies no sync.
#       --include-system Include underscore-prefixed system entries
#                        (_logs/, _usage.json, _plugin-data/, ...).
#                        Excluded by default.
#       --no-backup      Skip the safety backup before --clean.
#       --no-perm-fix    Skip the post-push group-writable permission fix.
#   -N, --namespace NS   Kubernetes namespace (default: $K8S_NAMESPACE or
#                        "heart-reverie" — the namespace the Helm chart's
#                        README installs into: `--namespace heart-reverie`).
#   -s, --selector SEL   Pod label selector (default: $K8S_SELECTOR or
#                        "app.kubernetes.io/name=heart-reverie"). The chart's
#                        common labels set this name label; narrow further with
#                        ",app.kubernetes.io/instance=<release>" when several
#                        releases share a namespace (README installs as `hr`).
#       --context CTX    kubectl context (default: current context).
#   -p, --pod NAME       Explicit pod name (overrides --selector).
#   -h, --help           Show this help and exit.
#
# Environment overrides:
#   PLAYGROUND_DIR   Local playground path (default: <repo>/playground).
#   POD_PLAYGROUND   Pod playground path  (default: /app/playground).
#   K8S_NAMESPACE, K8S_SELECTOR, K8S_CONTEXT
#
# Examples:
#   sync-playground.sh                       # interactive: pick direction + scope
#   sync-playground.sh --list                # show both sides, exit
#   sync-playground.sh push                  # push whole playground to pod
#   sync-playground.sh pull -r 伊洛瑟恩        # pull one series from pod
#   sync-playground.sh push -r 伊洛瑟恩/日常 -c # mirror one story (clean+write)
#   sync-playground.sh push -n --clean       # preview a destructive push

set -eu

# ── Colors ────────────────────────────────────────────────────────
if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    BLUE='\033[0;34m'; GRAY='\033[0;90m'; BOLD='\033[1m'; RESET='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; GRAY=''; BOLD=''; RESET=''
fi

err()  { printf "%b\n" "${RED}ERROR:${RESET} $*" >&2; }
warn() { printf "%b\n" "${YELLOW}WARN:${RESET} $*" >&2; }
info() { printf "%b\n" "${GRAY}$*${RESET}"; }
ok()   { printf "%b\n" "${GREEN}$*${RESET}"; }

# ── Defaults ──────────────────────────────────────────────────────
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

PLAYGROUND_DIR="${PLAYGROUND_DIR:-$PROJECT_DIR/playground}"
POD_PLAYGROUND="${POD_PLAYGROUND:-/app/playground}"
BACKUP_DIR="$PROJECT_DIR/backups"

# The Helm chart (helm/heart-reverie) does not pin a namespace; its README
# installs into `heart-reverie` (`helm install hr --namespace heart-reverie`).
# Default to that convention rather than the cluster's "default" namespace.
NAMESPACE="${K8S_NAMESPACE:-heart-reverie}"
SELECTOR="${K8S_SELECTOR:-app.kubernetes.io/name=heart-reverie}"
CONTEXT="${K8S_CONTEXT:-}"
POD_NAME=""

DIRECTION=""
ROUTE=""
COPY_FAILURES=""   # space-separated list of entries whose copy failed
CLEAN=0
DRY_RUN=0
LIST_ONLY=0
INCLUDE_SYSTEM=0
DO_BACKUP=1
PERM_FIX=1

# ── Help ──────────────────────────────────────────────────────────
show_help() {
    sed -n '17,73p' "$0" | sed 's/^# \{0,1\}//'
}

# ── Argument parsing ──────────────────────────────────────────────
parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            push|pull)
                if [ -n "$DIRECTION" ]; then
                    err "Direction already set to '$DIRECTION'; got '$1'"; exit 2
                fi
                DIRECTION="$1" ;;
            -r|--route)    ROUTE="${2:?--route needs a value}"; shift ;;
            -c|--clean)    CLEAN=1 ;;
            -n|--dry-run)  DRY_RUN=1 ;;
            -l|--list)     LIST_ONLY=1 ;;
            --include-system) INCLUDE_SYSTEM=1 ;;
            --no-backup)   DO_BACKUP=0 ;;
            --no-perm-fix) PERM_FIX=0 ;;
            -N|--namespace) NAMESPACE="${2:?--namespace needs a value}"; shift ;;
            -s|--selector) SELECTOR="${2:?--selector needs a value}"; shift ;;
            --context)     CONTEXT="${2:?--context needs a value}"; shift ;;
            -p|--pod)      POD_NAME="${2:?--pod needs a value}"; shift ;;
            -h|--help)     show_help; exit 0 ;;
            --) shift; break ;;
            -*) err "Unknown option: $1"; exit 2 ;;
            *)  err "Unexpected argument: $1"; exit 2 ;;
        esac
        shift
    done
}

# ── Path safety: keep ROUTE inside the playground tree ────────────
sanitize_route() {
    [ -z "$ROUTE" ] && return 0
    # Strip leading/trailing slashes.
    ROUTE=$(printf '%s' "$ROUTE" | sed 's#^/*##; s#/*$##')
    case "$ROUTE" in
        ""|.|..) err "Invalid --route"; exit 2 ;;
        */../*|../*|*/..) err "--route must not contain '..'"; exit 2 ;;
        /*) err "--route must be relative to playground/"; exit 2 ;;
    esac
}

# ── kubectl plumbing ──────────────────────────────────────────────
KUBECTL=""
build_kubectl() {
    set -- kubectl
    [ -n "$CONTEXT" ]   && set -- "$@" --context "$CONTEXT"
    [ -n "$NAMESPACE" ] && set -- "$@" --namespace "$NAMESPACE"
    KUBECTL="$*"
}

# shellcheck disable=SC2086 -- intentional word-splitting of $KUBECTL flags
kc() { $KUBECTL "$@"; }

require_deps() {
    command -v kubectl >/dev/null 2>&1 || {
        err "kubectl is required but not installed"; exit 1; }
    command -v tar >/dev/null 2>&1 || {
        err "tar is required but not installed"; exit 1; }
}

resolve_pod() {
    if [ -n "$POD_NAME" ]; then
        kc get pod "$POD_NAME" >/dev/null 2>&1 || {
            err "Pod '$POD_NAME' not found in namespace '$NAMESPACE'"; exit 1; }
        return 0
    fi
    POD_NAME=$(kc get pod -l "$SELECTOR" \
        -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' \
        2>/dev/null | awk '{print $1}')
    [ -n "$POD_NAME" ] || {
        err "No Running pod matched selector '$SELECTOR' in namespace '$NAMESPACE'"
        info "Tip: pass --pod NAME, --selector SEL, or --namespace NS"
        exit 1
    }
    info "Resolved pod: ${BOLD}$POD_NAME${RESET}${GRAY} (ns=$NAMESPACE)"
}

# ── Listing helpers ───────────────────────────────────────────────
# Print top-level series/story entries (one per line) for a side.
# Excludes underscore-prefixed entries unless INCLUDE_SYSTEM=1.

list_local() {
    base="$PLAYGROUND_DIR${ROUTE:+/$ROUTE}"
    [ -d "$base" ] || return 0
    ( cd "$base" && ls -1A 2>/dev/null ) | _filter_entries
}

list_pod() {
    base="$POD_PLAYGROUND${ROUTE:+/$ROUTE}"
    kc exec "$POD_NAME" -- sh -c "ls -1A '$base' 2>/dev/null" 2>/dev/null \
        | _filter_entries
}

_filter_entries() {
    if [ "$INCLUDE_SYSTEM" -eq 1 ]; then
        cat
    else
        grep -v '^_' || true
    fi
}

# ── Story / chapter enumeration ───────────────────────────────────
# A "chapter" is a digits-only Markdown file (001.md, 002.md, ...) directly
# inside a story directory. A "story" is a directory two levels under the
# playground root (<series>/<story>); the route may already point deeper.
#
# Each side emits TAB-separated rows:   <relative-story-path>\t<chapter-count>
# Paths are relative to the active route (or playground root when no route).
# The shell snippet below is shared verbatim by the local and pod sides so
# both count identically; it walks at most two directory levels and tallies
# digits-only *.md files per leaf directory.

_chapter_walk_snippet() {
    # $1 = base directory to walk. Emits "<rel>\t<count>" rows.
    # POSIX find: chapter files are <base>/*/<NNN>.md or <base>/*/*/<NNN>.md.
    cat <<'SNIPPET'
base="$1"
[ -d "$base" ] || exit 0
# Collect candidate story dirs: direct children (depth 1) and grandchildren
# (depth 2) of base. find -mindepth/-maxdepth are GNU; emulate with -path.
find "$base" -type f -name '*.md' 2>/dev/null | while IFS= read -r f; do
    n=${f##*/}; n=${n%.md}
    case "$n" in (*[!0-9]*) continue ;; esac   # keep digits-only chapter files
    dir=${f%/*}
    printf '%s\n' "$dir"
done | sort | uniq -c | while read -r cnt dir; do
    rel=${dir#"$base"/}
    [ "$rel" = "$dir" ] && rel="."   # base itself is the story dir
    printf '%s\t%s\n' "$rel" "$cnt"
done
SNIPPET
}

# Drop story rows whose path starts with (or passes through) a system dir
# unless --include-system. System segments are underscore-prefixed.
_filter_story_rows() {
    if [ "$INCLUDE_SYSTEM" -eq 1 ]; then
        cat
    else
        grep -vE '(^|/)_' || true
    fi
}

stories_local() {
    base="$PLAYGROUND_DIR${ROUTE:+/$ROUTE}"
    [ -d "$base" ] || return 0
    sh -c "$(_chapter_walk_snippet)" _ "$base" | _filter_story_rows
}

stories_pod() {
    base="$POD_PLAYGROUND${ROUTE:+/$ROUTE}"
    snippet=$(_chapter_walk_snippet)
    kc exec "$POD_NAME" -- sh -c "$snippet" _ "$base" 2>/dev/null \
        | _filter_story_rows
}

print_listing() {
    printf "%b\n" "${BOLD}Playground listing${RESET}${GRAY}${ROUTE:+  (route: $ROUTE)}${RESET}"
    printf "%b\n" "${GRAY}  columns: <story>  local-chapters / pod-chapters${RESET}"
    printf "%b\n" "${GRAY}  legend: ${GREEN}=both ${BLUE}=local-only ${YELLOW}=pod-only ${RED}=chapter-count differs${RESET}"

    locals=$(stories_local)
    pods=$(stories_pod)
    # LC_ALL=C gives a byte-stable order so that '/' (0x2F) sorts before '_'
    # (0x5F): every "<series>/..." row is contiguous and never interleaved
    # with a sibling series whose name shares the prefix (e.g. "伊洛瑟恩" vs
    # "伊洛瑟恩_悠奈悠花"). Locale collation would otherwise split the group.
    all=$(printf '%s\n%s\n' "$locals" "$pods" | cut -f1 | LC_ALL=C sort -u | sed '/^$/d')
    [ -n "$all" ] || { info "  (no stories on either side)"; return 0; }

    cur_series=""
    printf '%s\n' "$all" | while IFS= read -r story; do
        lc=$(printf '%s\n' "$locals" | awk -F'\t' -v s="$story" '$1==s{print $2; exit}')
        pc=$(printf '%s\n' "$pods"   | awk -F'\t' -v s="$story" '$1==s{print $2; exit}')

        # Resolve a series header and a leaf story label. When the route
        # already points at a single story dir the walker yields "." — fall
        # back to the route's own path so the header/leaf stay meaningful.
        if [ "$story" = "." ]; then
            series=${ROUTE%/*}; [ "$series" = "$ROUTE" ] && series="${ROUTE:-playground}"
            leaf=${ROUTE##*/}; [ -z "$leaf" ] && leaf="$ROUTE"
        else
            series=${story%%/*}
            [ "$series" = "$story" ] && series="${ROUTE:-.}"
            leaf=${story#"$series"/}
            [ "$leaf" = "$story" ] && leaf="$story"
        fi
        if [ "$series" != "$cur_series" ]; then
            cur_series="$series"
            printf "%b%s%b\n" "$BOLD" "$series" "$RESET"
        fi

        if [ -n "$lc" ] && [ -n "$pc" ]; then
            if [ "$lc" = "$pc" ]; then
                printf "  %b%-32s%b %b%s / %s%b\n" \
                    "$GREEN" "$leaf" "$RESET" "$GRAY" "$lc" "$pc" "$RESET"
            else
                printf "  %b%-32s%b %b%s / %s  (differ)%b\n" \
                    "$RED" "$leaf" "$RESET" "$RED" "$lc" "$pc" "$RESET"
            fi
        elif [ -n "$lc" ]; then
            printf "  %b%-32s%b %b%s / -  (local only)%b\n" \
                "$BLUE" "$leaf" "$RESET" "$GRAY" "$lc" "$RESET"
        else
            printf "  %b%-32s%b %b- / %s  (pod only)%b\n" \
                "$YELLOW" "$leaf" "$RESET" "$GRAY" "$pc" "$RESET"
        fi
    done
}

# ── Interactive mode (no direction supplied) ──────────────────────
interactive_select() {
    print_listing
    printf "\n"

    # Direction
    printf "%b\n" "${BOLD}Choose direction:${RESET}"
    printf "  1) push  ${GRAY}local -> pod${RESET}\n"
    printf "  2) pull  ${GRAY}pod -> local${RESET}\n"
    printf "Select [1/2]: "
    read -r ans </dev/tty
    case "$ans" in
        1) DIRECTION=push ;;
        2) DIRECTION=pull ;;
        *) err "Invalid selection"; exit 2 ;;
    esac

    # Scope
    src_list=$( [ "$DIRECTION" = push ] && list_local || list_pod )
    printf "\n%b\n" "${BOLD}Choose scope to sync ($DIRECTION):${RESET}"
    printf "  0) ALL ${GRAY}(entire${ROUTE:+ $ROUTE} tree)${RESET}\n"
    i=0
    # Build an indexed menu of source-side entries.
    menu=$(printf '%s\n' "$src_list" | sed '/^$/d')
    if [ -n "$menu" ]; then
        printf '%s\n' "$menu" | while IFS= read -r e; do
            i=$((i + 1)); printf "  %d) %s\n" "$i" "$e"
        done
    fi
    printf "Select number (or 's' to type a sub-path): "
    read -r sel </dev/tty
    case "$sel" in
        0) : ;; # keep ROUTE as-is (ALL within current route)
        s|S)
            printf "Enter sub-path under playground%s: " "${ROUTE:+/$ROUTE}"
            read -r sub </dev/tty
            ROUTE="${ROUTE:+$ROUTE/}$sub"
            sanitize_route ;;
        *[!0-9]*|"") err "Invalid selection"; exit 2 ;;
        *)
            pick=$(printf '%s\n' "$menu" | sed -n "${sel}p")
            [ -n "$pick" ] || { err "Selection out of range"; exit 2; }
            ROUTE="${ROUTE:+$ROUTE/}$pick"
            sanitize_route ;;
    esac

    # Offer clean for the chosen scope.
    printf "Clean destination before writing (mirror)? [y/N]: "
    read -r c </dev/tty
    case "$c" in y|Y) CLEAN=1 ;; esac
}

# ── Validate the source scope exists BEFORE any destructive step ──
# Runs ahead of backup/clean so a missing source never wipes a
# destination that --clean would otherwise remove.
validate_source() {
    if [ "$DIRECTION" = push ]; then
        src="$PLAYGROUND_DIR${ROUTE:+/$ROUTE}"
        [ -e "$src" ] || {
            err "Local source not found: $src"
            info "Nothing to push. (No changes made — clean/backup skipped.)"
            exit 1
        }
    else
        src="$POD_PLAYGROUND${ROUTE:+/$ROUTE}"
        if ! kc exec "$POD_NAME" -- sh -c "[ -e '$src' ]" 2>/dev/null; then
            err "Pod source not found: $src"
            info "Nothing to pull. (No changes made — clean/backup skipped.)"
            exit 1
        fi
    fi
}

# ── Backup destination scope before a destructive clean ───────────
backup_destination() {
    [ "$DO_BACKUP" -eq 1 ] || return 0
    mkdir -p "$BACKUP_DIR"
    stamp=$(date +%Y%m%d-%H%M%S)
    safe=$(printf '%s' "${ROUTE:-all}" | tr '/ ' '__')
    archive="$BACKUP_DIR/${DIRECTION}-${safe}-${stamp}.tar.gz"

    if [ "$DRY_RUN" -eq 1 ]; then
        info "[dry-run] would back up destination to $archive"
        return 0
    fi

    info "Backing up destination -> $archive"
    if [ "$DIRECTION" = push ]; then
        # Destination is the pod: stream a tar out of the pod.
        base="$POD_PLAYGROUND"; sub="${ROUTE:-.}"
        kc exec "$POD_NAME" -- sh -c \
            "cd '$base' 2>/dev/null && tar czf - '$sub' 2>/dev/null" \
            > "$archive" || { warn "Backup produced no data (destination empty?)"; }
    else
        # Destination is local.
        base="$PLAYGROUND_DIR"; sub="${ROUTE:-.}"
        if [ -e "$base/$sub" ]; then
            ( cd "$base" && tar czf - "$sub" ) > "$archive"
        else
            warn "Local destination '$sub' does not exist; nothing to back up"
            rm -f "$archive"
        fi
    fi
    [ -f "$archive" ] && ok "Backup saved: $archive"
}

# ── Clean STALE destination entries (mirror --delete semantics) ───
# Removes only the top-level entries that exist in the DESTINATION but NOT
# in the SOURCE — i.e. entries the subsequent copy would never overwrite.
# Source-present entries are intentionally left alone here; they are mirrored
# atomically per-entry in copy_entries() (remove-then-copy) so there is never
# a window where an entry the user still has is missing from the destination.
#
# This avoids two earlier hazards:
#   1. `rm -rf` on the PVC mount root → "Device or resource busy".
#   2. Cleaning everything up front, then a failed copy leaving the
#      destination empty (data loss on the pod side).
# System (underscore-prefixed) entries are preserved unless --include-system.
clean_destination() {
    [ "$CLEAN" -eq 1 ] || return 0

    if [ "$DIRECTION" = push ]; then
        target="$POD_PLAYGROUND${ROUTE:+/$ROUTE}"
        dst_entries=$(list_pod)
        src_entries=$(list_local)
    else
        target="$PLAYGROUND_DIR${ROUTE:+/$ROUTE}"
        dst_entries=$(list_local)
        src_entries=$(list_pod)
    fi

    # Stale = in destination, not in source.
    stale=$(printf '%s\n' "$dst_entries" | sed '/^$/d' | while IFS= read -r e; do
        printf '%s\n' "$src_entries" | grep -qxF "$e" || printf '%s\n' "$e"
    done)

    if [ -z "$stale" ]; then
        info "No stale entries to remove in destination: $target"
        return 0
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        printf '%s\n' "$stale" | while IFS= read -r e; do
            info "[dry-run] would remove stale: $target/$e"
        done
        return 0
    fi

    info "Removing stale destination entries under: $target"
    if [ "$DIRECTION" = push ]; then
        # Join all child paths into one single-quoted argument string and run
        # a single rm inside the pod. Single quotes around each path keep
        # spaces/CJK safe; embedded single quotes are escaped '\'' style.
        rmargs=$(printf '%s\n' "$stale" | while IFS= read -r e; do
            esc=$(printf '%s' "$e" | sed "s/'/'\\\\''/g")
            printf " '%s/%s'" "$target" "$esc"
        done)
        [ -n "$rmargs" ] && kc exec "$POD_NAME" -- sh -c "rm -rf $rmargs"
    else
        printf '%s\n' "$stale" | while IFS= read -r e; do
            rm -rf "$target/$e"
        done
    fi
}

# ── Copy one top-level entry (system-exclusion aware) ─────────────
# kubectl cp has no exclude/dry-run; we drive it entry-by-entry.
copy_entries() {
    if [ "$DIRECTION" = push ]; then
        src_base="$PLAYGROUND_DIR${ROUTE:+/$ROUTE}"
        dst_base="$POD_PLAYGROUND${ROUTE:+/$ROUTE}"
        entries=$(list_local)
        [ -d "$src_base" ] || { err "Local source not found: $src_base"; exit 1; }
    else
        src_base="$POD_PLAYGROUND${ROUTE:+/$ROUTE}"
        dst_base="$PLAYGROUND_DIR${ROUTE:+/$ROUTE}"
        entries=$(list_pod)
    fi

    # If ROUTE points at a leaf (a story dir with files, no listed subdirs
    # after filtering) we still copy the whole route directory in one shot.
    if [ -z "$entries" ]; then
        _copy_one "" "$src_base" "$dst_base" || COPY_FAILURES="${COPY_FAILURES}<route> "
        return 0
    fi

    # Iterate WITHOUT a pipeline subshell so per-entry failures accumulate in
    # COPY_FAILURES in THIS shell (a `... | while` body runs in a subshell and
    # would lose the counter).
    #
    # Two stdin hazards are handled explicitly:
    #   1. The loop reads the entry list on FD 3 (not stdin). `kubectl cp` and
    #      `kubectl exec` READ FROM STDIN; if the loop fed them via stdin they
    #      would drain the remaining entries, so only the first line would be
    #      processed and the loop would silently end (the ".gitignore only"
    #      bug). FD 3 keeps the list independent of whatever kubectl consumes.
    #   2. _copy_one redirects each kubectl invocation's stdin from /dev/null
    #      as a belt-and-braces guard.
    # IFS stays at its default inside the loop body (the `IFS= read` form is a
    # one-shot assignment scoped to read), so kc()'s $KUBECTL word-splitting
    # keeps working.
    tmp_list=$(mktemp)
    printf '%s\n' "$entries" | sed '/^$/d' > "$tmp_list"
    while IFS= read -r e <&3; do
        [ -n "$e" ] || continue
        _copy_one "$e" "$src_base" "$dst_base" || COPY_FAILURES="${COPY_FAILURES}${e} "
    done 3< "$tmp_list"
    rm -f "$tmp_list"
}

# Copy a single entry. Returns non-zero on failure WITHOUT aborting the
# caller (callers must invoke with `|| ...`). Never relies on `set -e`
# propagation, which does not fire for commands followed by `||`.
_copy_one() {
    name="$1"; src_base="$2"; dst_base="$3"
    if [ "$DIRECTION" = push ]; then
        src="$src_base${name:+/$name}"
        dst="$POD_NAME:$dst_base${name:+/$name}"
        human_dst="pod:$dst_base${name:+/$name}"
    else
        src="$POD_NAME:$src_base${name:+/$name}"
        dst="$dst_base${name:+/$name}"
        human_dst="$dst"
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        info "[dry-run] cp ${name:-<route>}  ->  $human_dst"
        return 0
    fi

    # Ensure the destination PARENT directory exists. kubectl cp will not
    # create intermediate parents, so a missing parent silently fails.
    # Each kubectl call takes stdin from /dev/null so it cannot drain the
    # caller's entry-list file descriptor.
    if [ "$DIRECTION" = push ]; then
        kc exec "$POD_NAME" -- sh -c "mkdir -p '$dst_base'" </dev/null || {
            err "Failed to create pod parent dir: $dst_base"; return 1; }
    else
        mkdir -p "$dst_base" || { err "Failed to create local dir: $dst_base"; return 1; }
    fi

    # ALWAYS remove the destination entry immediately before copying it.
    #
    # This is not just a --clean nicety — it is REQUIRED for correctness.
    # `kubectl cp SRC pod:DST` behaves like `cp`: when DST already exists it
    # copies SRC *inside* DST (creating pod:DST/<name>/<name>, a nested
    # duplicate) instead of replacing it. Removing DST first makes every copy
    # deterministic and idempotent (re-pushing yields the same tree, never a
    # nested "伊洛瑟恩/伊洛瑟恩"). It also gives mirror semantics for free:
    # stale files inside an existing story dir never survive a re-copy.
    #
    # A removal failure aborts THIS entry (don't copy into a half-removed dir)
    # but not the whole run.
    if [ -n "$name" ]; then
        dst_path="$dst_base/$name"
        if [ "$DIRECTION" = push ]; then
            esc=$(printf '%s' "$dst_path" | sed "s/'/'\\\\''/g")
            kc exec "$POD_NAME" -- sh -c "rm -rf '$esc'" </dev/null || {
                err "Failed to clear pod entry before copy: $dst_path"; return 1; }
        else
            rm -rf "$dst_path" || {
                err "Failed to clear local entry before copy: $dst_path"; return 1; }
        fi
    fi

    info "cp ${BOLD}${name:-<route>}${RESET}${GRAY}  ->  $human_dst"
    # Capture stderr so a failure is reported with context rather than swallowed.
    # stdin from /dev/null: kubectl cp otherwise reads stdin and would consume
    # the caller's entry list.
    cp_err=$(kc cp "$src" "$dst" </dev/null 2>&1) || {
        err "kubectl cp failed for '${name:-<route>}': ${cp_err:-unknown error}"
        return 1
    }
    return 0
}

# ── Post-push permission fix (group-writable, matches umask 0002) ──
# Makes the freshly-copied files group-writable so the container (UID 1000,
# GID 0) can edit them. We chmod the copied ENTRIES, never the target
# directory itself: the playground root is the PVC mount point owned by
# root:root, and the non-root appuser cannot chmod a directory it does not
# own ("Operation not permitted"). The entries we just copied ARE owned by
# appuser, so chmod -R on each succeeds. Errors are surfaced, not hidden.
perm_fix() {
    [ "$DIRECTION" = push ] || return 0
    [ "$PERM_FIX" -eq 1 ] || return 0

    target="$POD_PLAYGROUND${ROUTE:+/$ROUTE}"
    entries=$(list_local)

    if [ "$DRY_RUN" -eq 1 ]; then
        info "[dry-run] would chmod -R g+rwX on copied entries under: $target"
        return 0
    fi

    info "Fixing group-writable permissions on copied entries under: $target"

    # Build a single chmod over all copied entry paths (not the mount root).
    if [ -n "$entries" ]; then
        chmodargs=$(printf '%s\n' "$entries" | sed '/^$/d' | while IFS= read -r e; do
            esc=$(printf '%s' "$target/$e" | sed "s/'/'\\\\''/g")
            printf " '%s'" "$esc"
        done)
    else
        # Route points at a single dir with no listed children — chmod it.
        esc=$(printf '%s' "$target" | sed "s/'/'\\\\''/g")
        chmodargs=" '$esc'"
    fi

    [ -n "$chmodargs" ] || return 0
    pf_err=$(kc exec "$POD_NAME" -- sh -c "chmod -R g+rwX $chmodargs" </dev/null 2>&1) || {
        warn "Permission fix reported issues (continuing): ${pf_err:-unknown error}"
        return 0
    }
}

# ── Main ──────────────────────────────────────────────────────────
main() {
    parse_args "$@"
    sanitize_route
    require_deps
    build_kubectl
    resolve_pod

    if [ "$LIST_ONLY" -eq 1 ]; then
        print_listing
        exit 0
    fi

    if [ -z "$DIRECTION" ]; then
        interactive_select
    fi

    printf "\n%b\n" "${BOLD}Plan${RESET}"
    info "  direction : $DIRECTION"
    info "  route     : ${ROUTE:-<entire playground>}"
    info "  clean     : $( [ "$CLEAN" -eq 1 ] && echo yes || echo no )"
    info "  backup    : $( [ "$DO_BACKUP" -eq 1 ] && echo yes || echo no )"
    info "  system    : $( [ "$INCLUDE_SYSTEM" -eq 1 ] && echo included || echo excluded )"
    info "  dry-run   : $( [ "$DRY_RUN" -eq 1 ] && echo yes || echo no )"
    printf "\n"

    validate_source
    [ "$CLEAN" -eq 1 ] && backup_destination
    clean_destination
    copy_entries
    perm_fix

    printf "\n"
    if [ "$DRY_RUN" -eq 1 ]; then
        ok "Dry run complete — no changes made."
        return 0
    fi

    # Surface any per-entry copy failures loudly and fail the run. After a
    # --clean this is critical: a partial copy means the destination is now
    # incomplete, and the operator must re-run (the backup is recoverable).
    if [ -n "$COPY_FAILURES" ]; then
        err "Sync FAILED — these entries did not copy:"
        for f in $COPY_FAILURES; do printf "  %b- %s%b\n" "$RED" "$f" "$RESET" >&2; done
        if [ "$CLEAN" -eq 1 ] && [ "$DO_BACKUP" -eq 1 ]; then
            warn "Destination was cleaned first; restore from the backup in $BACKUP_DIR if needed, then re-run."
        fi
        exit 1
    fi

    ok "Sync complete ($DIRECTION${ROUTE:+, route=$ROUTE})."
}

main "$@"
