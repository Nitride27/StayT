# ADR-0003: canRetrieveWindowContent scope and privacy holding

Date: 2026-09-17
Status: accepted

## Context
accessibility_service_config.xml sets canRetrieveWindowContent="true".
The PrivacyPolicy screen promises: no keystroke/screen-content collection,
nothing transmitted, all data on-device.

## Decision
Keep the flag. Its ONLY uses are:
1. event.source className check (feed-shield EditText typing guard),
   recycled in finally — never stored, logged, or emitted.
2. event.text lowercased haystack for domain/keyword matching — a local
   variable; only the matched domain string (or nothing) leaves the matcher.
   Emitted-to-JS payload is {packageName, timestamp, appLabel} only.

Verified: no network egress of accessibility data anywhere (no fetch of
event content; INTERNET permission is Expo-default, unused by the blocker).
getStringSet reads never mutate the returned live set (all uses copy via
filter/toSet).

## Consequences
- Policy wording "sees foreground package and web domains only" is shorthand
  for "processes window text in memory only to decide blocks"; consider a
  one-line clarification. No code change needed.
- Do NOT set the flag false: the typing guard prevents BACK-hijack while
  typing, a worse harm than the in-memory read.
