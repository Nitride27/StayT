package com.nitridee.staytapp.blocker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.nitridee.staytapp.R
import java.util.concurrent.ConcurrentHashMap

class StayTAccessibilityService : AccessibilityService() {
    // Rule models live at class level (not in companion): AppBlockerModule
    // addresses them as StayTAccessibilityService.BudgetRule/FeedRule, which
    // does not resolve through Companion.
    data class BudgetRule(
        val packageName: String,
        val kind: String,
        val limit: Int,
        val enabled: Boolean
    )

    data class FeedRule(
        val packageName: String,
        val hideReels: Boolean,
        val hideExplore: Boolean,
        val hideComments: Boolean,
        val enabled: Boolean
    )

    companion object {
        private const val TAG = "StayTAccessibility"
        private const val BLOCK_COOLDOWN_MS = 1000L
        private const val BLOCK_CHANNEL_ID = "stayt_blocked"
        private const val BLOCK_CHANNEL_NAME = "Blocked apps"
        private const val OVERLAY_TIMEOUT_MS = 30_000L
        private const val GREEN_ACCENT = "#58CC02"
        // BlockedContract mirror (src/native/blockedContract.ts): single
        // source for deep-link shape on the native side. Change both together.
        private const val BLOCKED_SCHEME = "exp+stayt-app"
        private const val BLOCKED_HOST = "blocked"
        private const val TASKS_PATH = "tasks"
        private const val KEY_PACKAGE = "packageName"
        private const val KEY_LABEL = "label"
        private const val TASKS_DEEP_LINK = "$BLOCKED_SCHEME://$TASKS_PATH"
        // Single Kotlin source for the paywall deep link (JS mirror:
        // src/native/blockedContract.ts PAYWALL_DEEP_LINK — keep in lockstep).
        // The QS tile references this const; do not hardcode the URI elsewhere.
        const val PAYWALL_DEEP_LINK = "$BLOCKED_SCHEME://paywall"

        private fun blockedDeepLink(openedPackage: String, appLabel: String) =
            Uri.parse(
                "$BLOCKED_SCHEME://$BLOCKED_HOST" +
                    "?$KEY_PACKAGE=${Uri.encode(openedPackage)}" +
                    "&$KEY_LABEL=${Uri.encode(appLabel)}"
            )

        var instance: StayTAccessibilityService? = null
            private set

        @Volatile
        private var isBlocking = false
        @Volatile
        private var blockingTaskName: String? = null
        private val blockedPackages: MutableSet<String> = ConcurrentHashMap.newKeySet()
        private val lastBlockedAt: MutableMap<String, Long> = ConcurrentHashMap()
        // Block-path caches: every block used to re-parse 3 typefaces from
        // assets and re-query PackageManager for the app label (asset I/O +
        // binder IPC on the event path = visible jank on repeat blocks).
        private val appLabelCache: MutableMap<String, String> = ConcurrentHashMap()
        private var overlayFonts: Triple<Typeface?, Typeface?, Typeface?>? = null

        /** Cached overlay typefaces (Anton, SpaceGrotesk-Bold, Inter). Never throws. */
        private fun overlayTypefaces(context: Context): Triple<Typeface?, Typeface?, Typeface?> {
            overlayFonts?.let { return it }
            val loaded = Triple(
                try { Typeface.createFromAsset(context.assets, "fonts/Anton-Regular.ttf") } catch (_: Exception) { null },
                try { Typeface.createFromAsset(context.assets, "fonts/SpaceGrotesk-Bold.ttf") } catch (_: Exception) { null },
                try { Typeface.createFromAsset(context.assets, "fonts/Inter-Regular.ttf") } catch (_: Exception) { null }
            )
            overlayFonts = loaded
            return loaded
        }

        /** Cached PackageManager label lookup. Never throws. */
        private fun appLabel(context: Context, openedPackage: String): String {
            appLabelCache[openedPackage]?.let { return it }
            val label = try {
                val info = context.packageManager.getApplicationInfo(openedPackage, 0)
                context.packageManager.getApplicationLabel(info).toString()
            } catch (_: Exception) {
                openedPackage
            }
            appLabelCache[openedPackage] = label
            return label
        }
        // N-1: posted block-notification IDs so stop/pause/destroy can cancel
        // them — no duplicates (same-package re-notify reuses its ID) and no
        // orphans lingering after blocking ends.
        private val postedNotificationIds: MutableSet<Int> = ConcurrentHashMap.newKeySet()
        private val handler = Handler(Looper.getMainLooper())
        @Volatile
        private var pauseRunnable: Runnable? = null

        // Native-M1 durable blocking intent: statics die with the process, so
        // the desired state survives in prefs and is re-armed on connect.
        private const val STATE_PREFS = "stayt_blocking_state"
        private const val STATE_KEY_BLOCKING = "blocking"
        private const val STATE_KEY_PKGS = "pkgs"
        private const val STATE_KEY_AT = "at"
        private const val STATE_KEY_TASK = "task"
        // Allowlist durable intent: allowlist mode is null-vs-set distinct
        // (null = blocklist mode, non-null incl. empty = allowlist mode), so
        // the mode flag and the set persist side by side with the blocklist.
        private const val STATE_KEY_ALLOW_MODE = "allowlist_mode"
        private const val STATE_KEY_ALLOW_PKGS = "allowlist_pkgs"

        // Allowlist SAFELIST: never blocked while allowlist mode is active,
        // even when not listed. Own package is handled by the existing
        // early return above; everything here is a system surface the user
        // must always reach (launcher/phone/systemui + Settings as the
        // accessibility kill-switch — blocking Settings could trap the user
        // out of the very toggle that disables this service).
        private val SAFELIST_EXACT: Set<String> = setOf(
            "com.google.android.apps.nexuslauncher",
            "com.sec.android.app.launcher",
            "com.miui.home",
            "com.huawei.android.launcher",
            "com.oppo.launcher",
            "com.vivo.launcher",
            "com.oneplus.launcher",
            "com.android.dialer",
            "com.google.android.dialer",
            "com.android.server.telecom",
            "com.android.systemui",
            "com.android.settings"
        )
        private val SAFELIST_PREFIXES: List<String> = listOf(
            "com.android.launcher"
        )

        @Volatile
        private var allowlistMode = false
        private val allowlistPackages: MutableSet<String> = ConcurrentHashMap.newKeySet()

        /** Never throws. True when [pkg] is a system surface allowlist mode must not block. */
        private fun isSafelist(pkg: String): Boolean {
            try {
                if (SAFELIST_EXACT.contains(pkg)) return true
                for (prefix in SAFELIST_PREFIXES) {
                    if (pkg == prefix || pkg.startsWith("$prefix.")) return true
                }
                return false
            } catch (_: Exception) {
                return false
            }
        }

        // Friction state (persisted; re-armed on connect like blockedPackages).
        private const val FRIC_PREFS = "stayt_friction"
        private const val FRIC_KEY_ENABLED = "enabled"
        private const val FRIC_KEY_DELAY = "delay_sec"
        private const val FRIC_KEY_ESCALATE = "escalate"
        private const val FRIC_KEY_DATE = "date"
        private const val FRIC_KEY_COUNTS = "counts_json"
        // Escalation step per prior open, hard cap on the escalated bonus,
        // and the overlay-timeout backstop: the breath countdown must always
        // finish before the 30s overlay auto-dismiss fires.
        private const val FRICTION_ESCALATE_STEP_SEC = 15L
        private const val FRICTION_ESCALATE_CAP_SEC = 90L
        private const val FRICTION_COUNTDOWN_CAP_MS = 25_000L

        @Volatile
        private var frictionEnabled = false
        @Volatile
        private var frictionDelaySec = 0.0
        @Volatile
        private var frictionEscalate = false
        private val frictionCounts: MutableMap<String, Int> = ConcurrentHashMap()
        @Volatile
        private var frictionDate: String = ""

        // Budget state. Rules are JS-owned (pushed via setBudgets); usage is
        // service-owned ({opens, ms} per pkg, rolled over daily, pruned to
        // budgeted pkgs so the map cannot grow unbounded).
        private const val BUDGET_PREFS = "stayt_budgets"
        private const val BUDGET_KEY_DATE = "date"
        private const val BUDGET_KEY_RULES = "rules_json"
        private const val BUDGET_KEY_USAGE = "usage_json"

        // CopyOnWrite: iterated on every accessibility event, rewritten only
        // on bridge pushes — synchronizedList would need manual sync for
        // iteration and could throw CME mid-event (caught, but drops metering).
        private val budgetRules: MutableList<BudgetRule> = java.util.concurrent.CopyOnWriteArrayList()
        private data class Usage(var opens: Int = 0, var ms: Long = 0L)
        private val budgetUsage: MutableMap<String, Usage> = ConcurrentHashMap()
        @Volatile
        private var budgetDate: String = ""
        // Minutes meter: last foreground pkg + timestamp, blocking-active only.
        @Volatile
        private var lastFgPkg: String? = null
        @Volatile
        private var lastFgAt: Long = 0L

        // Blocked web domains (lowercased, persisted) + feed-shield filters.
        private const val DOMAIN_PREFS = "stayt_domains"
        private const val DOMAIN_KEY_SET = "domains"
        private val blockedDomains: MutableSet<String> = ConcurrentHashMap.newKeySet()

        private const val FEED_PREFS = "stayt_feed_filters"
        private const val FEED_KEY_JSON = "filters_json"

        // CopyOnWrite: same iteration-vs-write profile as budgetRules above.
        private val feedRules: MutableList<FeedRule> = java.util.concurrent.CopyOnWriteArrayList()
        private val lastFeedBackAt: MutableMap<String, Long> = ConcurrentHashMap()
        private const val FEED_BACK_COOLDOWN_MS = 10_000L

        /** yyyy-MM-dd day key shared by friction + budget rollover. Never throws. */
        private fun dayKey(now: Long = System.currentTimeMillis()): String {
            return try {
                java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                    .format(java.util.Date(now))
            } catch (_: Exception) {
                ""
            }
        }

        /** M4: shared Settings.Secure check — bridge + tile use this one seam. */
        fun isServiceEnabled(context: Context): Boolean {
            try {
                val enabled = Settings.Secure.getString(
                    context.contentResolver,
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
                ) ?: ""
                val component =
                    "${context.packageName}/com.nitridee.staytapp.blocker.StayTAccessibilityService"
                return enabled.contains(component)
            } catch (e: Exception) {
                Log.w(TAG, "isServiceEnabled failed", e)
                return false
            }
        }

        /** Native-M3: single POST_NOTIFICATIONS seam for every block-channel post. */
        fun canPostNotifications(context: Context): Boolean {
            try {
                if (Build.VERSION.SDK_INT >= 33) {
                    return context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") ==
                        PackageManager.PERMISSION_GRANTED
                }
                return true
            } catch (e: Exception) {
                Log.w(TAG, "canPostNotifications failed", e)
                return false
            }
        }

        /** P2-2 tile reads blocking state with the app dead. */
        fun isBlockingNow(): Boolean = isBlocking

        private fun persistDesiredState(context: Context?, blocking: Boolean, blocked: List<String>, taskName: String? = null) {
            try {
                if (context == null) return
                val clean = blocked.filter { it.isNotBlank() }.distinct()
                context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(STATE_KEY_BLOCKING, blocking && clean.isNotEmpty())
                    .putStringSet(STATE_KEY_PKGS, clean.toSet())
                    .putLong(STATE_KEY_AT, System.currentTimeMillis())
                    .putString(STATE_KEY_TASK, if (blocking) taskName else null)
                    .putBoolean(STATE_KEY_ALLOW_MODE, allowlistMode)
                    .putStringSet(STATE_KEY_ALLOW_PKGS, allowlistPackages.toSet())
                    .apply()
            } catch (e: Exception) {
                Log.w(TAG, "persistDesiredState failed", e)
            }
        }

        /**
         * [allowlist] null = preserve the current allowlist state (tile,
         * schedules, and receivers use the default, so they toggle the
         * blocking flag only and the allowlist survives in prefs). Non-null
         * (including empty = block-all-except-safelist) switches allowlist
         * mode on with that set. The bridge clears back to blocklist mode
         * via [clearAllowlist] when JS passes allowlist:null.
         */
        fun setBlocking(blocking: Boolean, blocked: List<String> = emptyList(), taskName: String? = null, allowlist: List<String>? = null) {
            isBlocking = blocking
            blockingTaskName = if (blocking) taskName?.takeIf { it.isNotBlank() }?.take(128) else null
            // Defense in depth (bridge already cleans): drop blanks/oversize
            // and cap size so the durable prefs mirror can't bloat unbounded.
            val cleanBlocked = try {
                blocked.asSequence().filter { it.isNotBlank() && it.length <= 256 }.distinct().take(1000).toList()
            } catch (_: Exception) {
                emptyList()
            }
            blockedPackages.clear()
            blockedPackages.addAll(cleanBlocked)
            if (allowlist != null) {
                try {
                    allowlistMode = true
                    allowlistPackages.clear()
                    allowlistPackages.addAll(allowlist.asSequence().filter { it.isNotBlank() && it.length <= 256 }.distinct().take(1000).toList())
                } catch (e: Exception) {
                    Log.w(TAG, "allowlist apply failed", e)
                }
            }
            persistDesiredState(instance, blocking, blocked, blockingTaskName)
            // A (re)start or stop invalidates a scheduled pause-resume —
            // otherwise ending a session mid-override re-enables blocking
            // later with no session (phantom blocks).
            pauseRunnable?.let { handler.removeCallbacks(it) }
            pauseRunnable = null
            if (!blocking) cancelBlockNotifications()
            // A (re)start or stop invalidates any overlay from a previous session.
            try {
                instance?.dismissBlockedOverlay()
            } catch (e: Exception) {
                Log.w(TAG, "overlay dismiss on setBlocking failed", e)
            }
        }

        fun pauseBlocking(seconds: Long) {
            // Service-side backstop (bridge already clamps): a raw caller can
            // never park blocking off beyond 60 min via one call.
            val s = seconds.coerceIn(0L, 3600L)
            Log.d(TAG, "Pausing blocking for $s seconds")
            isBlocking = false
            // Fail-closed: the durable intent keeps the last setBlocking(true),
            // so a process death mid-break re-arms blocking on reconnect.
            // The break/override tray note would lie ("tap to return") while
            // the user is legitimately inside the app — drop it.
            cancelBlockNotifications()

            // An override (native overlay button or JS interstitial) ends the
            // blocked context the overlay represents — drop it if still up.
            try {
                instance?.dismissBlockedOverlay()
            } catch (e: Exception) {
                Log.w(TAG, "overlay dismiss on pause failed", e)
            }

            // Cancel any existing pause
            pauseRunnable?.let { handler.removeCallbacks(it) }

            // Resume after delay
            pauseRunnable = Runnable {
                isBlocking = true
                Log.d(TAG, "Blocking resumed after pause")
            }
            handler.postDelayed(pauseRunnable!!, s * 1000)
        }

        /** N-1: cancel every posted block note we know about. Never throws. */
        fun cancelBlockNotifications() {
            try {
                instance?.cancelAllBlockNotes()
            } catch (e: Exception) {
                Log.w(TAG, "cancelBlockNotifications failed", e)
            }
        }

        /**
         * Single-surface rule: the JS interstitial dismisses the native
         * overlay on mount, so a notification tap / overlay BACK deep link /
         * late BAL foreground never stacks both block screens at once.
         * No-op when no overlay is showing. Never throws.
         */
        fun dismissOverlay() {
            try {
                instance?.dismissBlockedOverlay()
            } catch (e: Exception) {
                Log.w(TAG, "dismissOverlay failed", e)
            }
        }

        /** Bridge blocklist mode: drop allowlist state, keep the blocklist. Never throws. */
        fun clearAllowlist() {
            try {
                allowlistMode = false
                allowlistPackages.clear()
                persistDesiredState(instance, isBlocking, blockedPackages.toList(), blockingTaskName)
                try {
                    instance?.dismissBlockedOverlay()
                } catch (e: Exception) {
                    Log.w(TAG, "overlay dismiss on clearAllowlist failed", e)
                }
            } catch (e: Exception) {
                Log.w(TAG, "clearAllowlist failed", e)
            }
        }

        /** Pushed via AppBlocker.setFriction. Persisted; re-armed on connect. Never throws. */
        fun setFrictionConfig(enabled: Boolean, delaySec: Double, escalate: Boolean) {
            try {
                frictionEnabled = enabled
                frictionDelaySec = maxOf(0.0, delaySec)
                frictionEscalate = escalate
                try {
                    instance?.getSharedPreferences(FRIC_PREFS, Context.MODE_PRIVATE)
                        ?.edit()
                        ?.putBoolean(FRIC_KEY_ENABLED, frictionEnabled)
                        ?.putFloat(FRIC_KEY_DELAY, frictionDelaySec.toFloat())
                        ?.putBoolean(FRIC_KEY_ESCALATE, frictionEscalate)
                        ?.apply()
                } catch (e: Exception) {
                    Log.w(TAG, "friction persist failed", e)
                }
            } catch (e: Exception) {
                Log.w(TAG, "setFrictionConfig failed", e)
            }
        }

        private fun loadFriction(context: Context) {
            try {
                val prefs = context.getSharedPreferences(FRIC_PREFS, Context.MODE_PRIVATE)
                frictionEnabled = try { prefs.getBoolean(FRIC_KEY_ENABLED, false) } catch (_: Exception) { false }
                frictionDelaySec = try { maxOf(0.0, prefs.getFloat(FRIC_KEY_DELAY, 0f).toDouble()) } catch (_: Exception) { 0.0 }
                frictionEscalate = try { prefs.getBoolean(FRIC_KEY_ESCALATE, false) } catch (_: Exception) { false }
                val today = dayKey()
                frictionDate = today
                frictionCounts.clear()
                try {
                    val raw = prefs.getString(FRIC_KEY_COUNTS, null)
                    val stored = prefs.getString(FRIC_KEY_DATE, null)
                    if (raw != null && stored == today) {
                        val o = org.json.JSONObject(raw)
                        val keys = o.keys()
                        while (keys.hasNext()) {
                            try {
                                val k = keys.next()
                                if (k.isNotBlank()) frictionCounts[k] = maxOf(0, o.optInt(k, 0))
                            } catch (_: Exception) {
                            }
                        }
                    }
                } catch (_: Exception) {
                }
            } catch (e: Exception) {
                Log.w(TAG, "loadFriction failed", e)
            }
        }

        private fun persistFrictionCounts() {
            try {
                val ctx = instance ?: return
                val o = org.json.JSONObject()
                try {
                    for ((k, v) in frictionCounts) {
                        try { o.put(k, v) } catch (_: Exception) { }
                    }
                } catch (_: Exception) {
                }
                ctx.getSharedPreferences(FRIC_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(FRIC_KEY_DATE, frictionDate)
                    .putString(FRIC_KEY_COUNTS, o.toString())
                    .apply()
            } catch (e: Exception) {
                Log.w(TAG, "persistFrictionCounts failed", e)
            }
        }

        /** Rollover the per-pkg friction counters when the day flips. Never throws. */
        private fun rollFrictionIfStale(today: String) {
            try {
                if (frictionDate != today) {
                    frictionDate = today
                    frictionCounts.clear()
                    persistFrictionCounts()
                }
            } catch (e: Exception) {
                Log.w(TAG, "rollFrictionIfStale failed", e)
            }
        }

        /** Pushed via AppBlocker.setBudgets. Prunes usage to budgeted pkgs. Never throws. */
        fun setBudgetRules(rules: List<BudgetRule>) {
            try {
                val clean = rules.filter { it.packageName.isNotBlank() && (it.kind == "opens" || it.kind == "minutes") }
                budgetRules.clear()
                budgetRules.addAll(clean)
                try {
                    val ctx = instance
                    if (ctx != null) {
                        val arr = org.json.JSONArray()
                        for (r in clean) {
                            try {
                                arr.put(org.json.JSONObject()
                                    .put("pkg", r.packageName)
                                    .put("kind", r.kind)
                                    .put("limit", r.limit)
                                    .put("enabled", r.enabled))
                            } catch (_: Exception) {
                            }
                        }
                        ctx.getSharedPreferences(BUDGET_PREFS, Context.MODE_PRIVATE)
                            .edit()
                            .putString(BUDGET_KEY_RULES, arr.toString())
                            .apply()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "budget rules persist failed", e)
                }
                pruneBudgetUsage()
            } catch (e: Exception) {
                Log.w(TAG, "setBudgetRules failed", e)
            }
        }

        private fun loadBudgets(context: Context) {
            try {
                budgetRules.clear()
                try {
                    val raw = context.getSharedPreferences(BUDGET_PREFS, Context.MODE_PRIVATE)
                        .getString(BUDGET_KEY_RULES, null)
                    if (raw != null) {
                        val arr = org.json.JSONArray(raw)
                        for (i in 0 until arr.length()) {
                            try {
                                val o = arr.optJSONObject(i) ?: continue
                                val pkg = o.optString("pkg", "")
                                val kind = o.optString("kind", "")
                                if (pkg.isBlank() || (kind != "opens" && kind != "minutes")) continue
                                budgetRules.add(BudgetRule(pkg, kind, o.optInt("limit", 0), o.optBoolean("enabled", false)))
                            } catch (_: Exception) {
                            }
                        }
                    }
                } catch (_: Exception) {
                }
                val today = dayKey()
                budgetDate = today
                budgetUsage.clear()
                try {
                    val prefs = context.getSharedPreferences(BUDGET_PREFS, Context.MODE_PRIVATE)
                    val raw = prefs.getString(BUDGET_KEY_USAGE, null)
                    if (raw != null && prefs.getString(BUDGET_KEY_DATE, null) == today) {
                        val o = org.json.JSONObject(raw)
                        val keys = o.keys()
                        while (keys.hasNext()) {
                            try {
                                val k = keys.next()
                                val u = o.optJSONObject(k) ?: continue
                                if (k.isBlank()) continue
                                budgetUsage[k] = Usage(maxOf(0, u.optInt("o", 0)), maxOf(0L, u.optLong("ms", 0L)))
                            } catch (_: Exception) {
                            }
                        }
                    }
                } catch (_: Exception) {
                }
                pruneBudgetUsage()
            } catch (e: Exception) {
                Log.w(TAG, "loadBudgets failed", e)
            }
        }

        /** Rollover usage when the day flips. Never throws. */
        private fun rollBudgetsIfStale(today: String) {
            try {
                if (budgetDate != today) {
                    budgetDate = today
                    budgetUsage.clear()
                    persistBudgetUsage()
                }
            } catch (e: Exception) {
                Log.w(TAG, "rollBudgetsIfStale failed", e)
            }
        }

        /** Drop usage for pkgs with no budget rule (bounds map growth). Never throws. */
        private fun pruneBudgetUsage() {
            try {
                val wanted = budgetRules.map { it.packageName }.toSet()
                val it = budgetUsage.keys.iterator()
                while (it.hasNext()) {
                    try {
                        if (!wanted.contains(it.next())) it.remove()
                    } catch (_: Exception) {
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "pruneBudgetUsage failed", e)
            }
        }

        private fun persistBudgetUsage() {
            try {
                val ctx = instance ?: return
                val o = org.json.JSONObject()
                try {
                    for ((k, v) in budgetUsage) {
                        try { o.put(k, org.json.JSONObject().put("o", v.opens).put("ms", v.ms)) } catch (_: Exception) { }
                    }
                } catch (_: Exception) {
                }
                ctx.getSharedPreferences(BUDGET_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(BUDGET_KEY_DATE, budgetDate)
                    .putString(BUDGET_KEY_USAGE, o.toString())
                    .apply()
            } catch (e: Exception) {
                Log.w(TAG, "persistBudgetUsage failed", e)
            }
        }

        /**
         * Snapshot for AppBlocker.getBudgetUsage: package -> (opens, minutes)
         * for today. Never throws; empty map when nothing tracked.
         */
        fun budgetUsageSnapshot(context: Context?): Map<String, Pair<Int, Int>> {
            try {
                rollBudgetsIfStale(dayKey())
                val out = LinkedHashMap<String, Pair<Int, Int>>()
                for ((k, v) in budgetUsage) {
                    try {
                        out[k] = Pair(maxOf(0, v.opens), maxOf(0, (v.ms / 60_000L).toInt()))
                    } catch (_: Exception) {
                    }
                }
                return out
            } catch (e: Exception) {
                Log.w(TAG, "budgetUsageSnapshot failed", e)
                return emptyMap()
            }
        }

        /** Pushed via AppBlocker.setBlockedDomains (already lowercased by JS). Never throws. */
        fun setDomainSet(domains: Set<String>) {
            try {
                blockedDomains.clear()
                // Third validation layer (store + bridge already drop
                // empties/invalid): skip blanks and values with no dot, so a
                // raw bridge caller can never persist an unmatchable entry.
                blockedDomains.addAll(domains
                    .filter { it.isNotBlank() }
                    .map { it.trim().lowercase(java.util.Locale.ROOT) }
                    .filter { it.contains('.') })
                try {
                    instance?.getSharedPreferences(DOMAIN_PREFS, Context.MODE_PRIVATE)
                        ?.edit()
                        ?.putStringSet(DOMAIN_KEY_SET, blockedDomains.toSet())
                        ?.apply()
                } catch (e: Exception) {
                    Log.w(TAG, "domain persist failed", e)
                }
            } catch (e: Exception) {
                Log.w(TAG, "setDomainSet failed", e)
            }
        }

        private fun loadDomains(context: Context) {
            try {
                blockedDomains.clear()
                val set = try {
                    context.getSharedPreferences(DOMAIN_PREFS, Context.MODE_PRIVATE)
                        .getStringSet(DOMAIN_KEY_SET, emptySet())
                } catch (_: Exception) {
                    emptySet()
                } ?: emptySet()
                blockedDomains.addAll(set.filter { it.isNotBlank() }.map { it.trim().lowercase(java.util.Locale.ROOT) })
            } catch (e: Exception) {
                Log.w(TAG, "loadDomains failed", e)
            }
        }

        /** Pushed via AppBlocker.setFeedFilters. Never throws. */
        fun setFeedRuleList(rules: List<FeedRule>) {
            try {
                val clean = rules.filter { it.packageName.isNotBlank() }
                feedRules.clear()
                feedRules.addAll(clean)
                try {
                    Log.d(TAG, "feed rules pushed: ${clean.size} pkgs, ${clean.count { it.enabled }} enabled")
                } catch (_: Exception) {
                }
                try {
                    val ctx = instance
                    if (ctx != null) {
                        val arr = org.json.JSONArray()
                        for (r in clean) {
                            try {
                                arr.put(org.json.JSONObject()
                                    .put("pkg", r.packageName)
                                    .put("reels", r.hideReels)
                                    .put("explore", r.hideExplore)
                                    .put("comments", r.hideComments)
                                    .put("enabled", r.enabled))
                            } catch (_: Exception) {
                            }
                        }
                        ctx.getSharedPreferences(FEED_PREFS, Context.MODE_PRIVATE)
                            .edit()
                            .putString(FEED_KEY_JSON, arr.toString())
                            .apply()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "feed persist failed", e)
                }
            } catch (e: Exception) {
                Log.w(TAG, "setFeedRuleList failed", e)
            }
        }

        private fun loadFeedRules(context: Context) {
            try {
                feedRules.clear()
                val raw = try {
                    context.getSharedPreferences(FEED_PREFS, Context.MODE_PRIVATE)
                        .getString(FEED_KEY_JSON, null)
                } catch (_: Exception) {
                    null
                } ?: return
                val arr = try { org.json.JSONArray(raw) } catch (_: Exception) { return }
                for (i in 0 until arr.length()) {
                    try {
                        val o = arr.optJSONObject(i) ?: continue
                        val pkg = o.optString("pkg", "")
                        if (pkg.isBlank()) continue
                        feedRules.add(FeedRule(pkg, o.optBoolean("reels", true), o.optBoolean("explore", true), o.optBoolean("comments", false), o.optBoolean("enabled", true)))
                    } catch (_: Exception) {
                    }
                }
                try {
                    Log.d(TAG, "feed rules re-armed: ${feedRules.size} pkgs")
                } catch (_: Exception) {
                }
            } catch (e: Exception) {
                Log.w(TAG, "loadFeedRules failed", e)
            }
        }

        /**
         * Minutes meter: attribute min(60s, now - lastEvent) to the
         * previously-foreground pkg, minutes-kind budgeted pkgs only.
         * Called on every event while blocking; never throws.
         */
        fun trackForegroundMinutes(pkg: String, now: Long) {
            try {
                rollBudgetsIfStale(dayKey(now))
                val prev = lastFgPkg
                val prevAt = lastFgAt
                lastFgPkg = pkg
                lastFgAt = now
                if (prev == null || prev != pkg || prevAt <= 0L || now <= prevAt) return
                var wanted = false
                try {
                    for (r in budgetRules) {
                        if (r.packageName == prev && r.enabled && r.kind == "minutes" && r.limit > 0) {
                            wanted = true
                            break
                        }
                    }
                } catch (_: Exception) {
                    return
                }
                if (!wanted) return
                val delta = minOf(now - prevAt, 60_000L)
                if (delta <= 0L) return
                try {
                    val u = budgetUsage.getOrPut(prev) { Usage() }
                    u.ms += delta
                } catch (_: Exception) {
                    return
                }
                persistBudgetUsage()
            } catch (e: Exception) {
                Log.w(TAG, "trackForegroundMinutes failed", e)
            }
        }

        /**
         * Budget meter: counts this open for the getBudgetUsage telemetry
         * (opens/minutes per pkg, rolled over daily). Telemetry ONLY — it
         * never allows the open: hard blocks always win, so the caller takes
         * the normal block path unconditionally after this returns. The
         * increment happens on every qualifying open (post-cooldown), so the
         * counters stay exact. Never throws.
         */
        fun countBudgetOpen(pkg: String, today: String) {
            try {
                rollBudgetsIfStale(today)
                val wanted = try {
                    budgetRules.any { it.packageName == pkg && it.enabled && it.limit > 0 }
                } catch (_: Exception) {
                    return
                }
                if (!wanted) return
                try {
                    budgetUsage.getOrPut(pkg) { Usage() }.opens += 1
                } catch (_: Exception) {
                    return
                }
                persistBudgetUsage()
            } catch (e: Exception) {
                Log.w(TAG, "countBudgetOpen failed", e)
            }
        }

        /**
         * Friction countdown for this open in ms (0 = go straight to the
         * block path). Counts the open first; the escalation bonus uses
         * prior opens only (15s each, capped at 90s), and the total is
         * capped below the 30s overlay timeout so the countdown always wins
         * the race against the overlay auto-dismiss. Never throws.
         */
        fun frictionWaitFor(pkg: String, today: String): Long {
            try {
                if (!frictionEnabled) return 0L
                rollFrictionIfStale(today)
                val prior = try { frictionCounts[pkg] ?: 0 } catch (_: Exception) { 0 }
                try {
                    frictionCounts[pkg] = maxOf(0, prior) + 1
                } catch (_: Exception) {
                }
                persistFrictionCounts()
                if (frictionDelaySec <= 0.0) return 0L
                var totalMs = (frictionDelaySec * 1000.0).toLong()
                if (frictionEscalate && prior > 0) {
                    val bonusSec = minOf(FRICTION_ESCALATE_STEP_SEC * prior, FRICTION_ESCALATE_CAP_SEC)
                    totalMs += bonusSec * 1000L
                }
                if (totalMs <= 0L) return 0L
                return minOf(totalMs, FRICTION_COUNTDOWN_CAP_MS)
            } catch (e: Exception) {
                Log.w(TAG, "frictionWaitFor failed", e)
                return 0L
            }
        }

        /**
         * Best-effort blocked-domain match over lowercased event text.
         * Tokenizes on whitespace, strips scheme/www and path/query, then
         * matches host == domain or host ends with ".domain" (subdomains
         * included, lookalikes like notexample.com excluded). Returns the
         * matched domain or null. Never throws.
         */
        fun matchBlockedDomain(haystack: String): String? {
            try {
                if (haystack.isEmpty() || blockedDomains.isEmpty()) return null
                val domains = try { blockedDomains.toList() } catch (_: Exception) { return null }
                for (d in domains) {
                    try {
                        if (d.isEmpty()) continue
                        val tokens = haystack.split(' ', '\n', '\t', '\r')
                        for (raw in tokens) {
                            try {
                                var t = raw.trim().trim('.', ',', ';', ':', '"', '\'', '(', ')', '[', ']', '!', '?')
                                if (t.isEmpty() || !t.contains(d)) continue
                                t = t.removePrefix("http://").removePrefix("https://").removePrefix("www.")
                                val host = t.split('/', '?', '#')[0].trimEnd('.')
                                if (host == d || host.endsWith(".$d")) return d
                            } catch (_: Exception) {
                            }
                        }
                    } catch (_: Exception) {
                    }
                }
                return null
            } catch (e: Exception) {
                Log.w(TAG, "matchBlockedDomain failed", e)
                return null
            }
        }
    }

    @Volatile
    private var overlayView: View? = null
    @Volatile
    private var overlayBlockedPackage: String? = null
    private val overlayHandler = Handler(Looper.getMainLooper())
    private var overlayTimeoutRunnable: Runnable? = null
    // Friction breath overlay: countdown text + tick loop. Both are owned
    // by the overlay lifecycle — dismissBlockedOverlay() clears them, so a
    // countdown can never outlive (or re-fire after) its overlay, and the
    // 30s overlay timeout always backstops a stuck tick.
    private var breathCountdownView: TextView? = null
    private var countdownRunnable: Runnable? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "Accessibility service connected")

        // Channel for the Play-safe tap-to-return blocked notification.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                BLOCK_CHANNEL_ID,
                BLOCK_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            )
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }

