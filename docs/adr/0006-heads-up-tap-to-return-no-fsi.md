# ADR-0006: Heads-up tap-to-return as the foreground path — no full-screen intent

Date: 2026-09-18
Status: accepted
Extends: ADR-0005 (HOME bounce + JS interstitial only)

## Context
After a block (HOME bounce), StayT does not foreground — the user only sees
the tap-to-return notification and is confused; they expect the interstitial
to open. SYSTEM_ALERT_WINDOW was deliberately dropped for Play-review safety
(plugin strips it), so auto-foreground is governed by Background Activity
Launch (BAL) rules.

## Decision
- Tap path is the reliable foreground path and is now heads-up: the
  `stayt_blocked` channel is IMPORTANCE_HIGH with sound/vibration/lights and
  a channel-upgrade sweep (channels are immutable after first create — an old
  install stuck below HIGH is deleted + recreated; IMPORTANCE_NONE
  / user-disabled is respected). Every block posts with PRIORITY_MAX +
  CATEGORY_ALARM + VISIBILITY_PUBLIC + DEFAULT_ALL + `setOnlyAlertOnce(false)`
  so each debounced block peeks full-bleed top, with a "Return to task"
  action button and task-aware text, deep-linking
  `exp+stayt-app://blocked?packageName=…&label=…` (PendingIntent
  UPDATE_CURRENT + IMMUTABLE, CLEAR_TOP + SINGLE_TOP) into the existing JS
  `BlockedInterstitial` handler in App.tsx. Fires on every block respecting
  the existing 1s per-package cooldown; POST_NOTIFICATIONS gate kept —
  denied permission falls back to bounce + emit (still enforcing).
- Best-effort direct `startActivity` (`foregroundBlockedInterstitial`) is
  attempted on every block where the OS still allows it (same-task/recents
  edge) inside try/catch(Throwable): success lands straight on the
  interstitial, denial is the expected path and the notification above always
  fires regardless. No new permission, never crashes.
- Full-screen intent (FSI) is explicitly NOT implemented: it is the only true
  auto-open route (heads-up + `setFullScreenIntent`), but on Android 14+ it
  is a special-access permission (`USE_FULL_SCREEN_INTENT`) auto-granted only
  to calling/alarm core functionality, requires a Play Console declaration
  (since 2026-09-18 docs: 31 May 2024), user grant otherwise, and crashes when
  used without grant if unchecked. StayT (focus blocker) does not qualify —
  the Play review + permission-friction cost is rejected. Revisit only with an
  explicit product decision + Play declaration.

## Verified vs official docs (2026-09-18)
- BAL restricted since Android 10 (API 29), hardened 14/15: background
  `startActivity` denied; notification-tap PendingIntent is an allowed
  exception (BAL_ALLOW_PENDING_INTENT). Sender/creator BAL opt-ins required
  on 14/15 — direct launches stay unreliable, tap stays allowed.
- Heads-up needs IMPORTANCE_HIGH (URGENT) + sound/vibration; pre-O needs
  PRIORITY_HIGH/MAX. Channel behaviors freeze after creation (name/desc
  mutable, importance not) — hence the delete + recreate upgrade sweep.
- FSI on 14+: `USE_FULL_SCREEN_INTENT` special access, Play declaration
  required, auto-grant only for calling/alarm; non-qualifying apps must prompt
  (`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` / `canUseFullScreenIntent()`)
  and degrade gracefully. `performGlobalAction(HOME)` returns boolean and may
  be denied/throttled — denial falls through to emit + notification.
- No `TYPE_ACCESSIBILITY_OVERLAY` windows are used, so no addView race.

## Consequences
- No new permissions, no manifest change, no new deps. Contract unchanged
  (`blockedContract.ts` URIs, JS emit + deep-link handlers untouched).
- Needs EAS build + on-device proof (Samsung M52): heads-up peek on every
  block, tap lands on the interstitial, denied-notification fallback still
  bounces + emits. Kotlin is EAS-only to compile.
