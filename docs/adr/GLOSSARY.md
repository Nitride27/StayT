# StayT glossary (architecture + review terms)

- **Seam**: a single module owning one cross-boundary contract
  (BlockedContract for deep links, OverrideBudget seam for override consume,
  BlockedEntryCoordinator for entry dedup, WidgetData for the prefs mirror).
- **Hard block wins**: collision rule — an app is never both hard-blocked and
  feed-shielded/budget-gated; the block path always takes enforcement.
- **Single-surface rule**: only one block screen at a time — the JS
  interstitial dismisses the native overlay on mount.
- **Durable intent**: SharedPreferences mirror of desired blocking state,
  re-armed on service connect so process death/reboot preserves enforcement.
- **Fail-closed**: on doubt, keep blocking (pause timer cleared on
  setBlocking, process death re-arms, overlay enforces on bounce denial).
- **BAL**: background activity launch (restricted Android 10+, hardened
  14/15) — why the overlay never auto-foregrounds StayT.
- **Safelist**: system surfaces allowlist mode must never block
  (launchers, dialer, systemui, Settings kill-switch).
- **Deepening** (improve-codebase-architecture vocabulary): turning a shallow
  module into a deep one — interface small vs implementation. **Leverage**:
  how much work the interface saves callers. **Locality**: related logic
  living together. **Deletion test**: deleting the module should concentrate
  complexity, not just move it.
