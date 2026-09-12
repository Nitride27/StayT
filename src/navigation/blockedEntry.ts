/**
 * BlockedEntryCoordinator — single owner of blocked-entry policy.
 *
 * Problem it fixes: one block event arrives via BOTH the JS emit and the
 * deep-link foreground rung (plus notification taps), sometimes milliseconds
 * apart across an await. Neither a pure time window (drops legitimate fast
 * re-blocks, misses slow second fires) nor a pure route check (both handlers
 * can pass it before either navigation commits) is sufficient alone.
 *
 * Interface: decideEntry() returns 'shown' | 'deduped' | 'dropped'.
 * Callers (App.tsx effects) stay thin adapters: build a snapshot, call,
 * navigate only on 'shown'. Pure logic + injectable clock/route = unit
 * testable without a mounted container (no runner wired yet — surface kept
 * small and side-effect-free for that day).
 */

export type EntryVerdict = 'shown' | 'deduped' | 'dropped';

export interface EntrySnapshot {
  ready: boolean;
  routeName?: string;
  routePkg?: string;
}

const CLAIM_WINDOW_MS = 1500;

let lastClaimPkg = '';
let lastClaimAt = 0;

/** Test seam: reset module claim state between unit cases. */
export function __resetEntryClaims(): void {
  lastClaimPkg = '';
  lastClaimAt = 0;
}

export function decideEntry(
  packageName: string,
  snap: EntrySnapshot,
  now: number = Date.now(),
): EntryVerdict {
  if (!snap.ready) return 'dropped';
  if (snap.routeName === 'BlockedInterstitial' && snap.routePkg === packageName) {
    return 'deduped';
  }
  if (packageName === lastClaimPkg && now - lastClaimAt < CLAIM_WINDOW_MS) {
    return 'deduped';
  }
  lastClaimPkg = packageName;
  lastClaimAt = now;
  return 'shown';
}