        // N-1: a process death between post and cancel leaves a stale tray
        // note; a fresh connect means no block is in flight, so clear it.
        // Native-M2: tracked IDs are statics (lost on death), so also sweep
        // the whole block channel for orphans the tracker no longer knows.
        try {
            cancelAllBlockNotes()
        } catch (e: Exception) {
            Log.w(TAG, "stale notification cleanup failed", e)
        }
        try {
            cancelOrphanChannelNotes()
        } catch (e: Exception) {
            Log.w(TAG, "orphan channel sweep failed", e)
        }

        // Native-M1: statics reset on process death — re-arm the persisted
        // desired-blocking so schedules/sessions survive reboot/restart, the
        // way users expect. Leave off + log when nothing was persisted.
        try {
            val prefs = getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
            val wantBlocking = prefs.getBoolean(STATE_KEY_BLOCKING, false)
            val pkgs = try {
                prefs.getStringSet(STATE_KEY_PKGS, emptySet())?.filter { it.isNotBlank() }
                    ?: emptyList()
            } catch (_: Exception) {
                emptyList()
            }
            if (wantBlocking && pkgs.isNotEmpty()) {
                isBlocking = true
                blockedPackages.clear()
                blockedPackages.addAll(pkgs)
                blockingTaskName = try {
                    prefs.getString(STATE_KEY_TASK, null)?.takeIf { it.isNotBlank() }
                } catch (_: Exception) {
                    null
                }
                Log.d(TAG, "re-armed blocking for ${pkgs.size} pkgs from durable intent")
            } else {
                Log.d(TAG, "no durable blocking intent; leaving blocking off")
            }
            // Durable allowlist: re-armed alongside the blocklist so the mode
            // survives process death exactly like blockedPackages does.
            try {
                allowlistMode = try { prefs.getBoolean(STATE_KEY_ALLOW_MODE, false) } catch (_: Exception) { false }
                allowlistPackages.clear()
                val allow = try {
                    prefs.getStringSet(STATE_KEY_ALLOW_PKGS, emptySet())?.filter { it.isNotBlank() }
                        ?: emptyList()
                } catch (_: Exception) {
                    emptyList()
                }
                allowlistPackages.addAll(allow)
                if (allowlistMode) Log.d(TAG, "re-armed allowlist mode with ${allow.size} pkgs")
            } catch (e: Exception) {
                Log.w(TAG, "allowlist re-arm failed", e)
            }
        } catch (e: Exception) {
            Log.w(TAG, "durable intent re-arm failed", e)
        }
        // Friction / budgets / domains / feed-shield: JS-owned config with a
        // prefs mirror, re-armed here so enforcement survives restart.
        try {
            loadFriction(this)
        } catch (e: Exception) {
            Log.w(TAG, "friction re-arm failed", e)
        }
        try {
            loadBudgets(this)
        } catch (e: Exception) {
            Log.w(TAG, "budget re-arm failed", e)
        }
        try {
            loadDomains(this)
        } catch (e: Exception) {
            Log.w(TAG, "domain re-arm failed", e)
        }
        try {
            loadFeedRules(this)
        } catch (e: Exception) {
            Log.w(TAG, "feed re-arm failed", e)
        }

        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 100
            // canRetrieveWindowContent lives in the XML config only: the
            // platform exposes a getter with no setter.
            flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                    AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val openedPackage = event.packageName?.toString() ?: return

