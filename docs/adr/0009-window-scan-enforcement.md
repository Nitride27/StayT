# ADR-0009: Window-scan enforcement + session/schedule union

Date: 2026-09-24
Status: accepted
Extends: ADR-0008 (accessibility overlay block surface)

## Context
ADR-0008 drove the overlay from the last WINDOW_STATE_CHANGED event. Any
path that keeps a blocked window on screen without an event from its app
bypassed it: split screen (event from the other pane dismissed the
overlay), Samsung pop-up view / minimise-to-bubble (survives HOME), PiP
(video keeps playing over the launcher) and chat bubbles. Separately,
schedules and manual sessions overwrote each other's package sets, and
allowlist mode leaked past the session that set it.

## Decision
- The visible-window list is the source of truth. The service subscribes
  to TYPE_WINDOWS_CHANGED and FLAG_RETRIEVE_INTERACTIVE_WINDOWS and, on every
  window change (120 ms trailing throttle), scans `getWindows()` for
  TYPE_APPLICATION windows of blocked packages:
  - a blocked window covering >= 85% of the screen gets the full overlay;
  - smaller ones get a cover pinned to their bounds: touchable (the app
    can't be used blind), except PiP (touch passes through so it can be
    dragged away) and pop-ups (32dp caption bar left uncovered so
    close / minimise stay reachable);
  - a newly seen blocked PiP window gets one MEDIA_PAUSE key.
- Fail-closed: an unavailable list (no app windows reported) keeps the
  current surfaces; the block-event path never dismisses (the list can lag
  the event) and falls back to a full overlay if nothing got covered.
- Blocked-domain hits mark that browser as blocked until it leaves the
  screen or the user closes it.
- Blocking = union of the live JS session's packages (persisted as
  `session_pkgs`) and the active schedule windows. Bridge start/stop,
  schedule START/STOP and the schedule push all go through that union, so
  neither unblocks the other's apps. `setBlocking(false)` clears allowlist
  mode.

## Verified vs official docs (2026-09-24)
- `AccessibilityService.getWindows()`: needs `canRetrieveWindowContent`
  and `FLAG_RETRIEVE_INTERACTIVE_WINDOWS`; returns an empty list otherwise.
- `TYPE_ACCESSIBILITY_OVERLAY`: windows under a full-screen touchable
  accessibility overlay stay introspectable, so the scan still sees the
  blocked app beneath our own overlay.
- `AccessibilityWindowInfo.isInPictureInPictureMode()`: API 26 (guarded).

## Consequences
- Heuristics to tune on device: the 85% full-screen threshold and the
  32dp pop-up caption.
- Not covered: secondary displays (DeX / casting — scan reads the default
  display), and turning the accessibility service off or force-stopping
  StayT in Settings (Settings is safelisted by design).

## Amendment (2026-09-25, on-device Pro pass, M52)
- **Blocked websites** read the browser address bar (known view ids per
  browser; Samsung Internet verified, strips its U+200E mark) during the
  window scan, re-run on TYPE_WINDOW_CONTENT_CHANGED from browsers only. The
  old event-text match never saw the URL: wikipedia.org loaded unblocked.
- **Budgets enforce**: an open is counted whenever a budgeted app comes to
  the front (shade/keyboard excluded); an app over its opens/minutes budget
  is a block target ("today's budget is used up"). Previously only already-
  blocked apps were counted, so a budget never blocked anything.
- **Feed Shield** detects sections from the view tree (Instagram Reels
  viewer id, verified; generic "selected tab named Reels/Shorts/Explore/
  Comments"), re-checked on content changes from shielded apps only. Tab
  switches fire no window-state event, so it never triggered. Feed rows are
  no longer force-disabled when some task blocks the app: shields are global,
  blocks per task, and runtime precedence (target apps skip the shield)
  already resolves it.
- Blocks first covered by the scan (websites, split, pop-up) are logged
  (same per-package cooldown as the event path).
- A block is attributed to the **running session's task**, not the first
  task listing the app (wrong name / strict rules when an app is in several).
