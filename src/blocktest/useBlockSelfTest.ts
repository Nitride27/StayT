import { useCallback, useEffect, useRef, useState } from 'react';
import AppBlocker from '../native/AppBlocker';
import { store } from '../storage/store';

/**
 * P0-2 "Test my blocks" self-test (JS only, no new deps).
 *
 * Flow: start(testPackage) -> startBlocking([pkg]) -> user opens that app ->
 * existing onBlockedAttempt listener fires -> success -> stopBlocking().
 * 60s timeout plus start/stop failure states included. Callers render their
 * own copy; this hook owns the state machine and guarantees blocking is
 * released on every terminal path and on unmount.
 */

export type SelfTestState = 'idle' | 'waiting' | 'success' | 'timeout' | 'error';

const TIMEOUT_MS = 60_000;

/**
 * Shared test-target resolution: first task's app, else an installed
 * YouTube/Instagram, else a static YouTube fallback. Used by Settings and
 * PermissionSetup so both buttons test the same thing.
 */
export async function resolveSelfTestApp(): Promise<{ packageName: string; appName: string }> {
  try {
    const tasks = await store.getTasks();
    const first = tasks.find(t => t.packageName);
    if (first) return { packageName: first.packageName, appName: first.appName };
  } catch {
    // Fall through to the installed-app fallback.
  }
  try {
    const apps = await AppBlocker.getInstalledApps();
    const pick =
      apps.find(a => a.packageName === 'com.google.android.youtube') ??
      apps.find(a => a.packageName === 'com.instagram.android') ??
      apps[0];
    if (pick) return { packageName: pick.packageName, appName: pick.appName };
  } catch {
    // Fall through to the static fallback below.
  }
  return { packageName: 'com.google.android.youtube', appName: 'YouTube' };
}

export function useBlockSelfTest() {
  const [state, setState] = useState<SelfTestState>('idle');
  const [remaining, setRemaining] = useState(60);
  const [testPackage, setTestPackage] = useState('');
  const unsubRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback((releaseBlocking: boolean) => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    if (releaseBlocking) AppBlocker.stopBlocking().catch(() => {});
  }, []);

  // Release blocking if the screen unmounts mid-test.
  useEffect(() => () => cleanup(true), [cleanup]);

  const cancel = useCallback(() => {
    cleanup(true);
    setState('idle');
    setRemaining(60);
  }, [cleanup]);

  const start = useCallback(
    async (packageName: string): Promise<'started' | 'session-active' | 'error'> => {
      // B2: the test replaces the block set via startBlocking — never hijack
      // a live session. Callers surface the 'session-active' copy.
      try {
        const active = await store.getActiveSession();
        if (active) return 'session-active';
      } catch {
        // A storage failure must not block the test; fall through.
      }
      cleanup(false);
      setTestPackage(packageName);
      setRemaining(60);
      let ok = false;
      try {
        ok = await AppBlocker.startBlocking([packageName]);
      } catch {
        ok = false;
      }
      if (!ok) {
        setState('error');
        return 'error';
      }
      setState('waiting');
      const startedAt = Date.now();
      tickRef.current = setInterval(() => {
        setRemaining(Math.max(0, 60 - Math.floor((Date.now() - startedAt) / 1000)));
      }, 1000);
      unsubRef.current = AppBlocker.onBlockedAttempt(() => {
        // Any block event during the window proves detection end-to-end
        // (the test package is the only thing blocked right now).
        cleanup(true);
        setState('success');
      });
      timerRef.current = setTimeout(() => {
        cleanup(true);
        setState('timeout');
      }, TIMEOUT_MS);
      return 'started';
    },
    [cleanup],
  );

  return { state, remaining, testPackage, start, cancel };
}