        // Overlay lifecycle tracking: the BACK / SWITCH overlay buttons (or a
        // manual return) foreground StayT — the blocked context is over, so
        // drop the overlay. Runs BEFORE the isBlocking / own-package early
        // returns: an override pauses blocking while the overlay may still be
        // up, and the return-to-StayT event must still clear it.
        //
        // NOTE: we intentionally do NOT dismiss on *any* package change. The
        // HOME bounce kept below backgrounds the blocked app (launcher
        // foreground event) immediately after we show the overlay;
        // dismissing on that transition would flash-dismiss the overlay on
        // every block. Timeout + StayT-foreground + replace + pause/stop +
        // destroy cover the lifecycle deterministically.
        if (overlayView != null && openedPackage == packageName) {
            try {
                dismissBlockedOverlay()
            } catch (e: Exception) {
                Log.w(TAG, "overlay dismiss on return-to-StayT failed", e)
            }
        }

        if (!isBlocking) return

        // Allow our own package
        if (openedPackage == packageName) return

        val now = System.currentTimeMillis()

        // Budget minutes meter: attribute capped foreground time to the
        // previously-foreground pkg. We are past isBlocking, so this only
        // runs while blocking; only budgeted-minutes pkgs accumulate.
        try {
            trackForegroundMinutes(openedPackage, now)
        } catch (e: Exception) {
            Log.w(TAG, "minutes meter failed", e)
        }

