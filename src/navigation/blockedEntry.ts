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
 * shouldLogEntry() owns the stats-side dedup: one block delivered twice
 * (emit + deep-link milliseconds apart, BAL-delayed re-entries) must still
 * log exactly one give_in. Same module, one clock policy, two consumers —
 * the nav window and the log window encode different knowledge and must
 * NOT be merged into one number:
 * - CLAIM_WINDOW_MS (1.5s): navigation dedup. A re-block seconds later must
 *   still SHOW the interstitial (route check + short claim only).
 * - LOG_WINDOW_MS (5s): stats dedup. BAL can redeliver the same block
 *   seconds late; logging it again would double-count one give_in.
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
const LOG_WINDOW_MS = 5000;

let lastClaimPkg = '';
let lastClaimAt = 0;
let lastLoggedPkg = '';
let lastLoggedAt = 0;

/** Test seam: reset module claim state between unit cases. */
export function __resetEntryClaims(): void {
  lastClaimPkg = '';
  lastClaimAt = 0;
  lastLoggedPkg = '';
  lastLoggedAt = 0;
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

/**
 * Stats-side dedup (moved here from App.tsx so both windows live in one
 * seam). Same package logged <LOG_WINDOW_MS ago → skip; the interstitial
 * still shows. Never throws.
 */
export function shouldLogEntry(packageName: string, now: number = Date.now()): boolean {
  if (packageName === lastLoggedPkg && now - lastLoggedAt < LOG_WINDOW_MS) {
    return false;
  }
  lastLoggedPkg = packageName;
  lastLoggedAt = now;
  return true;
}
