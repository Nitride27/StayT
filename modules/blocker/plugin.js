const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const KOTLIN_SRC = path.join(
  __dirname,
  "src/main/java/com/nitridee/staytapp/blocker"
);
const RES_SRC = path.join(__dirname, "src/main/res");

function copyKotlinFiles(projectRoot) {
  const dest = path.join(
    projectRoot,
    "android/app/src/main/java/com/nitridee/staytapp/blocker"
  );
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(KOTLIN_SRC)) {
    if (f.endsWith(".kt")) {
      fs.copyFileSync(path.join(KOTLIN_SRC, f), path.join(dest, f));
    }
  }
}

function copyResFiles(projectRoot) {
  const destRes = path.join(projectRoot, "android/app/src/main/res");

  // xml/*.xml — accessibility config + P2-1 widget provider info.
  // Copied as a set so new xml resources need no per-file wiring.
  const xmlSrc = path.join(RES_SRC, "xml");
  const xmlDest = path.join(destRes, "xml");
  fs.mkdirSync(xmlDest, { recursive: true });
  if (fs.existsSync(xmlSrc)) {
    for (const f of fs.readdirSync(xmlSrc)) {
      if (f.endsWith(".xml")) {
        fs.copyFileSync(path.join(xmlSrc, f), path.join(xmlDest, f));
      }
    }
  }

  // layout/*.xml — P2-1 widget layout.
  const layoutSrc = path.join(RES_SRC, "layout");
  if (fs.existsSync(layoutSrc)) {
    const layoutDest = path.join(destRes, "layout");
    fs.mkdirSync(layoutDest, { recursive: true });
    for (const f of fs.readdirSync(layoutSrc)) {
      if (f.endsWith(".xml")) {
        fs.copyFileSync(path.join(layoutSrc, f), path.join(layoutDest, f));
      }
    }
  }

  // drawable/*.xml — vector icons (P2-2 tile icon). PNG overlay art below.
  const drawableXmlSrc = path.join(RES_SRC, "drawable");
  if (fs.existsSync(drawableXmlSrc)) {
    const drawableDest = path.join(destRes, "drawable");
    fs.mkdirSync(drawableDest, { recursive: true });
    for (const f of fs.readdirSync(drawableXmlSrc)) {
      if (f.endsWith(".xml")) {
        fs.copyFileSync(path.join(drawableXmlSrc, f), path.join(drawableDest, f));
      }
    }
  }

  // drawable-nodpi/overlay art (e.g. stayt_owl_blocked.png for the overlay)
  const drawableSrc = path.join(RES_SRC, "drawable-nodpi");
  if (fs.existsSync(drawableSrc)) {
    const drawableDest = path.join(destRes, "drawable-nodpi");
    fs.mkdirSync(drawableDest, { recursive: true });
    for (const f of fs.readdirSync(drawableSrc)) {
      if (f.endsWith(".png")) {
        fs.copyFileSync(path.join(drawableSrc, f), path.join(drawableDest, f));
      }
    }
  }

  // android assets/fonts — overlay type (Anton/SpaceGrotesk/Inter).
  // Source is the project's Expo font dir; listed explicitly so only the
  // overlay faces ship natively. Survives prebuild (android/ is generated).
  const fontsSrc = path.join(projectRoot, "assets/fonts");
  const fontsDest = path.join(projectRoot, "android/app/src/main/assets/fonts");
  for (const f of ["Anton-Regular.ttf", "SpaceGrotesk-Bold.ttf", "Inter-Regular.ttf"]) {
    try {
      const src = path.join(fontsSrc, f);
      if (fs.existsSync(src)) {
        fs.mkdirSync(fontsDest, { recursive: true });
        fs.copyFileSync(src, path.join(fontsDest, f));
      }
    } catch (_) {}
  }

  // values/strings.xml — merge blocker-owned strings into the existing
  // Expo-generated file. The template owns app_name; every string in the
  // module source (service description, widget description, …) must be
  // present or the build breaks (widget_info references stayt_widget_desc).
  // Merge, never overwrite: missing entries are inserted, existing kept.
  const stringsDest = path.join(destRes, "values/strings.xml");
  const ownedStrings = {
    accessibility_service_description:
      "StayT uses this service to detect when you open a blocked app and redirect you back to your task. No data is collected or transmitted.",
    stayt_widget_desc:
      "Focus time, streak and live session status.",
  };
  if (fs.existsSync(stringsDest)) {
    let existing = fs.readFileSync(stringsDest, "utf8");
    for (const [name, value] of Object.entries(ownedStrings)) {
      if (!existing.includes(`name="${name}"`)) {
        existing = existing.replace(
          "</resources>",
          `  <string name="${name}">${value}</string>\n</resources>`
        );
      }
    }
    fs.writeFileSync(stringsDest, existing);
  } else {
    fs.mkdirSync(path.dirname(stringsDest), { recursive: true });
    const entries = Object.entries(ownedStrings)
      .map(([name, value]) => `  <string name="${name}">${value}</string>`)
      .join("\n");
    fs.writeFileSync(stringsDest, `<resources>\n  <string name="app_name">StayT</string>\n${entries}\n</resources>\n`);
  }
}

