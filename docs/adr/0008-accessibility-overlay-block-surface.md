# ADR-0008: Accessibility overlay as the block surface + pausable session note

Date: 2026-09-24
Status: accepted
Supersedes: ADR-0005 (HOME bounce + JS interstitial only)
Extends: ADR-0006 (heads-up note is now the fallback path), ADR-0007 (session note)

## Context
On device the HOME bounce read as "the blocked app crashes", and the JS
interstitial — navigated from the background blocked-attempt emit — was
pushed onto a stack nobody saw, then greeted the user on their next return
to StayT. Product decision: show the block screen on top of the blocked app
itself. Separately: the session note should work like a music player
(play/pause + live timer) and match the app palette.

## Decision
- Block surface is a full-screen `TYPE_ACCESSIBILITY_OVERLAY` window added
  by the service over the blocked app. No HOME bounce, no heads-up note on
  that path. Buttons: BACK TO <TASK> (launch StayT), CLOSE <APP> (HOME;
  hardware BACK does the same), MORE OPTIONS (blocked deep link → the JS
  interstitial, which keeps owning overrides / breaks / friction / strict).
- Crash hardening vs ADR-0005's addView race: main thread only (bridge
  callers hop via the main handler), one view at most (retarget, never
  stack), no HOME racing the overlay, every WindowManager call inside
  `catch (Throwable)`. If `addView` fails the old HOME + emit + best-effort
  foreground + heads-up path runs unchanged.
- Overlay leaves when another non-blocked app comes to front (launcher,
  recents target). SystemUI (shade) and the current IME are ignored so they
  cannot expose the app underneath. Launch buttons start StayT while the
  overlay is still visible, then remove it; a recheck 800 ms later re-shows
  the overlay if a silently denied launch left the blocked app in front.
- JS `onBlockedAttempt` is log-only; it never navigates.
- Session note: themed midnight card, native `Chronometer` (the 5 s refresh
  loop is gone), play/pause via an explicit, non-exported
  `SessionControlReceiver`. Pause = enforcement off + timer frozen until
  resume; paused time is excluded from the session duration. Pause state is
  native-owned and persisted (`stayt_blocking_state` prefs), exposed via
  `getSessionPause` / `setSessionPaused` / `onSessionPauseChanged`.
  `setSessionInfo(startedAt, pausable)` gives the note the real session
  start and hides pause for strict / dumbphone tasks. A user pause survives
  `setBlocking(true)` re-pushes; `setBlocking(false)` clears it.

## Verified vs official docs (2026-09-24)
- `WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY`: "Windows that are
  overlaid only by a connected AccessibilityService for interception of
  user interactions… for example, if there is a full screen accessibility
  overlay that is touchable…" — full-screen touchable use is documented.
  No SYSTEM_ALERT_WINDOW needed.
- Background activity starts: allowed when "the app has a visible window".
  Launches are fired while the overlay is visible; the recheck covers OEMs
  that still deny silently.

## Consequences
- No new permissions. New receiver in the manifest (plugin.js).
- Audio/video of the blocked app may keep playing under the overlay until
  CLOSE is tapped.
- Needs EAS build + on-device proof (Samsung M52).

## Amendment (2026-09-24, on-device M52 pass)
- Native surfaces follow the **app** theme, not the phone's: JS mirrors the
  resolved light/dark choice via `setThemeDark` (`stayt_theme` prefs). The
  overlay, window covers, session note and widget use the tokens.ts palette
  (pure black / paper, white / ink) and repaint on change.
- Session note + widget use system font faces (bold / condensed bold):
  Samsung's shade and launcher ignored bundled `res/font` fonts in
  RemoteViews, so `res/font` is no longer shipped.
- Note small icon = the app's monochrome launcher icon.
- Break / override end and resume re-scan windows immediately (a blocked app
  left in front used to stay usable until the next window event).
- Back on a live session screen backgrounds the app (`moveToBack`) instead of
  popping it: popping ran the screen's stopBlocking cleanup and stranded an
  "active" session with no screen or timer.