        // Lowercased source text shared by the domain matcher + feed shield.
        // Best-effort: empty on any failure, which simply matches nothing.
        val haystack = try {
            event.text?.joinToString(" ") { it?.toString().orEmpty() }
                ?.lowercase(java.util.Locale.ROOT).orEmpty()
        } catch (_: Exception) {
            ""
        }

        // Blocked-target decision FIRST (hard block wins): blocklist mode =
        // membership (empty set = nothing blocked, as before). Allowlist mode
        // = everything not listed and not safelisted (empty allowlist =
        // block-all-except-safelist). A blocked-domain hit forces the block
        // path regardless of list membership.
        val domainHit = try {
            matchBlockedDomain(haystack)
        } catch (_: Exception) {
            null
        }
        val target = try {
            if (domainHit != null) {
                true
            } else if (allowlistMode) {
                !isSafelist(openedPackage) && !allowlistPackages.contains(openedPackage)
            } else {
                blockedPackages.isNotEmpty() && blockedPackages.contains(openedPackage)
            }
        } catch (_: Exception) {
            false
        }
        if (!target) {
            // Feed shield runs ONLY for allowed apps: it hardens feeds, it
            // never blocks. Skipped for block targets by design — a shield
            // BACK racing the block-path HOME bounce double-fires navigation
            // and reads as the blocked app crashing.
            try {
                maybeFeedShield(openedPackage, event, haystack, now)
            } catch (e: Exception) {
                Log.w(TAG, "feed shield failed for $openedPackage", e)
            }
            return
        }

