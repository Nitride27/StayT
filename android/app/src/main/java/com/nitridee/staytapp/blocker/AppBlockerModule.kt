package com.nitridee.staytapp.blocker

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.modules.core.DeviceEventManagerModule

class AppBlockerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "StayTAppBlocker"
        @Volatile
        private var instance: AppBlockerModule? = null

        fun emitBlockedAttempt(packageName: String, timestamp: Long, appLabel: String) {
            instance?.emitToJS(packageName, timestamp, appLabel)
        }
    }

    init {
        instance = this
    }

    override fun getName(): String = "AppBlocker"

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        try {
            // M4: shared seam — same Settings.Secure logic the tile uses.
            promise.resolve(StayTAccessibilityService.isServiceEnabled(reactApplicationContext))
        } catch (e: Exception) {
            Log.e(TAG, "isAccessibilityServiceEnabled failed", e)
            promise.reject("ACCESSIBILITY_CHECK_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "openAccessibilitySettings failed", e)
        }
    }

    /**
     * `allowlist` null = blocklist mode (default, old callers); a concrete
     * array (including empty = block-all-except-safelist) = allowlist mode.
     * The null-vs-empty distinction is preserved — [] is never coerced to
     * null here. Matches AppBlocker.ts startBlocking(blocked, taskName, {allowlist}).
     */
    @ReactMethod
    fun startBlocking(blocked: ReadableArray?, taskName: String?, allowlist: ReadableArray?, promise: Promise) {
        try {
            if (blocked == null) {
                promise.reject("INVALID_ARGS", "blockedPackages is null")
                return
            }
            val blockedPackages = blocked.toArrayList().map { it.toString() }
            if (allowlist == null) {
                StayTAccessibilityService.clearAllowlist()
                StayTAccessibilityService.setBlocking(blocking = true, blocked = blockedPackages, taskName = taskName)
            } else {
                val allow = try {
                    allowlist.toArrayList().map { it.toString() }
                } catch (_: Exception) {
                    emptyList()
                }
                StayTAccessibilityService.setBlocking(blocking = true, blocked = blockedPackages, taskName = taskName, allowlist = allow)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "startBlocking failed", e)
            promise.reject("START_BLOCKING_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopBlocking(promise: Promise) {
        try {
            StayTAccessibilityService.setBlocking(blocking = false)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "stopBlocking failed", e)
            promise.reject("STOP_BLOCKING_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            // Launcher query: visible without QUERY_ALL_PACKAGES (Play-safe).
            // Requires the LAUNCHER <queries> intent in AndroidManifest.xml.
            val pm = reactApplicationContext.packageManager
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val apps = pm.queryIntentActivities(launcher, 0)
                .map { it.activityInfo.applicationInfo }
                .distinctBy { it.packageName }
                .sortedBy { pm.getApplicationLabel(it).toString() }
                .map { appInfo ->
                    val map = Arguments.createMap()
                    map.putString("packageName", appInfo.packageName)
                    map.putString("appName", pm.getApplicationLabel(appInfo).toString())
                    // Per-app best-effort: one bad icon must never fail the whole list.
                    map.putString("iconBase64", loadIconBase64(appInfo.packageName))
                    map
                }
            val result = Arguments.createArray()
            apps.forEach { result.pushMap(it) }
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "getInstalledApps failed", e)
            promise.reject("GET_APPS_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun pauseBlocking(seconds: Double, promise: Promise) {
        try {
            StayTAccessibilityService.pauseBlocking(seconds.toLong())
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "pauseBlocking failed", e)
            promise.reject("PAUSE_BLOCKING_FAILED", e.message, e)
        }
    }

    /**
     * Single-surface rule (JS BlockedInterstitial calls this on mount):
     * drop the native overlay so it never stacks over the interstitial.
     * No-op when no overlay is showing; never throws.
     */
    @ReactMethod
    fun dismissBlockedOverlay(promise: Promise) {
        try {
            StayTAccessibilityService.dismissOverlay()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "dismissBlockedOverlay failed", e)
            promise.reject("DISMISS_OVERLAY_FAILED", e.message, e)
        }
    }

    /**
     * Push escalating-friction config. NOTE on the wire shape: this takes a
     * SINGLE config map, not three scalars, because the TS caller
     * (AppBlocker.ts setFriction) sends one object arg:
     * AppBlocker.setFriction({enabled, delaySeconds, escalate}). A 3-scalar
     * native signature could never match that call — the map IS the shape.
     * Missing keys fall back to disabled / 0s / no-escalation. Never throws.
     */
    @ReactMethod
    fun setFriction(config: ReadableMap?, promise: Promise) {
        try {
            var enabled = false
            var delaySec = 0.0
            var escalate = false
            try {
                if (config != null) {
                    enabled = readBool(config, "enabled", false)
                    try {
                        if (config.hasKey("delaySeconds") && config.getType("delaySeconds") == ReadableType.Number) {
                            delaySec = maxOf(0.0, config.getDouble("delaySeconds"))
                        }
                    } catch (_: Exception) {
                    }
                    escalate = readBool(config, "escalate", false)
                }
            } catch (_: Exception) {
            }
            StayTAccessibilityService.setFrictionConfig(enabled, delaySec, escalate)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setFriction failed", e)
            try {
                promise.reject("SET_FRICTION_FAILED", e.message, e)
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Push per-app usage budgets: [{packageName, kind ('opens'|'minutes'),
     * limit, enabled}]. Malformed items are skipped; limit<=0 coerces to
     * disabled. Never throws.
     */
    @ReactMethod
    fun setBudgets(budgets: ReadableArray?, promise: Promise) {
        try {
            val rules = mutableListOf<StayTAccessibilityService.BudgetRule>()
            try {
                if (budgets != null) {
                    for (i in 0 until budgets.size()) {
                        try {
                            if (budgets.getType(i) != ReadableType.Map) continue
                            val m = budgets.getMap(i) ?: continue
                            val pkg = try {
                                if (m.hasKey("packageName") && m.getType("packageName") == ReadableType.String) m.getString("packageName") else null
                            } catch (_: Exception) {
                                null
                            } ?: continue
                            if (pkg.isBlank()) continue
                            val kind = try {
                                if (m.hasKey("kind") && m.getType("kind") == ReadableType.String) m.getString("kind") else null
                            } catch (_: Exception) {
                                null
                            } ?: continue
                            if (kind != "opens" && kind != "minutes") continue
                            val limit = try {
                                if (m.hasKey("limit") && m.getType("limit") == ReadableType.Number) m.getDouble("limit").toInt() else 0
                            } catch (_: Exception) {
                                0
                            }
                            val enabled = readBool(m, "enabled", false)
                            rules.add(StayTAccessibilityService.BudgetRule(pkg, kind, maxOf(0, limit), enabled && limit > 0))
                        } catch (_: Exception) {
                        }
                    }
                }
            } catch (_: Exception) {
            }
            StayTAccessibilityService.setBudgetRules(rules)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setBudgets failed", e)
            try {
                promise.reject("SET_BUDGETS_FAILED", e.message, e)
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Today's usage counters: {packageName: {opens, minutes}}. Resolves {}
     * on any failure; never throws.
     */
    @ReactMethod
    fun getBudgetUsage(promise: Promise) {
        try {
            val out = Arguments.createMap()
            try {
                val snap = StayTAccessibilityService.budgetUsageSnapshot(reactApplicationContext)
                for ((pkg, pair) in snap) {
                    try {
                        val m = Arguments.createMap()
                        m.putInt("opens", pair.first)
                        m.putInt("minutes", pair.second)
                        out.putMap(pkg, m)
                    } catch (_: Exception) {
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "getBudgetUsage snapshot failed", e)
            }
            promise.resolve(out)
        } catch (e: Exception) {
            Log.e(TAG, "getBudgetUsage failed", e)
            try {
                promise.reject("GET_BUDGET_USAGE_FAILED", e.message, e)
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Push browser-level blocked domains ([String], already lowercased by
     * JS). Empties and values with no dot are dropped (store + TS bridge
     * filter first; this is the native backstop). Empty list clears. Never
     * throws.
     */
    @ReactMethod
    fun setBlockedDomains(domains: ReadableArray?, promise: Promise) {
        try {
            val set = mutableSetOf<String>()
            try {
                if (domains != null) {
                    for (i in 0 until domains.size()) {
                        try {
                            if (domains.getType(i) != ReadableType.String) continue
                            val d = domains.getString(i)?.trim()?.lowercase(java.util.Locale.ROOT).orEmpty()
                            if (d.isNotEmpty() && d.contains('.')) set.add(d)
                        } catch (_: Exception) {
                        }
                    }
                }
            } catch (_: Exception) {
            }
            StayTAccessibilityService.setDomainSet(set)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setBlockedDomains failed", e)
            try {
                promise.reject("SET_DOMAINS_FAILED", e.message, e)
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Push per-app feed-hardening flags: [{packageName, hideReels,
     * hideExplore, hideComments, enabled}]. Missing flags fall back to the
     * creation-site defaults (reels true, explore true, comments false,
     * enabled true). Never throws.
     */
    @ReactMethod
    fun setFeedFilters(filters: ReadableArray?, promise: Promise) {
        try {
            val rules = mutableListOf<StayTAccessibilityService.FeedRule>()
            try {
                if (filters != null) {
                    for (i in 0 until filters.size()) {
                        try {
                            if (filters.getType(i) != ReadableType.Map) continue
                            val m = filters.getMap(i) ?: continue
                            val pkg = try {
                                if (m.hasKey("packageName") && m.getType("packageName") == ReadableType.String) m.getString("packageName") else null
                            } catch (_: Exception) {
                                null
                            } ?: continue
                            if (pkg.isBlank()) continue
                            rules.add(
                                StayTAccessibilityService.FeedRule(
                                    pkg,
                                    readBool(m, "hideReels", true),
                                    readBool(m, "hideExplore", true),
                                    readBool(m, "hideComments", false),
                                    readBool(m, "enabled", true)
                                )
                            )
                        } catch (_: Exception) {
                        }
                    }
                }
            } catch (_: Exception) {
            }
            StayTAccessibilityService.setFeedRuleList(rules)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "setFeedFilters failed", e)
            try {
                promise.reject("SET_FEED_FILTERS_FAILED", e.message, e)
            } catch (_: Exception) {
            }
        }
    }

    /**
     * OEM battery-optimization onboarding: try manufacturer autostart /
     * battery pages first (Build.MANUFACTURER, each explicit component
     * guarded by a resolveActivity check + try/catch), then the AOSP
     * battery-optimization list (needs NO permission — only the
     * REQUEST_IGNORE variant needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
     * which we deliberately do not declare), then the app-details page.
     * Resolves true when a page was launched. Never throws. No new
     * permissions, no manifest change.
     */
    @ReactMethod
    fun openManufacturerSettings(promise: Promise) {
        try {
            val launched = try {
                launchOemSettings()
            } catch (e: Exception) {
                Log.w(TAG, "openManufacturerSettings failed", e)
                false
            }
            promise.resolve(launched)
        } catch (e: Exception) {
            Log.e(TAG, "openManufacturerSettings outer failed", e)
        }
    }

    @Suppress("DEPRECATION")
    private fun launchOemSettings(): Boolean {
        val ctx = reactApplicationContext
        val pm = try {
            ctx.packageManager
        } catch (_: Exception) {
            return false
        }
        val manufacturer = try {
            Build.MANUFACTURER?.lowercase(java.util.Locale.ROOT).orEmpty()
        } catch (_: Exception) {
            ""
        }
        val candidates = mutableListOf<Intent>()
        try {
            when {
                manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> {
                    candidates.add(Intent().setClassName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
                    candidates.add(Intent().setClassName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
                }
                manufacturer.contains("huawei") || manufacturer.contains("honor") -> {
                    candidates.add(Intent().setClassName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"))
                    candidates.add(Intent().setClassName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"))
                }
                manufacturer.contains("oppo") || manufacturer.contains("realme") -> {
                    candidates.add(Intent().setClassName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"))
                    candidates.add(Intent().setClassName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"))
                    candidates.add(Intent().setClassName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"))
                }
                manufacturer.contains("oneplus") -> {
                    candidates.add(Intent().setClassName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"))
                    candidates.add(Intent().setClassName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"))
                }
                manufacturer.contains("vivo") || manufacturer.contains("iqoo") -> {
                    candidates.add(Intent().setClassName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"))
                    candidates.add(Intent().setClassName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"))
                    candidates.add(Intent().setClassName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"))
                }
                manufacturer.contains("samsung") -> {
                    candidates.add(Intent().setClassName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"))
                }
                manufacturer.contains("asus") -> {
                    candidates.add(Intent().setClassName("com.asus.mobilemanager", "com.asus.mobilemanager.powersaver.PowerSaverSettings"))
                }
            }
        } catch (_: Exception) {
        }
        try {
            candidates.add(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            candidates.add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)))
        } catch (_: Exception) {
        }
        for (intent in candidates) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                val resolved = try {
                    intent.resolveActivity(pm) != null
                } catch (_: Exception) {
                    false
                }
                if (!resolved) continue
                ctx.startActivity(intent)
                return true
            } catch (_: Exception) {
            }
        }
        return false
    }

    /** Defensive boolean read with a default for bridge maps. Never throws. */
    private fun readBool(m: ReadableMap, key: String, def: Boolean): Boolean {
        return try {
            if (m.hasKey(key) && m.getType(key) == ReadableType.Boolean) m.getBoolean(key) else def
        } catch (_: Exception) {
            def
        }
    }

    /**
     * Program native focus-schedule alarms. Persists a mirror of the last pushed
     * list (source of truth stays the JS store; JS re-pushes after every edit),
     * cancels all previous alarms and programs the next START/STOP firings.
     * Skips malformed items; rejects only on total failure; never throws.
     */
    @ReactMethod
    fun setSchedules(schedules: ReadableArray, promise: Promise) {
        try {
            try {
                val parsed = ScheduleAlarmScheduler.parseArray(schedules)
                ScheduleAlarmScheduler.saveAndProgram(reactApplicationContext, parsed)
                Log.d(TAG, "setSchedules ok: ${parsed.size} valid items")
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "setSchedules failed", e)
                try {
                    promise.reject("SET_SCHEDULES_FAILED", e.message, e)
                } catch (_: Exception) {
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "setSchedules outer failed", e)
        }
    }

    /**
     * P2-1 widget prefs mirror push (JS: syncWidgetNow on session start/end,
     * override consume, and Pro grant). Persists the snapshot the widget/tile
     * read with the app dead, (re)programs the midnight rollover, and
     * refreshes the widget. Skips malformed items; rejects only on total
     * failure; never throws.
     *
     * Backwards compat: the 8-arg form (pre-mascotMood shells) is kept and
     * delegates with mood=null (WidgetData.save keeps the previous mood).
     * New JS sends the 9-arg form with mascotMood ('bright'|'steady'|
     * 'wilted', '' = keep previous). RN resolves the overload by arity.
     */
    @ReactMethod
    fun syncWidgetData(
        todayFocusMin: Double,
        streak: Double,
        subscribed: Boolean,
        lastPackages: ReadableArray?,
        sessionActive: Boolean,
        strictActive: Boolean,
        activeTaskName: String?,
        giveInsToday: Double,
        promise: Promise
    ) {
        syncWidgetDataInternal(
            todayFocusMin, streak, subscribed, lastPackages,
            sessionActive, strictActive, activeTaskName, giveInsToday,
            null, promise
        )
    }

    @ReactMethod
    fun syncWidgetData(
        todayFocusMin: Double,
        streak: Double,
        subscribed: Boolean,
        lastPackages: ReadableArray?,
        sessionActive: Boolean,
        strictActive: Boolean,
        activeTaskName: String?,
        giveInsToday: Double,
        mascotMood: String?,
        promise: Promise
    ) {
        syncWidgetDataInternal(
            todayFocusMin, streak, subscribed, lastPackages,
            sessionActive, strictActive, activeTaskName, giveInsToday,
            mascotMood, promise
        )
    }

    private fun syncWidgetDataInternal(
        todayFocusMin: Double,
        streak: Double,
        subscribed: Boolean,
        lastPackages: ReadableArray?,
        sessionActive: Boolean,
        strictActive: Boolean,
        activeTaskName: String?,
        giveInsToday: Double,
        mascotMood: String?,
        promise: Promise
    ) {
        try {
            val pkgs = mutableListOf<String>()
            try {
                if (lastPackages != null) {
                    for (i in 0 until lastPackages.size()) {
                        try {
                            val p = lastPackages.getString(i)
                            if (!p.isNullOrBlank()) pkgs.add(p)
                        } catch (_: Exception) {
                        }
                    }
                }
            } catch (_: Exception) {
            }
            WidgetData.save(
                reactApplicationContext,
                todayFocusMin.toInt(),
                streak.toInt(),
                subscribed,
                pkgs,
                sessionActive,
                strictActive,
                activeTaskName,
                try {
                    maxOf(0, giveInsToday.toInt())
                } catch (_: Exception) {
                    0
                },
                mascotMood
            )
            WidgetData.programMidnightAlarm(reactApplicationContext)
            try {
                StayTWidgetProvider.refreshAll(reactApplicationContext)
            } catch (e: Exception) {
                Log.w(TAG, "widget refresh failed", e)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "syncWidgetData failed", e)
            try {
                promise.reject("SYNC_WIDGET_FAILED", e.message, e)
            } catch (_: Exception) {
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for NativeEventEmitter
    }
    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for NativeEventEmitter
    }

    override fun invalidate() {
        instance = null
        super.invalidate()
    }

    /**
     * Render a launchable app's icon to a 48px PNG Base64 string (no-wrap).
     * Returns "" on ANY failure — a single bad icon must never fail the list.
     */
    private fun loadIconBase64(packageName: String): String {
        try {
            val pm = reactApplicationContext.packageManager
            val drawable = pm.getApplicationIcon(packageName)
            // Draw large first (adaptive icons scale cleanly), then downscale to 48px.
            val src = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(src)
            drawable.setBounds(0, 0, 192, 192)
            drawable.draw(canvas)
            val small = Bitmap.createScaledBitmap(src, 48, 48, true)
            src.recycle()
            val out = ByteArrayOutputStream()
            small.compress(Bitmap.CompressFormat.PNG, 100, out)
            small.recycle()
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.w(TAG, "icon load failed for $packageName", e)
            return ""
        }
    }

    private fun emitToJS(packageName: String, timestamp: Long, appLabel: String) {
        // The service outlives the JS runtime (app swiped away / process
        // restart): emitting into a dead catalyst instance throws and would
        // kill the whole app process from onAccessibilityEvent. Never throw.
        try {
            val params = Arguments.createMap().apply {
                putString("packageName", packageName)
                putDouble("timestamp", timestamp.toDouble())
                putString("appLabel", appLabel)
            }
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onBlockedAttempt", params)
        } catch (e: Exception) {
            Log.w(TAG, "emitToJS failed (JS runtime gone?) for $packageName", e)
        }
    }
}
