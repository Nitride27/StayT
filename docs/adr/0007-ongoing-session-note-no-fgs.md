# ADR-0007: Ongoing session note as a plain notification — no foreground service

Date: 2026-09-18
Status: accepted
Extends: ADR-0006 (notification tap as the foreground path)

## Context
While a session is active the user gets no signal outside the app: the
per-block heads-up notes (ADR-0006) only fire on block events and auto-cancel.
We want a persistent music-player-style note — "StayT · \<task\>" + live
elapsed, tap resumes the session, non-dismissible while active, gone on
session end.

## Decision
- Plain `NotificationManager.notify()` with `setOngoing(true)` on its own
  `stayt_session_v2` channel (`IMPORTANCE_DEFAULT` with no sound/vibration, so it shows on the lock screen — LOW notes are hidden there; replaced the LOW `stayt_session` channel 2026-09-26) and its own
  fixed ID — coexists with, and is never swept by, the `stayt_blocked`
  heads-up notes (different channel + ID).
- Posted from `StayTAccessibilityService.setBlocking(true)`, cancelled on
  `setBlocking(false)` — so JS `startBlocking(task)` / `stopBlocking()` own
  it with zero bridge/manifest/permission changes. `pauseBlocking`
  (override/break) deliberately leaves it posted: a break is still an active
  session. Elapsed ticks once a minute via the existing main-looper handler;
  the base is the persisted blocking-start so process-death re-arm keeps
  counting the same session.
- Tap fires the package launch intent (resume-to-current-screen, no deep
  link, no BAL issue — taps are BAL-exempt). Small icon reuses the QS-tile
  white bolt vector (notification-compliant alpha silhouette, no new asset).
  `POST_NOTIFICATIONS` denial silently skips via the existing
  `canPostNotifications` seam; bounce + emit remain enforcement.
- NO foreground service: no `startForeground()`, no `FOREGROUND_SERVICE*`
  permission, no `foregroundServiceType`, no manifest/Play-declaration cost.

## Verified vs official docs (2026-09-18)
- Foreground-service types are required on API 34+: `startForeground()`
  without a manifest-declared type + matching `FOREGROUND_SERVICE_*`
  permission throws (`MissingForegroundServiceTypeException` /
  `SecurityException`), needs a Play Console declaration, and cannot start
  from the background on API 31+ (`ForegroundServiceStartNotAllowedException`).
  None of this applies to plain `notify()` — an ongoing notification is just
  a notification flag, not a service promotion.
- Revisit with an explicit product decision if we ever need guaranteed
  execution (e.g. a ticking timer that must survive aggressive OEM kills) —
  that is the only thing a foreground service would buy here, and background
  start restrictions make it unreliable for exactly that case anyway.

## Consequences
- One file changed (`StayTAccessibilityService.kt`); mirror check covers it.
- Needs EAS build + on-device proof: note appears on session start with task
  name, ticks elapsed, survives minute to minute, tap resumes ActiveSession,
  disappears on END SESSION / SWITCH TASK completion, survives override
  breaks, never appears when notifications are denied.
