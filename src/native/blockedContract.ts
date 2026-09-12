/**
 * BlockedContract — the single seam for everything crossing the native/JS
 * boundary in the blocked flow: deep-link URIs, query keys, package shape,
 * and entry-dedup policy inputs.
 *
 * Rule: NOTHING outside this module may hardcode the scheme, host, query
 * keys, or package regex. Kotlin mirrors these as companion constants
 * (StayTAccessibilityService: BLOCKED_SCHEME/HOST/KEY_PACKAGE/KEY_LABEL).
 * Change it here once and both sides stay in lockstep; contract tests
 * (when a runner lands) assert exact URIs against these builders.
 */

export const BLOCKED_SCHEME = 'exp+stayt-app';
export const BLOCKED_HOST = 'blocked';
export const TASKS_PATH = 'tasks';
export const KEY_PACKAGE = 'packageName';
export const KEY_LABEL = 'label';

export const TASKS_DEEP_LINK = `${BLOCKED_SCHEME}://${TASKS_PATH}`;

/** Android package names: dot-separated identifiers, capped for sanity. */
export const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
export const MAX_PACKAGE_LEN = 256;
export const MAX_LABEL_LEN = 128;

export interface BlockedDeepLink {
  packageName: string;
  appLabel?: string;
}

export function buildBlockedLink(packageName: string, appLabel?: string): string {
  let url = `${BLOCKED_SCHEME}://${BLOCKED_HOST}?${KEY_PACKAGE}=${encodeURIComponent(packageName)}`;
  if (appLabel) url += `&${KEY_LABEL}=${encodeURIComponent(appLabel)}`;
  return url;
}

export function parseBlockedDeepLink(url: string): BlockedDeepLink | null {
  if (!url.startsWith(`${BLOCKED_SCHEME}://${BLOCKED_HOST}`)) return null;
  try {
    const pkg = new RegExp(`[?&]${KEY_PACKAGE}=([^&]+)`).exec(url);
    if (!pkg) return null;
    const packageName = decodeURIComponent(pkg[1]);
    if (!PACKAGE_RE.test(packageName) || packageName.length > MAX_PACKAGE_LEN) {
      return null;
    }
    const lbl = new RegExp(`[?&]${KEY_LABEL}=([^&]+)`).exec(url);
    let appLabel: string | undefined;
    try {
      appLabel = lbl ? decodeURIComponent(lbl[1]).slice(0, MAX_LABEL_LEN) : undefined;
    } catch {
      appLabel = undefined;
    }
    return appLabel ? { packageName, appLabel } : { packageName };
  } catch {
    return null;
  }
}

export function isTasksDeepLink(url: string): boolean {
  return url === TASKS_DEEP_LINK || url.startsWith(`${BLOCKED_SCHEME}://${TASKS_PATH}?`);
}
