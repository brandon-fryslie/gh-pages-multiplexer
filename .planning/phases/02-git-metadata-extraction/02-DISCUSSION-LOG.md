# Phase 2: Git Metadata Extraction - Discussion Log (Assumptions Mode, --auto)

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-06
**Phase:** 02-git-metadata-extraction
**Mode:** assumptions (--auto)
**Areas analyzed:** Storage location, Extraction strategy, Pipeline integration, Failure handling

## Assumptions Presented

### Storage location
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Extend ManifestEntry with commits[]; no separate file | Confident | `src/manifest-manager.ts:1` annotation states versions.json is sole source (MNFST-01) |
| Schema bump 1→2, reader accepts both | Confident | `src/manifest-manager.ts:25` enforces schema===1; need additive change |
| New CommitInfo type with sha/author_name/author_email/message/timestamp | Confident | REQUIREMENTS.md META-02 enumerates exactly these fields |

### Extraction strategy
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Shell out to git via execFile, no new dep | Confident | Phase 1 added zero deps for git ops; branch-manager already shells git |
| Range = previous.sha..current.sha when prior exists, else cap-100 reachable | Confident | META-01 spec; manifest already records prior SHA per slot |
| Cap at 100 commits/deploy | Likely | No explicit requirement, chosen for size/UX balance |
| Use \x1f/\x1e separators in --format | Confident | Standard porcelain trick for multi-line bodies |

### Pipeline integration
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| New module src/metadata-extractor.ts | Confident | Phase 1 module-per-stage convention |
| Insertion between readManifest and updateManifest in src/index.ts | Confident | Only point where prior SHA is in scope and new entry is being built |
| Run git log against source repo (action CWD), not gh-pages worktree | Confident | gh-pages worktree only has built artifacts; commits live in source repo |

### Failure handling
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Fail loudly on git log failure (esp. shallow clone) | Confident | scripting-discipline + project policy on no silent fallbacks |
| Force-push fallback: log info, treat as first deploy | Likely | Only acceptable fallback because alternative blocks all post-rewrite deploys |

## Auto-Resolved
- All assumptions Confident or Likely with reasonable defaults; no Unclear items required resolution.
- Cap-100 chosen as default; can be revisited in planning if user objects.

## External Research
None — codebase + REQUIREMENTS.md provided sufficient evidence.
