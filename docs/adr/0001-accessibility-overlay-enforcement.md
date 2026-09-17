# ADR-0001: TYPE_ACCESSIBILITY_OVERLAY as the enforcement surface

Date: 2026-09-17
Status: accepted

## Context
Blocked apps must be stopped without Play-review-costly permissions.
Options were SYSTEM_ALERT_WINDOW overlay, full-screen intent (FSI),
background activity launch (BAL), plain notification, and
TYPE_ACCESSIBILITY_OVERLAY windows owned by the accessibility service.

## Decision
Enforce via TYPE_ACCESSIBILITY_OVERLAY fullscreen windows
(StayTAccessibilityService.showBlockedOverlay / showBreathOverlay),
with GLOBAL_ACTION_HOME bounce + tap-to-return notification as fallbacks.
No SYSTEM_ALERT_WINDOW declared (plugin strips it), no FSI, no new
dangerous permissions.

## Verified vs official docs (2026-09-17)
- TYPE_ACCESSIBILITY_OVERLAY is the documented window type for
  accessibility-service interception overlays (AccessibilityWindowInfo docs).
- BAL restrictions (Android 10+, hardened 14/15) deny background
  startActivity — hence the overlay never auto-foregrounds StayT; the
  interstitial is reached only via user tap (overlay buttons, notification).
  Tile paywall routing uses startActivityAndCollapse(PendingIntent) on API 34+.
- performGlobalAction(GLOBAL_ACTION_HOME/BACK) is the documented global-action
  seam; denial/throttle is handled by falling through to the overlay.

## Consequences
- Overlay auto-dismisses after 30s; friction countdown capped at 25s so the
  countdown always wins the race against the timeout.
- Single-surface rule: JS interstitial dismisses the native overlay on mount.