        // Per-package cooldown: WINDOW_STATE_CHANGED fires in bursts.
        // Evaluated BEFORE any counting, so bursts inflate neither the
        // budget opens meter nor the friction escalation counter.
        // Order on a qualifying open: cooldown -> budget count (telemetry
        // only, never allows) -> friction -> HOME bounce + emit +
        // notification + overlay. Hard blocks always win.
        val last = lastBlockedAt[openedPackage] ?: 0L
        if (now - last < BLOCK_COOLDOWN_MS) return
        lastBlockedAt[openedPackage] = now

        // Block-path label + gates below; the HOME bounce runs after them
        // (a budget-allowed open must never be kicked to HOME).

        // Resolve the display label once — shared by emit, notification, deep link.
        val appLabel = appLabel(this, openedPackage)

        // Budget meter (list-based targets only — an explicit domain ban
        // skips it): counts this open for the getBudgetUsage telemetry.
        // Hard blocks always win — there is no silent-allow path: every
        // qualifying open continues to the HOME bounce + emit +
        // notification + overlay below, over or under budget.
        if (domainHit == null) {
            try {
                countBudgetOpen(openedPackage, dayKey(now))
            } catch (e: Exception) {
                Log.w(TAG, "budget meter failed for $openedPackage", e)
            }
        }

        // Friction: breath overlay + countdown, then the normal interstitial
        // path (same deep link BACK TO TASK uses — single consume path, no
        // bypass hole, no new budget logic). Strict tasks are unaffected:
        // friction only delays entry into the interstitial, which still
        // enforces strict on arrival.
        val frictionWaitMs = try {
            frictionWaitFor(openedPackage, dayKey(now))
        } catch (e: Exception) {
            Log.w(TAG, "friction calc failed for $openedPackage", e)
            0L
        }

        // Package is blocked - bounce to HOME. If the bounce is denied or
        // throttled, do NOT silently return: the overlay below swallows
        // touches and becomes the enforcement surface instead.
        // Every qualifying open bounces: the budget meter above counts
        // only and never exempts.
        //
        // Safe block pattern: at most ONE GLOBAL_ACTION_HOME per debounced
        // open. HOME only backgrounds the target process (it never kills or
        // crashes it); the overlay is the enforcement surface. A redundant
        // bounce while our own same-package overlay is already up would yank
        // the foreground on every cooldown window — which reads as the
        // blocked app crashing — so it is skipped.
        Log.d(TAG, "Blocked app: $openedPackage")
        val overlayEnforcing = overlayView != null && overlayBlockedPackage == openedPackage
        // Throwable (not just Exception): this service shares StayT's process,
        // so anything escaping here kills the whole app, not just the block.
        val bounced = if (overlayEnforcing) {
            true
        } else try {
            performGlobalAction(GLOBAL_ACTION_HOME)
        } catch (t: Throwable) {
            Log.w(TAG, "performGlobalAction threw for $openedPackage - overlay will enforce", t)
            false
        }
        if (!bounced) {
            Log.w(TAG, "performGlobalAction denied/throttled for $openedPackage - overlay will enforce")
            // Deliberately KEEP the per-package cooldown entry: the overlay
            // is enforcing, and dropping it would let the next burst of
            // window events re-enter immediately — re-counting budget opens
            // and friction, re-emitting to JS — instead of debouncing.
        }

