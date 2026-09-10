# Test Automation Summary

Framework: **Maestro** (Expo-documented E2E choice for SDK 57: YAML flows,
zero app changes, runs on EAS builds).

## Generated Tests

### E2E Tests
- [x] `.maestro/onboarding.yml` (4 steps) — fresh install: Welcome → Get Started → permission screen
- [x] `.maestro/task-create.yml` (11 steps) — create "Maestro Test" task via manual package override → back on Tasks
- [x] `.maestro/session.yml` (7 steps) — start session, assert stable elements, End Session
- [x] `.maestro/history.yml` (5 steps) — History screen shows Focus Time stats

All flows use semantic text locators, no sleeps, YAML-validated.
`eas.json` gained an `e2e-test` profile (APK, no credentials) for CI.

## Coverage
- UI flows: 4/8 screens covered (Welcome, PermissionSetup, TaskPicker, TaskSetup, ActiveSession, History)
- Not covered: BlockedInterstitial (needs real accessibility bounce), Paywall purchase (needs Play product + signed build)
- API endpoints: n/a (no backend; AsyncStorage + native bridge only)

## Execution status
- [ ] NOT RUN — requires Maestro CLI + emulator/device or EAS Workflow.
  Local: `maestro test .maestro/` (after `eas build --profile e2e-test` + install APK).
  CI: `.eas/workflows/e2e-test-android.yml` (not yet created — needs EAS Workflows setup).

## Preconditions for green runs
1. `stayt_pro` one-time product created in Play Console (Paywall purchase path).
2. Blocker-fix commit `0ddcedf` built into the tested APK (fixes bridge name, onboarding flag, paywall wiring).
3. Permissions granted once manually before task-loop flows (system dialogs are out of automation scope).

## Next Steps
- Run flows on a real device after the next preview build.
- Add BlockedInterstitial flow once a scripted bounce harness exists.
- Add purchase flow once Play product + license testers are configured.
