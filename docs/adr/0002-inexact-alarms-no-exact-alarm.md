# ADR-0002: Inexact alarms, no SCHEDULE_EXACT_ALARM

Date: 2026-09-17
Status: accepted

## Context
Focus schedules need START/STOP firings that survive reboot and Doze.
Exact alarms need SCHEDULE_EXACT_ALARM (denied by default on Android 13+,
revocable, Play-scrutinized) plus a permission-state-change receiver.

## Decision
Use setAndAllowWhileIdle (RTC_WAKEUP, inexact) for schedule + midnight
alarms. Deliberately no exact alarms, no new permissions.

## Verified vs official docs (2026-09-17)
- setAndAllowWhileIdle fires in Doze but is batched (~9 min ceiling per app
  in idle; inexact alarms may deliver up to ~1h late under restrictions).
- Accepted: focus-hour boundaries may fire minutes late in deep Doze.
- RECEIVE_BOOT_COMPLETED is a normal permission; MY_PACKAGE_REPLACED covers
  the app-update-kills-alarms case. No TIMEZONE_CHANGED observer (documented
  limitation; next push/reboot heals drift).

## Consequences
- Boot/update receivers reprogram purely from the SharedPreferences mirror
  (JS store is dead at boot); STOP/START re-evaluate the union of active
  windows so overlaps never unblock early.