        // Emit event to React Native (label travels with it — no per-block
        // app-list scan on the JS side).
        AppBlockerModule.emitBlockedAttempt(openedPackage, now, appLabel)

        // Play-safe v1: plain high-priority notification whose tap deep-links
        // back into StayT (label embedded — JS resolves taskId like App.tsx does).
        // No SYSTEM_ALERT_WINDOW, no full-screen intent.
        postBlockedNotification(openedPackage, appLabel)

        // Single-surface rule: the overlay below is the ONLY thing shown on
        // top of the blocked app. Do NOT auto-foreground StayT here — on
        // Samsung/OEMs the background start is BAL-denied (or lands late),
        // which stacked the overlay over a pushed interstitial: the same
        // block screen twice, once per app. The interstitial is still
        // reached via the overlay buttons (user tap = BAL-safe) or the
        // notification tap above. No new permissions.

        // Service-owned overlay (primary surface): a fullscreen window drawn
        // on top of whatever is foreground via TYPE_ACCESSIBILITY_OVERLAY —
        // no SYSTEM_ALERT_WINDOW, no full-screen intent, no new manifest
        // permissions. Survives the BAL/OEM denials that defeat the
        // startActivity ladder above. HOME bounce + notification stay as
        // fallbacks; every existing path above is untouched.
        //
        // Domain hits label the overlay with the matched domain; friction
        // shows the breath overlay first and foregrounds the interstitial
        // (same deep link BACK TO TASK uses) when its countdown ends.
        if (frictionWaitMs > 0L) {
            showBreathOverlay(openedPackage, appLabel, frictionWaitMs)
        } else if (domainHit != null) {
            showBlockedOverlay(openedPackage, domainHit)
        } else {
            showBlockedOverlay(openedPackage, appLabel)
        }
    }

    private fun postBlockedNotification(openedPackage: String, appLabel: String) {
        try {
            // Native-M3: one seam — silently skip when POST_NOTIFICATIONS
            // (API 33+) is not granted; the overlay + HOME bounce remain.
            if (!canPostNotifications(this)) return
            val deepLink = blockedDeepLink(openedPackage, appLabel)
            val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            val pending = PendingIntent.getActivity(
                this,
                openedPackage.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, BLOCK_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
                .setContentTitle("Blocked $appLabel")
                .setContentText("Tap to return to your task")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build()
            getSystemService(NotificationManager::class.java)
                ?.notify(openedPackage.hashCode(), notification)
            // N-1: track the ID so stop/pause/destroy/connect can cancel it.
            postedNotificationIds.add(openedPackage.hashCode())
        } catch (e: Exception) {
            Log.w(TAG, "postBlockedNotification failed for $openedPackage", e)
        }
    }

    /** Instance side of cancelBlockNotifications: cancel + forget. Idempotent. */
    private fun cancelAllBlockNotes() {
        try {
            val nm = getSystemService(NotificationManager::class.java) ?: return
            val ids = postedNotificationIds.toList()
            postedNotificationIds.clear()
            for (id in ids) {
                try {
                    nm.cancel(id)
                } catch (_: Exception) {
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "cancelAllBlockNotes failed", e)
        }
    }

    /**
     * Native-M2: sweep tray notes on our block channel that the tracked-ID
     * set no longer knows (statics are lost on process death). Active-
     * notification reads need no permission; never throws.
     */
    private fun cancelOrphanChannelNotes() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
            val nm = getSystemService(NotificationManager::class.java) ?: return
            val active = try {
                nm.activeNotifications
            } catch (_: Exception) {
                null
            } ?: return
            for (sb in active) {
                try {
                    if (sb.notification?.channelId == BLOCK_CHANNEL_ID) {
                        nm.cancel(sb.id)
                    }
                } catch (_: Exception) {
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "cancelOrphanChannelNotes failed", e)
        }
    }

    /**
     * Best-effort ladder rung: foreground MainActivity (singleTask) with the
     * blocked deep-link URI so a backgrounded StayT lands straight on the
     * interstitial. Resolves via the existing exp+stayt-app scheme
     * intent-filter on MainActivity — no new permissions, no overlay,
     * no full-screen intent. Must never throw: BAL denials (Android 10+,
     * OEM-specific) fall back to the tap notification posted above.
     *
     * Exact URI fired:
     * exp+stayt-app://blocked?packageName=<encoded>&label=<encoded>
     */
    private fun foregroundBlockedInterstitial(openedPackage: String, appLabel: String) {
        try {
            val deepLink = blockedDeepLink(openedPackage, appLabel)
            val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            startActivity(intent)
            Log.d(TAG, "Requested foreground interstitial for $openedPackage")
        } catch (t: Throwable) {
            Log.w(TAG, "Background activity launch blocked for $openedPackage; notification remains the fallback", t)
        }
    }

    /**
     * Foreground StayT on the task picker for the overlay's SWITCH TASK
     * button. Same BAL best-effort semantics as
     * [foregroundBlockedInterstitial] — never throws; the overlay is already
     * dismissed by the caller before this fires.
     *
     * Exact URI fired: exp+stayt-app://tasks
     * (lands on TaskPicker — App.tsx handler owned by orchestrator).
     */
    private fun foregroundTaskPicker() {
        try {
            val deepLink = Uri.parse(TASKS_DEEP_LINK)
            val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            startActivity(intent)
            Log.d(TAG, "Requested foreground task picker")
        } catch (t: Throwable) {
            Log.w(TAG, "Background activity launch blocked for task picker; notification remains the fallback", t)
        }
    }

    /**
     * Feed shield: when the event text contains an enabled keyword for this
     * pkg (reels/explore/comments mapped from the three toggles), press BACK
     * once per pkg per 10s. Skipped when the focused node is an EditText so
     * typing is never hijacked. Caller runs this for allowed apps only (hard
     * block wins — see onAccessibilityEvent). Best-effort: never blocks,
     * never throws.
     */
    private fun maybeFeedShield(openedPackage: String, event: AccessibilityEvent, haystack: String, now: Long) {
        try {
            if (haystack.isEmpty()) return
            val keywords = try {
                val kws = mutableListOf<String>()
                for (r in feedRules) {
                    try {
                        if (r.packageName == openedPackage && r.enabled) {
                            if (r.hideReels) kws.add("reels")
                            if (r.hideExplore) kws.add("explore")
                            if (r.hideComments) kws.add("comments")
                            break
                        }
                    } catch (_: Exception) {
                    }
                }
                kws
            } catch (_: Exception) {
                return
            }
            if (keywords.isEmpty()) return
            var hit = false
            try {
                for (k in keywords) {
                    if (haystack.contains(k)) {
                        hit = true
                        break
                    }
                }
            } catch (_: Exception) {
                return
            }
            if (!hit) return
            // Never hijack typing: bail when the event source is an EditText.
            // getSource() needs canRetrieveWindowContent (set in XML + code);
            // without it the source is null and the shield stays active.
            var src: AccessibilityNodeInfo? = null
            try {
                src = try { event.source } catch (_: Exception) { null }
                val cls = try { src?.className?.toString() } catch (_: Exception) { null }
                if (cls == "android.widget.EditText") {
                    Log.d(TAG, "feed shield skipped (typing) in $openedPackage")
                    return
                }
            } catch (_: Exception) {
            } finally {
                try { src?.recycle() } catch (_: Exception) { }
            }
            // BACK-loop guard: at most one BACK per pkg per 10s, so a shield
            // BACK can never fight the user (or the block bounce) in a loop.
            val lastBack = try { lastFeedBackAt[openedPackage] ?: 0L } catch (_: Exception) { 0L }
            if (now - lastBack < FEED_BACK_COOLDOWN_MS) return
            try {
                lastFeedBackAt[openedPackage] = now
            } catch (_: Exception) {
            }
            try {
                val ok = performGlobalAction(GLOBAL_ACTION_BACK)
                Log.d(TAG, "feed shield BACK in $openedPackage -> $ok")
            } catch (t: Throwable) {
                Log.w(TAG, "feed shield BACK threw in $openedPackage", t)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "maybeFeedShield failed for $openedPackage", t)
        }
    }

    /**
     * Show the fullscreen block overlay for [openedPackage]. Single instance:
     * any existing overlay is removed first, never stacked. Auto-dismisses
     * after 30s via [overlayHandler]. Must never throw — when the overlay
     * cannot show (old API, no WindowManager, OEM-denied window), fall back
     * to foregrounding the interstitial so the block still lands on a StayT
     * surface instead of a bare HOME bounce that reads as the blocked app
     * crashing. The foreground only fires when no overlay is up, so the
     * single-surface rule holds.
     */
    private fun showBlockedOverlay(openedPackage: String, appLabel: String) {
        var shown = false
        // Same block surface already up (reopen after cooldown, event burst):
        // rebuilding the hierarchy flickers + janks — just re-arm the 30s
        // timeout. Dismiss/replace still applies across packages.
        if (overlayView != null && overlayBlockedPackage == openedPackage) {
            armOverlayTimeout()
            return
        }
        try {
            // Single instance: replace, never stack.
            dismissBlockedOverlay()
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                Log.w(TAG, "overlay skipped for $openedPackage: TYPE_ACCESSIBILITY_OVERLAY needs API 26+")
            } else {
                val wm = getSystemService(WINDOW_SERVICE) as? WindowManager
                if (wm == null) {
                    Log.w(TAG, "overlay skipped for $openedPackage: no WindowManager")
                } else {
                    val root = try {
                        buildOverlayView(openedPackage, appLabel)
                    } catch (e: Exception) {
                        Log.w(TAG, "buildOverlayView failed for $openedPackage", e)
                        null
                    }
                    if (root != null) {
                        val params = WindowManager.LayoutParams(
                            WindowManager.LayoutParams.MATCH_PARENT,
                            WindowManager.LayoutParams.MATCH_PARENT,
                            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                            PixelFormat.TRANSLUCENT
                        ).apply {
                            gravity = Gravity.TOP
                        }
                        wm.addView(root, params)
                        overlayView = root
                        overlayBlockedPackage = openedPackage
                        armOverlayTimeout()
                        shown = true
                        Log.d(TAG, "Overlay shown for $openedPackage")
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "showBlockedOverlay failed for $openedPackage", e)
            try {
                dismissBlockedOverlay()
            } catch (_: Exception) {
            }
        }
        if (!shown) {
            try {
                foregroundBlockedInterstitial(openedPackage, appLabel)
            } catch (e: Exception) {
                Log.w(TAG, "overlay fallback foreground failed for $openedPackage", e)
            }
        }
    }

    /**
     * (Re)arm the 30s overlay auto-dismiss. Previous timeout, if any, is
     * dropped first — safe to call on every block for the same package.
     */
    private fun armOverlayTimeout() {
        try {
            overlayTimeoutRunnable?.let { overlayHandler.removeCallbacks(it) }
            overlayTimeoutRunnable = Runnable {
                try {
                    dismissBlockedOverlay()
                } catch (e: Exception) {
                    Log.w(TAG, "overlay timeout dismiss failed", e)
                }
            }
            overlayHandler.postDelayed(overlayTimeoutRunnable!!, OVERLAY_TIMEOUT_MS)
        } catch (e: Exception) {
            Log.w(TAG, "armOverlayTimeout failed", e)
        }
    }

    /**
     * Remove the overlay if present and cancel its 30s timeout. Idempotent —
     * safe to call when no overlay is showing.
     *
     * L1: removeView is posted to [overlayHandler] (main looper) — callers on
     * bridge/tile binder threads would otherwise risk CalledFromWrongThread.
     */
    private fun dismissBlockedOverlay() {
        try {
            overlayTimeoutRunnable?.let { overlayHandler.removeCallbacks(it) }
            overlayTimeoutRunnable = null
            // Friction countdown is owned by the overlay lifecycle: killing
            // it here guarantees no tick can re-fire (or foreground the
            // interstitial) after its overlay is dismissed or replaced.
            try {
                countdownRunnable?.let { overlayHandler.removeCallbacks(it) }
            } catch (_: Exception) {
            }
            countdownRunnable = null
            breathCountdownView = null
            val view = overlayView
            overlayView = null
            overlayBlockedPackage = null
            if (view != null) {
                val remove = Runnable {
                    try {
                        (getSystemService(WINDOW_SERVICE) as? WindowManager)?.removeView(view)
                        Log.d(TAG, "Overlay dismissed")
                    } catch (e: Exception) {
                        Log.w(TAG, "removeView failed", e)
                    }
                }
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    remove.run()
                } else {
                    overlayHandler.post(remove)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "dismissBlockedOverlay failed", e)
        }
    }

    /**
     * Build the overlay content programmatically to mirror the JS
     * interstitial (BlockedInterstitialScreen): themed background, owl
     * mascot, task headline + subtitle, BACK TO TASK (filled) then
     * SWITCH TASK (outline). Every button dismisses the overlay first.
     */
    private fun buildOverlayView(openedPackage: String, appLabel: String): LinearLayout {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()
        val green = Color.parseColor(GREEN_ACCENT)

        // Match the JS interstitial (BlockedInterstitialScreen): same mascot,
        // headline, subtitle, and button order. Theme follows the system
        // night mode — the JS app-theme override is not visible from native.
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val midnight = Color.parseColor("#000437")
        val ink = if (night) Color.WHITE else midnight
        val secondary = if (night) Color.parseColor("#C8C8C8") else Color.parseColor("#4B4B4B")
        val accent = if (night) green else Color.parseColor("#46A302")
        val (anton, grotesk, inter) = overlayTypefaces(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(if (night) Color.BLACK else Color.parseColor("#F5F5F5"))
            // Swallow touches so the blocked app underneath can't be used.
            isClickable = true
            isFocusable = true
            setPadding(dp(32), dp(48), dp(32), dp(48))
        }

        try {
            val owl = ImageView(this).apply {
                adjustViewBounds = true
                setImageResource(
                    if (night) R.drawable.stayt_owl_blocked_white else R.drawable.stayt_owl_blocked
                )
            }
            root.addView(
                owl,
                LinearLayout.LayoutParams(dp(200), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    gravity = Gravity.CENTER
                    bottomMargin = dp(24)
                }
            )
        } catch (e: Exception) {
            Log.w(TAG, "overlay mascot missing, continuing without it", e)
        }

        val taskUpper = blockingTaskName?.uppercase()
        val headline = TextView(this).apply {
            text = if (taskUpper != null) "THIS ISN'T PART OF $taskUpper" else "STAY FOCUSED"
            setTextColor(ink)
            if (anton != null) setTypeface(anton) else setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            gravity = Gravity.CENTER
        }
        root.addView(
            headline,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        )

        val subtitle = TextView(this).apply {
            text = "You're trying to open $appLabel, but that's not part of your current task."
            setTextColor(secondary)
            if (inter != null) setTypeface(inter) else setTypeface(typeface, Typeface.NORMAL)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
        }
        root.addView(
            subtitle,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(32) }
        )

        fun buttonParams() = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(12) }

        fun filledButton(label: String): Button = Button(this).apply {
            text = label
            setTextColor(midnight)
            if (grotesk != null) setTypeface(grotesk) else setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply {
                setColor(green)
                cornerRadius = dp(24).toFloat()
            }
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        fun outlineButton(label: String): Button = Button(this).apply {
            text = label
            setTextColor(accent)
            if (grotesk != null) setTypeface(grotesk) else setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                setStroke(dp(2), accent)
                cornerRadius = dp(12).toFloat()
            }
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        // BACK → dismiss first, then reuse the existing blocked deep-link
        // foregrounding path (same interstitial App.tsx already handles).
        val backBtn = filledButton("BACK TO TASK")
        backBtn.setOnClickListener {
            try {
                dismissBlockedOverlay()
                foregroundBlockedInterstitial(openedPackage, appLabel)
            } catch (t: Throwable) {
                Log.w(TAG, "BACK TO TASK action failed", t)
            }
        }
        root.addView(backBtn, buttonParams())

        // SWITCH → dismiss first, then foreground the task picker via the
        // tasks deep link (App.tsx handler owned by orchestrator).
        val switchBtn = outlineButton("SWITCH TASK")
        switchBtn.setOnClickListener {
            try {
                dismissBlockedOverlay()
                foregroundTaskPicker()
            } catch (t: Throwable) {
                Log.w(TAG, "SWITCH TASK action failed", t)
            }
        }
        root.addView(switchBtn, buttonParams())

        // No OVERRIDE here by design: overrides are budget-gated and the
        // budget lives behind the OverrideBudget seam (JS). BACK/SWITCH
        // foreground the app, where the single consume path runs.
        return root
    }

    /**
     * Friction breath overlay: same structure as [buildOverlayView] (owl +
     * headline + BACK TO TASK) but with a live countdown instead of the
     * subtitle/switch buttons. Single instance like the block overlay: an
     * existing overlay is replaced, and any pending countdown is cancelled
     * by [dismissBlockedOverlay]. When the countdown ends (or BACK TO TASK
     * is tapped = skip the wait), the overlay is dismissed and the normal
     * interstitial is foregrounded via the blocked deep link — the single
     * consume path, so there is no bypass hole and no new budget logic.
     * waitMs is pre-capped below the 30s overlay timeout by frictionWaitFor.
     */
    private fun showBreathOverlay(openedPackage: String, appLabel: String, waitMs: Long) {
        // Same-package breath already counting down: keep the existing
        // countdown (restarting it would let rapid reopens stretch the
        // wait forever) and just re-arm the 30s backstop.
        if (overlayView != null && overlayBlockedPackage == openedPackage && breathCountdownView != null) {
            armOverlayTimeout()
            return
        }
        try {
            dismissBlockedOverlay()
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                Log.w(TAG, "breath overlay skipped for $openedPackage: TYPE_ACCESSIBILITY_OVERLAY needs API 26+")
                try {
                    foregroundBlockedInterstitial(openedPackage, appLabel)
                } catch (e: Exception) {
                    Log.w(TAG, "breath fallback foreground failed for $openedPackage", e)
                }
                return
            }
            val wm = getSystemService(WINDOW_SERVICE) as? WindowManager
            if (wm == null) {
                Log.w(TAG, "breath overlay skipped for $openedPackage: no WindowManager")
                try {
                    foregroundBlockedInterstitial(openedPackage, appLabel)
                } catch (e: Exception) {
                    Log.w(TAG, "breath fallback foreground failed for $openedPackage", e)
                }
                return
            }
            val root = try {
                buildBreathOverlayView(openedPackage, appLabel, waitMs)
            } catch (e: Exception) {
                Log.w(TAG, "buildBreathOverlayView failed for $openedPackage", e)
                null
            }
            if (root == null) {
                try {
                    foregroundBlockedInterstitial(openedPackage, appLabel)
                } catch (e: Exception) {
                    Log.w(TAG, "breath fallback foreground failed for $openedPackage", e)
                }
                return
            }
            try {
                val params = WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.TOP
                }
                wm.addView(root, params)
                overlayView = root
                overlayBlockedPackage = openedPackage
                armOverlayTimeout()
                startBreathCountdown(System.currentTimeMillis() + waitMs, openedPackage, appLabel)
                Log.d(TAG, "Breath overlay shown for $openedPackage (${waitMs}ms)")
            } catch (e: Exception) {
                Log.w(TAG, "breath addView failed for $openedPackage", e)
                try {
                    dismissBlockedOverlay()
                } catch (_: Exception) {
                }
                try {
                    foregroundBlockedInterstitial(openedPackage, appLabel)
                } catch (_: Exception) {
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "showBreathOverlay failed for $openedPackage", e)
            try {
                dismissBlockedOverlay()
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Tick the breath countdown once per ~250ms. Stops (without firing)
     * when the overlay is gone or replaced; on expiry dismisses the overlay
     * and foregrounds the interstitial. Must never throw.
     */
    private fun startBreathCountdown(deadlineMs: Long, openedPackage: String, appLabel: String) {
        try {
            try {
                countdownRunnable?.let { overlayHandler.removeCallbacks(it) }
            } catch (_: Exception) {
            }
            countdownRunnable = null
            val tick = object : Runnable {
                override fun run() {
                    try {
                        val tv = breathCountdownView
                        if (tv == null || overlayView == null || overlayBlockedPackage != openedPackage) return
                        val left = deadlineMs - System.currentTimeMillis()
                        if (left <= 0L) {
                            try {
                                dismissBlockedOverlay()
                            } catch (e: Exception) {
                                Log.w(TAG, "breath expiry dismiss failed", e)
                            }
                            try {
                                foregroundBlockedInterstitial(openedPackage, appLabel)
                            } catch (e: Exception) {
                                Log.w(TAG, "breath expiry foreground failed for $openedPackage", e)
                            }
                            return
                        }
                        try {
                            tv.text = "${(left + 999L) / 1000L}s"
                        } catch (_: Exception) {
                        }
                        try {
                            overlayHandler.postDelayed(this, 250L)
                        } catch (_: Exception) {
                        }
                    } catch (t: Throwable) {
                        Log.w(TAG, "breath tick failed", t)
                    }
                }
            }
            countdownRunnable = tick
            try {
                overlayHandler.post(tick)
            } catch (e: Exception) {
                Log.w(TAG, "breath tick post failed", e)
            }
        } catch (e: Exception) {
            Log.w(TAG, "startBreathCountdown failed", e)
        }
    }

    /**
     * Breath overlay content: owl mascot + TAKE A BREATH headline + live
     * countdown + BACK TO TASK only (tapping it skips the wait and goes
     * straight to the interstitial — same deep link, same consume path).
     */
    private fun buildBreathOverlayView(openedPackage: String, appLabel: String, waitMs: Long): LinearLayout {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()
        val green = Color.parseColor(GREEN_ACCENT)

        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val midnight = Color.parseColor("#000437")
        val ink = if (night) Color.WHITE else midnight
        val secondary = if (night) Color.parseColor("#C8C8C8") else Color.parseColor("#4B4B4B")
        val (anton, grotesk, inter) = overlayTypefaces(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(if (night) Color.BLACK else Color.parseColor("#F5F5F5"))
            isClickable = true
            isFocusable = true
            setPadding(dp(32), dp(48), dp(32), dp(48))
        }

        try {
            val owl = ImageView(this).apply {
                adjustViewBounds = true
                setImageResource(
                    if (night) R.drawable.stayt_owl_blocked_white else R.drawable.stayt_owl_blocked
                )
            }
            root.addView(
                owl,
                LinearLayout.LayoutParams(dp(200), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    gravity = Gravity.CENTER
                    bottomMargin = dp(24)
                }
            )
        } catch (e: Exception) {
            Log.w(TAG, "breath mascot missing, continuing without it", e)
        }

        val headline = TextView(this).apply {
            text = "TAKE A BREATH"
            setTextColor(ink)
            if (anton != null) setTypeface(anton) else setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            gravity = Gravity.CENTER
        }
        root.addView(
            headline,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        )

        val countdown = TextView(this).apply {
            text = "${(waitMs + 999L) / 1000L}s"
            setTextColor(green)
            if (anton != null) setTypeface(anton) else setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 48f)
            gravity = Gravity.CENTER
        }
        breathCountdownView = countdown
        root.addView(
            countdown,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        )

        val subtitle = TextView(this).apply {
            text = "$appLabel can wait. Breathe in, breathe out."
            setTextColor(secondary)
            if (inter != null) setTypeface(inter) else setTypeface(typeface, Typeface.NORMAL)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
        }
        root.addView(
            subtitle,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(32) }
        )

        val backBtn = Button(this).apply {
            text = "BACK TO TASK"
            setTextColor(midnight)
            if (grotesk != null) setTypeface(grotesk) else setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply {
                setColor(green)
                cornerRadius = dp(24).toFloat()
            }
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        // Skip-the-wait: dismiss first, then the same interstitial deep link
        // the countdown expiry uses. No bypass — the interstitial enforces.
        backBtn.setOnClickListener {
            try {
                dismissBlockedOverlay()
                foregroundBlockedInterstitial(openedPackage, appLabel)
            } catch (t: Throwable) {
                Log.w(TAG, "breath BACK TO TASK action failed", t)
            }
        }
        root.addView(
            backBtn,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(12) }
        )
        return root
    }

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        try {
            dismissBlockedOverlay()
        } catch (e: Exception) {
            Log.w(TAG, "overlay dismiss on destroy failed", e)
        }
        // N-1: never leave tray notes behind a dead service.
        try {
            cancelAllBlockNotes()
        } catch (e: Exception) {
            Log.w(TAG, "notification cancel on destroy failed", e)
        }
        instance = null
        isBlocking = false
        blockedPackages.clear()
        lastBlockedAt.clear()
        allowlistMode = false
        allowlistPackages.clear()
        lastFeedBackAt.clear()
        lastFgPkg = null
        lastFgAt = 0L
        pauseRunnable?.let { handler.removeCallbacks(it) }
        pauseRunnable = null
        super.onDestroy()
        Log.d(TAG, "Accessibility service destroyed")
    }
}
