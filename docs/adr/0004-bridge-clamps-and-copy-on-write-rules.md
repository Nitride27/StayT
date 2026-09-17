# ADR-0004: Bridge clamps + CopyOnWrite rule lists (review fix)

Date: 2026-09-17
Status: accepted

## Context
Security/correctness review (2026-09-17) found:
1. pauseBlocking(seconds) unbounded — one bridge call could park blocking
   off for years (fail-open) or overflow the resume delay.
2. startBlocking package lists unvalidated/uncapped — durable prefs bloat.
3. budgetRules/feedRules were synchronizedList iterated on the
   accessibility-event path without manual sync — CME possible mid-event
   (caught, but metering silently dropped).

## Decision
- AppBlockerModule.pauseBlocking coerces to 0..3600s; service re-clamps.
  Longest single break = 60 min (matches the 60-min intention-break UI cap).
- cleanPackages() bridge seam (blank/oversize drop, 256-char cap, 1000 cap);
  service re-validates (defense in depth, raw callers included).
- Rule lists are CopyOnWriteArrayList: iterated per event, rewritten rarely.
- Applied identically to modules/blocker/... AND the android/app/... mirror;
  verified identical via diff. (Future deepening: gitignore the mirror and
  generate it in prebuild — see architecture review.)

## Consequences
- No behavior change for legitimate callers (lists are <100 pkgs, breaks
  <=60 min). No security weakened. No new deps.
