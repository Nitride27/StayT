# ADR-0005: No native overlay — HOME bounce + JS interstitial only

Date: 2026-09-17
Status: accepted
Supersedes: ADR-0001 (overlay as enforcement surface)

## Context
Live logcat showed no StayT process FATAL and no service Log.d lines — the
crash reads as the blocked target app dying when the native overlay fires
(addView BadToken/race, or HOME + overlay fighting over the foreground).
Directive: remove the native overlay entirely. Blocked app bounces HOME;
StayT opens its JS interstitial; no native window ever.

## Decision
- Block path is HOME + emit + notification only:
  `performGlobalAction(GLOBAL_ACTION_HOME)` (at most one per debounced open),
  then `onBlockedAttempt` emit, then the tap-to-return notification
  (PendingIntent deep-link — the BAL-safe foreground path). No `addView`,
  no `TYPE_ACCESSIBILITY_OVERLAY`, no auto-`startActivity`.
- The only block surface is the existing JS `BlockedInterstitialScreen`,
  reached via emit (live runtime) or notification tap (dead runtime /
  BAL-denied). No new permissions, no new deps.
- `dismissBlockedOverlay` stays a no-op shim at every layer
  (service → companion `dismissOverlay` → bridge → TS) so the JS seam needs
  zero changes. Native friction wait retired (JS owns the breathe gate);
  `foreground*` helpers retained uncalled as the documented deep-link seam.

## Verified vs official docs (2026-09-17)
- `performGlobalAction(GLOBAL_ACTION_HOME)` is the documented global-action
  seam; it returns boolean and can be denied/throttled — denial falls through
  to emit + notification, never a silent return (cooldown entry kept).
- BAL restrictions (Android 10+, hardened 14/15) deny background
  `startActivity`; a notification-tap `PendingIntent` is an allowed exception.
  Tile paywall routing already uses `startActivityAndCollapse(PendingIntent)`
  on API 34+. HOME only backgrounds the target — it never kills it.
- `TYPE_ACCESSIBILITY_OVERLAY` windows are now only for highlight-style use
  per current docs; we use none at all, so the addView race is gone by
  construction, not by hardening.

## Consequences
- The addView BadToken/race crash vector is eliminated structurally.
- Native friction escalation counting is frozen (counter inert); bridge
  `setFriction` + prefs mirror kept so pushes never break.
- Overlay art (`drawable-nodpi/stayt_owl_blocked*.png`) and the plugin's
  `assets/fonts` copy are now unused — follow-up may stop shipping them.
- Needs the next EAS build + on-device repro to verify (Kotlin is EAS-only
  to compile; Samsung M52 nearby).
