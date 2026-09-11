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

  // xml/accessibility_service_config.xml
  const xmlDest = path.join(destRes, "xml/accessibility_service_config.xml");
  fs.mkdirSync(path.dirname(xmlDest), { recursive: true });
  fs.copyFileSync(path.join(RES_SRC, "xml/accessibility_service_config.xml"), xmlDest);

  // values/strings.xml — merge service description into existing
  const stringsDest = path.join(destRes, "values/strings.xml");
  const serviceDesc =
    "StayT uses this service to detect when you open a blocked app and redirect you back to your task. No data is collected or transmitted.";
  if (fs.existsSync(stringsDest)) {
    let existing = fs.readFileSync(stringsDest, "utf8");
    if (!existing.includes("accessibility_service_description")) {
      existing = existing.replace(
        "</resources>",
        `  <string name="accessibility_service_description">${serviceDesc}</string>\n</resources>`
      );
      fs.writeFileSync(stringsDest, existing);
    }
  } else {
    fs.mkdirSync(path.dirname(stringsDest), { recursive: true });
    fs.writeFileSync(
      stringsDest,
      `<resources>\n  <string name="accessibility_service_description">${serviceDesc}</string>\n</resources>\n`
    );
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