function withBlocker(config) {
  // 0. Play-safe manifest hygiene: drop unused SYSTEM_ALERT_WINDOW, ensure the
  // LAUNCHER <queries> intent getInstalledApps relies on.
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (manifest["uses-permission"]) {
      manifest["uses-permission"] = manifest["uses-permission"].filter(
        (p) => p.$?.["android:name"] !== "android.permission.SYSTEM_ALERT_WINDOW"
      );
    }
    // Plain tap-to-return blocked notification (API 33+ runtime permission;
    // granted via the existing expo-notifications request flow — no overlay,
    // no full-screen intent, no Play review cost).
    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    if (
      !manifest["uses-permission"].some(
        (p) => p.$?.["android:name"] === "android.permission.POST_NOTIFICATIONS"
      )
    ) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.POST_NOTIFICATIONS" },
      });
    }
    if (!manifest.queries) manifest.queries = [];
    if (!manifest.queries[0]) manifest.queries[0] = {};
    if (!manifest.queries[0].intent) manifest.queries[0].intent = [];
    const hasLauncher = manifest.queries[0].intent.some(
      (i) =>
        i.action?.some((a) => a.$?.["android:name"] === "android.intent.action.MAIN") &&
        i.category?.some((c) => c.$?.["android:name"] === "android.intent.category.LAUNCHER")
    );
    if (!hasLauncher) {
      manifest.queries[0].intent.push({
        action: [{ $: { "android:name": "android.intent.action.MAIN" } }],
        category: [{ $: { "android:name": "android.intent.category.LAUNCHER" } }],
      });
    }
    return cfg;
  });

  // 1. Add <service> to AndroidManifest.xml inside <application>
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    if (!app.service) app.service = [];
    const already = app.service.some((s) =>
      s.$?.["android:name"]?.includes("StayTAccessibilityService")
    );
    if (!already) {
      app.service.push({
        $: {
          "android:name":
            "com.nitridee.staytapp.blocker.StayTAccessibilityService",
          "android:permission": "android.permission.BIND_ACCESSIBILITY_SERVICE",
          "android:exported": "false",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name":
                    "android.accessibilityservice.AccessibilityService",
                },
              },
            ],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.accessibilityservice",
              "android:resource": "@xml/accessibility_service_config",
            },
          },
        ],
      });
    }
    return cfg;
  });

  // 1b. Focus-schedule alarms: RECEIVE_BOOT_COMPLETED (normal permission,
  // no Play declaration needed) + boot/alarm receivers. Idempotent.
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    if (
      !manifest["uses-permission"].some(
        (p) => p.$?.["android:name"] === "android.permission.RECEIVE_BOOT_COMPLETED"
      )
    ) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.RECEIVE_BOOT_COMPLETED" },
      });
    }
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      if (!app.receiver) app.receiver = [];
      const ensureReceiver = (name, actions) => {
        const already = app.receiver.some((r) =>
          r.$?.["android:name"]?.includes(name)
        );
        if (already) return;
        const entry = {
          $: {
            "android:name": `com.nitridee.staytapp.blocker.${name}`,
            "android:exported": "false",
          },
        };
        if (actions.length) {
          entry["intent-filter"] = [
            { action: actions.map((a) => ({ $: { "android:name": a } })) },
          ];
        }
        app.receiver.push(entry);
      };
      ensureReceiver("ScheduleBootReceiver", [
        "android.intent.action.BOOT_COMPLETED",
        // L4: app updates kill alarms like reboots do — re-arm there too.
        "android.intent.action.MY_PACKAGE_REPLACED",
      ]);
      ensureReceiver("ScheduleAlarmReceiver", []);
      // P2-1 widget: update receiver (APPWIDGET_UPDATE + provider info) and
      // the dateless midnight rollover receiver (explicit alarms only).
      ensureReceiver("WidgetMidnightReceiver", []);
      const widgetAlready = app.receiver.some((r) =>
        r.$?.["android:name"]?.includes("StayTWidgetProvider")
      );
      if (!widgetAlready) {
        app.receiver.push({
          $: {
            "android:name": "com.nitridee.staytapp.blocker.StayTWidgetProvider",
            "android:exported": "false",
          },
          "intent-filter": [
            { action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] },
          ],
          "meta-data": [
            {
              $: {
                "android:name": "android.appwidget.provider",
                "android:resource": "@xml/stayt_widget_info",
              },
            },
          ],
        });
      }
    }
    return cfg;
  });

  // P2-2 QS tile (PRO): TileService declaration. Idempotent.
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      if (!app.service) app.service = [];
      const already = app.service.some((s) =>
        s.$?.["android:name"]?.includes("StayTTileService")
      );
      if (!already) {
        app.service.push({
          $: {
            "android:name": "com.nitridee.staytapp.blocker.StayTTileService",
            "android:permission": "android.permission.BIND_QUICK_SETTINGS_TILE",
            "android:exported": "true",
            "android:icon": "@drawable/ic_stayt_tile",
            "android:label": "StayT",
          },
          "intent-filter": [
            {
              action: [
                {
                  $: {
                    "android:name": "android.service.quicksettings.action.QS_TILE",
                  },
                },
              ],
            },
          ],
        });
      }
    }
    return cfg;
  });

  // 1c. Blocked-flow deep-link scheme (exp+stayt-app://...): the overlay,
  // notification, tile, and JS contract all route back into StayT through
  // it (single source: src/native/blockedContract.ts BLOCKED_SCHEME).
  // Prebuild only generates exp+<slug>, so this filter is owned here.
  // Idempotent: skipped when a matching data scheme already exists.
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const activity = app?.activity?.find(
      (a) => a.$?.["android:name"] === ".MainActivity"
    );
    if (activity) {
      if (!activity["intent-filter"]) activity["intent-filter"] = [];
      const SCHEME = "exp+stayt-app";
      const hasScheme = activity["intent-filter"].some((f) =>
        f.data?.some((d) => d.$?.["android:scheme"] === SCHEME)
      );
      if (!hasScheme) {
        activity["intent-filter"].push({
          action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
          category: [
            { $: { "android:name": "android.intent.category.DEFAULT" } },
            { $: { "android:name": "android.intent.category.BROWSABLE" } },
          ],
          data: [{ $: { "android:scheme": SCHEME } }],
        });
      }
    }
    return cfg;
  });

  // 2. Add AppBlockerPackage import + registration to MainApplication.kt
  config = withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const importLine =
      "import com.nitridee.staytapp.blocker.AppBlockerPackage";
    if (!contents.includes(importLine)) {
      contents = contents.replace(
        /import expo\.modules\.ExpoReactHostFactory/,
        `import expo.modules.ExpoReactHostFactory\n${importLine}`
      );
    }
    if (!contents.includes("AppBlockerPackage()")) {
      contents = contents.replace(
        /PackageList\(this\)\.packages\.apply \{[\s\S]*?\}/,
        `PackageList(this).packages.apply {\n          add(AppBlockerPackage())\n        }`
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

  // 3. Copy Kotlin source files and XML resources into android/
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      copyKotlinFiles(cfg.modRequest.projectRoot);
      copyResFiles(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);

  return config;
}

module.exports = withBlocker;
