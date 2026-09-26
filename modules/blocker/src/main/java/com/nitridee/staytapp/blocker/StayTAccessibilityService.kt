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
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.Rect
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
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
        // Ongoing session note (ADR-0007): plain NotificationManager note,
        // NOT a foreground service — no startForeground, no
        // FOREGROUND_SERVICE permission/type, no manifest change. Posted on
        // setBlocking(true), cancelled on setBlocking(false), so it mirrors
        // enforcement exactly. Own channel (LOW: silent, persistent) + own
        // fixed ID so it coexists with — and is never swept by — the
        // per-block heads-up notes above.
        // v2 = DEFAULT importance: LOW ("silent") notes are hidden on the
        // lock screen by Samsung / Android 12+. Importance can't be raised
        // on an existing channel (and a re-created deleted id restores its
        // old settings), hence the new id; the LOW one is deleted.
        private const val SESSION_CHANNEL_ID = "stayt_session_v2"
        private const val LEGACY_SESSION_CHANNEL_ID = "stayt_session"
        private const val SESSION_CHANNEL_NAME = "Ongoing session"
        private const val SESSION_NOTIFICATION_ID = 57001
        private const val SESSION_TAP_REQ = 7001
        private const val SESSION_TOGGLE_REQ = 7002
        // ectoGreen accent for the small icon (mirrors theme tokens).
        // Signed decimal for 0xFF58CC02 — a raw 0xFF… literal overflows
        // Kotlin Int and will not compile.
        private const val SESSION_ACCENT = -10957822
        // Elapsed base: the JS session's startedAt (setSessionInfo), falling
        // back to the persisted blocking-start for native-only sessions.
        @Volatile
        private var sessionStartMs: Long = 0L
        // Note-lifecycle flag, independent of isBlocking: an intention
        // break or a user pause turns enforcement off but the SESSION
        // continues, so the note must survive. Only cancelSessionNotification
        // clears this. The timer is a native Chronometer (ticks itself), so
        // there is no refresh loop.
        @Volatile
        private var sessionNoteOn = false
        // Session pause (ADR-0008): play/pause from the note or the session
        // screen. Paused = enforcement off, timer frozen; paused intervals
        // are excluded from elapsed. Persisted so process death keeps it.
        @Volatile
        private var sessionPaused = false
        @Volatile
        private var pausedAt = 0L
        @Volatile
        private var pausedTotalMs = 0L
        // False for strict / dumbphone tasks: no pause control at all.
        @Volatile
        private var sessionPausable = true
        @Volatile
        private var appCtx: Context? = null
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

        /** Cached PackageManager label lookup. Never throws. */
        private fun appLabel(context: Context, openedPackage: String): String {
            appLabelCache[openedPackage]?.let { return it }
            val pm = context.packageManager
            val label = try {
                pm.getApplicationLabel(pm.getApplicationInfo(openedPackage, 0)).toString()
            } catch (_: Exception) {
                null
            } ?: try {
                // Package visibility (API 30+) can hide the app itself while its
                // launcher entry stays visible via our LAUNCHER <queries> intent
                // (seen on-device for preinstalled YouTube on Samsung).
                pm.queryIntentActivities(
                    Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(openedPackage), 0
                ).firstOrNull()?.loadLabel(pm)?.toString()
            } catch (_: Exception) {
                null
            }
            // Never cache the raw package fallback: a later lookup may succeed.
            if (label.isNullOrBlank()) return openedPackage
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
        // Packages the live JS session blocks (bridge startBlocking), kept
        // apart from schedule windows so neither can drop the other's set.
        private const val STATE_KEY_SESSION_PKGS = "session_pkgs"
        private const val STATE_KEY_STARTED = "session_started"
        private const val STATE_KEY_PAUSABLE = "pausable"
        private const val STATE_KEY_PAUSED = "paused"
        private const val STATE_KEY_PAUSED_AT = "paused_at"
        private const val STATE_KEY_PAUSED_TOTAL = "paused_total"

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
        // Escalation step per prior open and hard cap on the escalated bonus.
        // No-overlay (ADR-0005): frictionWaitFor is retired (JS owns the
        // breathe gate), so these only serve the inert counter below.
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

        // Feed-shield section signatures. Ids: Instagram Reels viewer
        // verified on-device (M52; also covers reels opened from feed/DMs).
        // Tab names: a SELECTED tab with this name = that section is open —
        // generic across apps (Instagram "Reels", YouTube "Shorts").
        // ponytail: small fixed lists; extend per app as users report gaps.
        private val FEED_SECTION_IDS: Map<String, List<String>> = mapOf(
            "reels" to listOf("com.instagram.android:id/clips_viewer_view_pager"),
        )
        private val FEED_SECTION_TAB_NAMES: Map<String, List<String>> = mapOf(
            "reels" to listOf("Reels", "Shorts"),
            "explore" to listOf("Explore"),
            "comments" to listOf("Comments"),
        )

        // Address-bar view ids of common browsers, for blocked websites.
        // Samsung Internet verified on-device (M52); Chrome and the rest are
        // their published ids. ponytail: fixed list — add a browser here if
        // users report a site slipping through it.
        private val BROWSER_URL_BAR_IDS: Map<String, String> = mapOf(
            "com.android.chrome" to "com.android.chrome:id/url_bar",
            "com.chrome.beta" to "com.chrome.beta:id/url_bar",
            "com.sec.android.app.sbrowser" to "com.sec.android.app.sbrowser:id/location_bar_edit_text",
            "com.sec.android.app.sbrowser.beta" to "com.sec.android.app.sbrowser.beta:id/location_bar_edit_text",
            "org.mozilla.firefox" to "org.mozilla.firefox:id/mozac_browser_toolbar_url_view",
            "com.microsoft.emmx" to "com.microsoft.emmx:id/url_bar",
            "com.brave.browser" to "com.brave.browser:id/url_bar",
            "com.opera.browser" to "com.opera.browser:id/url_field",
            "com.vivaldi.browser" to "com.vivaldi.browser:id/url_bar",
            "com.duckduckgo.mobile.android" to "com.duckduckgo.mobile.android:id/omnibarTextInput",
        )
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
            // A user pause survives re-pushes of the same session (mount
            // effect, 5s poll): enforcement stays off until resume. Stop
            // ends the session, so it clears every pause/session field.
            if (!blocking) {
                clearSessionState(instance ?: appCtx)
                // Allowlist mode belongs to the session that set it: a later
                // tile/schedule start must be a plain blocklist, not
                // "block everything except an old allowlist".
                allowlistMode = false
                allowlistPackages.clear()
            }
            isBlocking = blocking && !sessionPaused
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
            // Ongoing session note (ADR-0007): mirrors enforcement — up
            // while blocking, gone the moment it stops. pauseBlocking
            // deliberately leaves it posted (a break is still an active
            // session; only setBlocking(false) ends enforcement).
            if (!blocking) cancelSessionNotification() else postSessionNotification(instance)
            // Enforcement off: never leave the block overlay up (ADR-0008).
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
            // The SESSION note intentionally survives breaks (sessionNoteOn
            // stays true, ticker keeps running): the session never ended.
            cancelBlockNotifications()

            // Enforcement off: never leave the block overlay up (ADR-0008).
            try {
                instance?.dismissBlockedOverlay()
            } catch (e: Exception) {
                Log.w(TAG, "overlay dismiss on pause failed", e)
            }

            // Cancel any existing pause
            pauseRunnable?.let { handler.removeCallbacks(it) }

            // Resume after delay
            pauseRunnable = Runnable {
                // A user pause taken during the break wins: stay off.
                if (sessionPaused) return@Runnable
                isBlocking = true
                Log.d(TAG, "Blocking resumed after pause")
                refreshSessionNotification()
                // The blocked app may still be in front when the break ends:
                // no window event will come, so re-check the screen now.
                instance?.requestScan()
            }
            handler.postDelayed(pauseRunnable!!, s * 1000)
        }

        // App theme mirror (bridge setThemeDark): the JS light/dark/system
        // choice resolved to one flag, so native surfaces (overlay, covers,
        // session note, widget) match the app instead of the phone.
        private const val THEME_PREFS = "stayt_theme"
        private const val THEME_KEY_DARK = "dark"

        /** App theme when JS has mirrored it; else the phone's night mode. Never throws. */
        fun isDarkTheme(ctx: Context): Boolean {
            return try {
                val p = ctx.getSharedPreferences(THEME_PREFS, Context.MODE_PRIVATE)
                if (p.contains(THEME_KEY_DARK)) p.getBoolean(THEME_KEY_DARK, false)
                else (ctx.resources.configuration.uiMode and
                    android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                    android.content.res.Configuration.UI_MODE_NIGHT_YES
            } catch (_: Exception) {
                false
            }
        }

        /** tokens.ts mirror: paper/card/ink/muted/border per theme. */
        class Palette(val bg: Int, val card: Int, val ink: Int, val muted: Int, val border: Int)

        fun palette(ctx: Context): Palette {
            val c = { hex: String -> android.graphics.Color.parseColor(hex) }
            return if (isDarkTheme(ctx)) Palette(c("#000000"), c("#111111"), c("#FFFFFF"), c("#888888"), c("#222222"))
            else Palette(c("#F5F5F5"), c("#FFFFFF"), c("#000437"), c("#777777"), c("#E5E5E5"))
        }

        /** Bridge: persist the app theme and repaint every native surface. Never throws. */
        fun setThemeDark(ctx: Context, dark: Boolean) {
            try {
                val p = ctx.getSharedPreferences(THEME_PREFS, Context.MODE_PRIVATE)
                if (p.contains(THEME_KEY_DARK) && p.getBoolean(THEME_KEY_DARK, !dark) == dark) return
                p.edit().putBoolean(THEME_KEY_DARK, dark).apply()
                refreshSessionNotification()
                try { StayTWidgetProvider.refreshAll(ctx) } catch (_: Exception) { }
                handler.post { instance?.retheme() }
            } catch (e: Exception) {
                Log.w(TAG, "setThemeDark failed", e)
            }
        }

        /** Bridge startBlocking/stopBlocking record the JS session's own set (null = no session). */
        fun setSessionPackages(ctx: Context?, pkgs: List<String>?) {
            try {
                val e = (ctx ?: instance ?: appCtx)?.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)?.edit() ?: return
                if (pkgs == null) e.remove(STATE_KEY_SESSION_PKGS) else e.putStringSet(STATE_KEY_SESSION_PKGS, pkgs.toSet())
                e.apply()
            } catch (e: Exception) {
                Log.w(TAG, "setSessionPackages failed", e)
            }
        }

        fun sessionPackages(ctx: Context?): List<String> = try {
            (ctx ?: instance ?: appCtx)?.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                ?.getStringSet(STATE_KEY_SESSION_PKGS, null)?.filter { it.isNotBlank() } ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }

        /** Active schedule windows right now (empty on any failure). */
        fun scheduleUnionNow(ctx: Context): List<String> = try {
            ScheduleAlarmScheduler.unionActive(ScheduleAlarmScheduler.load(ctx), System.currentTimeMillis())
        } catch (_: Exception) {
            emptyList()
        }

        /**
         * Enforce the union of the live JS session and the active schedule
         * windows (collision rule: hard block wins, nobody unblocks the
         * other's apps). Empty union = blocking off. Keeps the session's
         * task name and allowlist. Never throws.
         */
        fun reconcileWithSchedules(ctx: Context, scheduleUnion: List<String>) {
            try {
                val session = sessionPackages(ctx)
                val all = (session + scheduleUnion).distinct()
                if (all.isEmpty()) setBlocking(false)
                else setBlocking(true, all, if (session.isNotEmpty()) blockingTaskName else null)
            } catch (e: Exception) {
                Log.w(TAG, "reconcileWithSchedules failed", e)
            }
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
         * Ongoing session note, music-player style (ADR-0007/0008):
         * persistent, non-dismissible themed card — "StayT · <task>", a
         * native Chronometer and a play/pause button — whose tap resumes the
         * app on the session screen. Plain NotificationManager.post, so
         * POST_NOTIFICATIONS denial (API 33+) silently skips via
         * [canPostNotifications] and no foreground service is needed.
         * Never throws.
         */
        fun postSessionNotification(ctx: Context?) {
            try {
                val c = ctx ?: appCtx ?: return
                if (sessionStartMs <= 0L) {
                    sessionStartMs = try {
                        c.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                            .getLong(STATE_KEY_AT, 0L).takeIf { it > 0L }
                    } catch (_: Exception) {
                        null
                    } ?: System.currentTimeMillis()
                }
                sessionNoteOn = true
                if (!canPostNotifications(c)) return
                ensureSessionChannel(c)
                buildAndNotifySession(c, System.currentTimeMillis())
            } catch (e: Exception) {
                Log.w(TAG, "postSessionNotification failed", e)
            }
        }

        /** Re-post the session note with current pause state. Never throws. */
        fun refreshSessionNotification() {
            try {
                if (!sessionNoteOn) return
                val c = instance ?: appCtx ?: return
                if (!canPostNotifications(c)) return
                buildAndNotifySession(c, System.currentTimeMillis())
            } catch (e: Exception) {
                Log.w(TAG, "refreshSessionNotification failed", e)
            }
        }

        /** Drop the session note. Idempotent. Never throws. */
        fun cancelSessionNotification() {
            try {
                sessionNoteOn = false
                val c = instance ?: appCtx ?: return
                try {
                    c.getSystemService(NotificationManager::class.java)?.cancel(SESSION_NOTIFICATION_ID)
                } catch (_: Exception) {
                }
            } catch (e: Exception) {
                Log.w(TAG, "cancelSessionNotification failed", e)
            }
        }

        /**
         * JS session metadata (bridge setSessionInfo): the true session start
         * (timer base survives process death and re-pushes) and whether the
         * pause control is offered (false for strict / dumbphone). Persisted.
         * Never throws.
         */
        fun setSessionInfo(ctx: Context?, startedAt: Long, pausable: Boolean) {
            try {
                if (startedAt > 0L) sessionStartMs = startedAt
                sessionPausable = pausable
                // A strict task can never sit paused (e.g. edited to strict
                // mid-pause): resume immediately.
                if (!pausable && sessionPaused) setSessionPaused(ctx, false)
                try {
                    (ctx ?: instance ?: appCtx)?.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                        ?.edit()
                        ?.putLong(STATE_KEY_STARTED, sessionStartMs)
                        ?.putBoolean(STATE_KEY_PAUSABLE, pausable)
                        ?.apply()
                } catch (_: Exception) {
                }
                refreshSessionNotification()
            } catch (e: Exception) {
                Log.w(TAG, "setSessionInfo failed", e)
            }
        }

        /**
         * Pause / resume the running session (note button, session screen).
         * Pause = enforcement off + timer frozen, until resume — no timeout
         * (strict tasks never get the control). Returns the resulting paused
         * state. Emits onSessionPauseChanged to JS. Never throws.
         */
        fun setSessionPaused(ctx: Context?, paused: Boolean): Boolean {
            try {
                if (paused == sessionPaused) return sessionPaused
                val hasSession = blockedPackages.isNotEmpty() || allowlistMode
                if (paused && (!sessionPausable || !hasSession)) return sessionPaused
                val now = System.currentTimeMillis()
                if (paused) {
                    sessionPaused = true
                    pausedAt = now
                    isBlocking = false
                    // A running intention break is folded into the pause.
                    pauseRunnable?.let { handler.removeCallbacks(it) }
                    pauseRunnable = null
                    cancelBlockNotifications()
                    try { instance?.dismissBlockedOverlay() } catch (_: Exception) { }
                } else {
                    pausedTotalMs += maxOf(0L, now - pausedAt)
                    pausedAt = 0L
                    sessionPaused = false
                    isBlocking = hasSession
                    // Resumed while a blocked app is on screen: cover it now.
                    handler.post { instance?.requestScan() }
                }
                persistPause(ctx ?: instance ?: appCtx)
                refreshSessionNotification()
                try {
                    AppBlockerModule.emitSessionPause(sessionPaused, pausedAt, pausedTotalMs)
                } catch (_: Exception) {
                }
                return sessionPaused
            } catch (e: Exception) {
                Log.w(TAG, "setSessionPaused failed", e)
                return sessionPaused
            }
        }

        fun toggleSessionPause(ctx: Context?): Boolean = setSessionPaused(ctx, !sessionPaused)

        /** (paused, pausedAt, pausedTotalMs) for the bridge. */
        fun sessionPauseSnapshot(): Triple<Boolean, Long, Long> = Triple(sessionPaused, pausedAt, pausedTotalMs)

        private fun persistPause(ctx: Context?) {
            try {
                ctx?.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                    ?.edit()
                    ?.putBoolean(STATE_KEY_PAUSED, sessionPaused)
                    ?.putLong(STATE_KEY_PAUSED_AT, pausedAt)
                    ?.putLong(STATE_KEY_PAUSED_TOTAL, pausedTotalMs)
                    ?.apply()
            } catch (e: Exception) {
                Log.w(TAG, "persistPause failed", e)
            }
        }

        /** Session ended: forget start/pause state (memory + prefs). Never throws. */
        private fun clearSessionState(ctx: Context?) {
            sessionStartMs = 0L
            sessionPaused = false
            pausedAt = 0L
            pausedTotalMs = 0L
            sessionPausable = true
            try {
                ctx?.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                    ?.edit()
                    ?.remove(STATE_KEY_STARTED)
                    ?.remove(STATE_KEY_PAUSABLE)
                    ?.remove(STATE_KEY_PAUSED)
                    ?.remove(STATE_KEY_PAUSED_AT)
                    ?.remove(STATE_KEY_PAUSED_TOTAL)
                    ?.apply()
            } catch (_: Exception) {
            }
        }

        /** Process-death restore of start/pause state (onServiceConnected). */
        private fun loadSessionState(ctx: Context) {
            try {
                val p = ctx.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                sessionStartMs = p.getLong(STATE_KEY_STARTED, 0L)
                sessionPausable = p.getBoolean(STATE_KEY_PAUSABLE, true)
                sessionPaused = p.getBoolean(STATE_KEY_PAUSED, false)
                pausedAt = p.getLong(STATE_KEY_PAUSED_AT, 0L)
                pausedTotalMs = p.getLong(STATE_KEY_PAUSED_TOTAL, 0L)
            } catch (e: Exception) {
                Log.w(TAG, "loadSessionState failed", e)
            }
        }

        /** Session channel: DEFAULT but silent (lock-screen visible) + legacy sweep. Never throws. */
        private fun ensureSessionChannel(ctx: Context) {
            try {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
                val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
                if (nm.getNotificationChannel(SESSION_CHANNEL_ID) != null) return
                try { nm.deleteNotificationChannel(LEGACY_SESSION_CHANNEL_ID) } catch (_: Exception) { }
                val channel = NotificationChannel(
                    SESSION_CHANNEL_ID,
                    SESSION_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    try { description = "StayT focus session status. Tap to return to your session." } catch (_: Exception) { }
                    try { enableVibration(false) } catch (_: Exception) { }
                    try { setSound(null, null) } catch (_: Exception) { }
                    try { setShowBadge(false) } catch (_: Exception) { }
                    try { lockscreenVisibility = Notification.VISIBILITY_PUBLIC } catch (_: Exception) { }
                }
                try { nm.createNotificationChannel(channel) } catch (_: Exception) { }
            } catch (e: Exception) {
                Log.w(TAG, "session channel setup failed", e)
            }
        }

        @Suppress("DEPRECATION")
        private fun buildAndNotifySession(ctx: Context, now: Long) {
            val task = try { blockingTaskName?.takeIf { it.isNotBlank() } } catch (_: Exception) { null }
                ?: "Focus"
            val sub = if (sessionPaused) "Paused" else "Focusing"
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(ctx, SESSION_CHANNEL_ID)
            } else {
                Notification.Builder(ctx)
            }
            // Themed card (app theme: black / white, tokens.ts): custom
            // content on N+; title/text below double as the fallback,
            // lockscreen line and accessibility text.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    val card = android.widget.RemoteViews(ctx.packageName, R.layout.session_note)
                    val dark = isDarkTheme(ctx)
                    val pal = palette(ctx)
                    card.setInt(
                        R.id.session_card, "setBackgroundResource",
                        if (dark) R.drawable.session_card_bg else R.drawable.session_card_bg_light
                    )
                    // Short on purpose: the timer + button leave little width,
                    // and the app icon already says StayT.
                    card.setTextViewText(R.id.session_title, task)
                    card.setTextColor(R.id.session_title, pal.ink)
                    card.setTextViewText(R.id.session_sub, sub)
                    card.setTextColor(R.id.session_sub, pal.muted)
                    // Frozen timer reads as paused: muted instead of ink.
                    card.setTextColor(R.id.session_timer, if (sessionPaused) pal.muted else pal.ink)
                    // Native Chronometer: ticks every second by itself, no
                    // refresh loop. Paused = frozen at the elapsed value.
                    card.setChronometer(
                        R.id.session_timer,
                        android.os.SystemClock.elapsedRealtime() - sessionElapsedMs(now),
                        null,
                        !sessionPaused
                    )
                    if (sessionPausable) {
                        card.setViewVisibility(R.id.session_toggle, android.view.View.VISIBLE)
                        card.setImageViewResource(
                            R.id.session_toggle,
                            if (sessionPaused) R.drawable.ic_note_play else R.drawable.ic_note_pause
                        )
                        card.setContentDescription(
                            R.id.session_toggle,
                            if (sessionPaused) "Resume session" else "Pause session"
                        )
                        val toggle = Intent(ctx, SessionControlReceiver::class.java)
                            .setAction(SessionControlReceiver.ACTION_TOGGLE)
                        card.setOnClickPendingIntent(
                            R.id.session_toggle,
                            PendingIntent.getBroadcast(
                                ctx, SESSION_TOGGLE_REQ, toggle,
                                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                            )
                        )
                    } else {
                        card.setViewVisibility(R.id.session_toggle, android.view.View.GONE)
                    }
                    builder.setStyle(Notification.DecoratedCustomViewStyle())
                    builder.setCustomContentView(card)
                    builder.setCustomBigContentView(card)
                } catch (e: Exception) {
                    Log.w(TAG, "session card failed, standard template", e)
                }
            }
            builder
                .setContentTitle("StayT · $task")
                .setContentText(sub)
                .setSmallIcon(R.drawable.ic_stayt_note)
                .setColor(SESSION_ACCENT)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                // Explicit setPriority call (not Kotlin property syntax):
                // the synthetic `priority` accessor does not resolve
                // against this deprecated Java setter and breaks the build.
                try { builder.setPriority(Notification.PRIORITY_DEFAULT) } catch (_: Exception) { }
            }
            try {
                val launch = try {
                    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
                } catch (_: Exception) {
                    null
                }
                if (launch != null) {
                    builder.setContentIntent(
                        PendingIntent.getActivity(
                            ctx, SESSION_TAP_REQ, launch,
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                        )
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "session tap intent failed", e)
            }
            try {
                ctx.getSystemService(NotificationManager::class.java)
                    ?.notify(SESSION_NOTIFICATION_ID, builder.build())
            } catch (e: Exception) {
                Log.w(TAG, "session notify failed", e)
            }
        }

        /** Focus time so far: wall time minus paused intervals, frozen while paused. */
        private fun sessionElapsedMs(now: Long): Long {
            val base = if (sessionStartMs > 0L) sessionStartMs else now
            val end = if (sessionPaused && pausedAt > 0L) pausedAt else now
            return maxOf(0L, end - base - pausedTotalMs)
        }

        /** Bridge seam: the JS interstitial dismisses the overlay on mount. Never throws. */
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
         * Over today's budget: an enabled rule for [pkg] whose meter is used
         * up. "N opens/day" allows N opens — the (N+1)th is blocked (the
         * current open is already counted when this runs). Minutes block once
         * the limit is reached. Never throws.
         */
        fun isOverBudget(pkg: String): Boolean {
            return try {
                val u = budgetUsage[pkg] ?: return false
                budgetRules.any { r ->
                    r.packageName == pkg && r.enabled && r.limit > 0 && when (r.kind) {
                        "opens" -> u.opens > r.limit
                        "minutes" -> u.ms >= r.limit * 60_000L
                        else -> false
                    }
                }
            } catch (_: Exception) {
                false
            }
        }

        /**
         * Budget meter: counts one open of a budgeted [pkg] (called when it
         * comes to the front while blocking; rolled over daily). Feeds both
         * getBudgetUsage and [isOverBudget]. A budget never unblocks a hard-
         * blocked app — it only adds a block once used up. Never throws.
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
         * No-overlay (ADR-0005): RETIRED — the block path no longer calls
         * this; the JS interstitial owns the breathe gate. Kept (with the
         * setFriction bridge + prefs mirror) so pushes never break and the
         * counter stays available. Never throws.
         *
         * Friction countdown for this open in ms (0 = go straight to the
         * block path). Counts the open first; the escalation bonus uses
         * prior opens only (15s each, capped at 90s). Never throws.
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

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "Accessibility service connected")

        // Heads-up tap-to-return channel (ADR-0006): IMPORTANCE_HIGH + sound/
        // vibration peeks full-bleed top. Channels are immutable after first
        // create — an old install stuck below HIGH would silently lose
        // heads-up, so delete + recreate when below HIGH. IMPORTANCE_NONE
        // (user-disabled) is respected: bounce + emit remain enforcement.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val nm = getSystemService(NotificationManager::class.java)
                if (nm != null) {
                    try {
                        val existing = nm.getNotificationChannel(BLOCK_CHANNEL_ID)
                        if (existing != null && existing.importance != NotificationManager.IMPORTANCE_NONE &&
                            existing.importance < NotificationManager.IMPORTANCE_HIGH
                        ) {
                            try { nm.deleteNotificationChannel(BLOCK_CHANNEL_ID) } catch (_: Exception) { }
                        }
                    } catch (_: Exception) { }
                    val channel = NotificationChannel(
                        BLOCK_CHANNEL_ID,
                        BLOCK_CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_HIGH
                    ).apply {
                        try { description = "StayT blocked-app return prompt. Tap to open your task." } catch (_: Exception) { }
                        try { enableVibration(true) } catch (_: Exception) { }
                        try { enableLights(true) } catch (_: Exception) { }
                        try { setShowBadge(true) } catch (_: Exception) { }
                        try { lockscreenVisibility = Notification.VISIBILITY_PUBLIC } catch (_: Exception) { }
                    }
                    try { nm.createNotificationChannel(channel) } catch (_: Exception) { }
                }
            } catch (e: Exception) {
                Log.w(TAG, "block channel setup failed", e)
            }
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
        // Companion context for session-note post/cancel when the service
        // instance is not in hand (tile/schedule call sites).
        try {
            appCtx = this.applicationContext
        } catch (e: Exception) {
            Log.w(TAG, "appCtx stash failed", e)
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
                loadSessionState(this)
                isBlocking = !sessionPaused
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
            // Session-note re-arm (ADR-0007): a process death between
            // setBlocking(true) and (false) leaves a stale ongoing note with
            // NOBODY owning its ticker (statics are lost on death). Re-post
            // when enforcement is re-armed (elapsed continues from the
            // persisted start); otherwise sweep the orphan.
            try {
                if (wantBlocking && pkgs.isNotEmpty()) postSessionNotification(this) else cancelSessionNotification()
            } catch (e: Exception) {
                Log.w(TAG, "session note re-arm failed", e)
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
            // WINDOWS_CHANGED: split screen, pop-up/freeform, PiP and bubbles
            // change what is visible without a WINDOW_STATE_CHANGED from the
            // blocked app — the window scan below re-enforces on every one.
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                    AccessibilityEvent.TYPE_WINDOWS_CHANGED or
                    AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 100
            // canRetrieveWindowContent lives in the XML config only: the
            // platform exposes a getter with no setter.
            flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                    AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            if (isBlocking || hasBlockSurface()) requestScan()
            return
        }
        // In-page navigation fires no window-state event: re-read browser
        // address bars on content changes. Everything else returns at once,
        // so the extra event type costs one map lookup per event.
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            val pkg = event.packageName?.toString() ?: return
            if (!isBlocking) return
            if (blockedDomains.isNotEmpty() && BROWSER_URL_BAR_IDS.containsKey(pkg)) requestScan()
            // Feed sections open without a window-state event (tab switch).
            if (feedRules.any { it.packageName == pkg && it.enabled }) requestFeedCheck(pkg)
            return
        }
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val openedPackage = event.packageName?.toString() ?: return

        if (!isBlocking) return

        // Own package: overlay windows report it too, so only rescan —
        // the scan drops surfaces whose blocked window is no longer visible
        // (e.g. StayT came to front over the blocked app).
        if (openedPackage == packageName) {
            requestScan()
            return
        }

        val now = System.currentTimeMillis()

        // Budget meters (while blocking): minutes go to the previously
        // foreground pkg; an OPEN is counted when a budgeted app comes to
        // the front. The shade and keyboard float over apps — they are not
        // app switches and must not inflate either meter.
        if (!isTransientSurface(openedPackage)) {
            val newOpen = lastFgPkg != openedPackage
            try {
                trackForegroundMinutes(openedPackage, now)
                if (newOpen) countBudgetOpen(openedPackage, dayKey(now))
            } catch (e: Exception) {
                Log.w(TAG, "budget meters failed", e)
            }
        }

        // Lowercased source text shared by the domain matcher + feed shield.
        // Best-effort: empty on any failure, which simply matches nothing.
        val haystack = try {
            event.text?.joinToString(" ") { it?.toString().orEmpty() }
                ?.lowercase(java.util.Locale.ROOT).orEmpty()
        } catch (_: Exception) {
            ""
        }

        // Blocked-target decision FIRST (hard block wins). A blocked-domain
        // hit marks that browser as blocked until the user closes it.
        val domainHit = try {
            matchBlockedDomain(haystack)
        } catch (_: Exception) {
            null
        }
        if (domainHit != null) {
            domainPkg = openedPackage
            domainHitName = domainHit
        }
        val target = domainHit != null || isBlockedPkg(openedPackage)
        if (!target) {
            // Something else came to front: the scan decides whether any
            // blocked window is still visible (split screen, pop-up, PiP).
            requestScan()
            // Feed shield runs ONLY for allowed apps: it hardens feeds, it
            // never blocks.
            try {
                maybeFeedShield(openedPackage, haystack, now)
            } catch (e: Exception) {
                Log.w(TAG, "feed shield failed for $openedPackage", e)
            }
            return
        }

        // Already covered: window-event bursts from the app underneath
        // must not re-count or re-log the same block.
        if (isCovered(openedPackage)) return

        // Per-package cooldown: WINDOW_STATE_CHANGED fires in bursts. It
        // gates counting + emit only — the surface itself must always come
        // back (a re-open within 1s would otherwise leave the app usable).
        val last = lastBlockedAt[openedPackage] ?: 0L
        val fresh = now - last >= BLOCK_COOLDOWN_MS
        if (fresh) lastBlockedAt[openedPackage] = now

        val appLabel = appLabel(this, openedPackage)

        Log.d(TAG, "Blocked app: $openedPackage")

        // Block surface (ADR-0008/0009): cover exactly what is visible —
        // full overlay for a full-screen app, window-sized covers for
        // split/pop-up/PiP. Fail-closed: the window list can lag this
        // event, so if nothing got covered, cover the whole screen.
        enforceWindows(allowDismiss = false)
        if (!hasBlockSurface()) showBlockedOverlay(openedPackage, appLabel)
        if (hasBlockSurface()) {
            if (fresh) AppBlockerModule.emitBlockedAttempt(openedPackage, now, appLabel)
            return
        }
        if (!fresh) return

        // Fallback when no overlay could be added: the ADR-0005/0006
        // path — HOME bounce + emit + best-effort foreground + tap note.
        // Throwable (not just Exception): this service shares StayT's process.
        val bounced = try {
            performGlobalAction(GLOBAL_ACTION_HOME)
        } catch (t: Throwable) {
            Log.w(TAG, "performGlobalAction threw for $openedPackage", t)
            false
        }
        if (!bounced) Log.w(TAG, "performGlobalAction denied/throttled for $openedPackage - emit + notification remain")
        AppBlockerModule.emitBlockedAttempt(openedPackage, now, appLabel)
        try {
            foregroundBlockedInterstitial(openedPackage, appLabel)
        } catch (t: Throwable) {
            Log.w(TAG, "best-effort foreground failed for $openedPackage; notification remains", t)
        }
        postBlockedNotification(openedPackage, appLabel)
    }

    /**
     * List-based block decision: blocklist = membership; allowlist =
     * everything not listed and not safelisted. Never throws.
     */
    private fun isListTarget(pkg: String): Boolean {
        return try {
            if (pkg == packageName) false
            else if (allowlistMode) !isSafelist(pkg) && !allowlistPackages.contains(pkg)
            else blockedPackages.contains(pkg)
        } catch (_: Exception) {
            false
        }
    }

    /** List target, or the browser currently showing a blocked domain. */
    private fun isBlockedPkg(pkg: String): Boolean =
        isListTarget(pkg) || isOverBudget(pkg) || (pkg == domainPkg && pkg != packageName)

    /** Shade / current keyboard: windows that float over apps, not app switches. */
    private fun isTransientSurface(pkg: String): Boolean {
        if (pkg == "com.android.systemui") return true
        return try {
            Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
                ?.substringBefore('/') == pkg
        } catch (_: Exception) {
            false
        }
    }

    // ── Window enforcement (ADR-0009) ────────────────────────────────────
    // The visible-window list — not the last event — is the source of
    // truth. Minimising into a pop-up, split screen, PiP or a chat bubble
    // leaves a blocked window on screen with no event from its app; every
    // WINDOWS_CHANGED rescans and covers exactly what is visible.
    private class BlockedWin(val id: Int, val pkg: String, val bounds: Rect, val pip: Boolean)

    @Volatile
    private var domainPkg: String? = null
    // The blocked domain that put domainPkg under cover (overlay title).
    @Volatile
    private var domainHitName: String? = null
    private val covers = HashMap<Int, View>()
    private val pausedPipWindows = HashSet<Int>()
    private var scanPending = false

    private fun hasBlockSurface(): Boolean = overlayView != null || covers.isNotEmpty()

    private fun isCovered(pkg: String): Boolean =
        (overlayView != null && overlayPkg == pkg) || covers.values.any { it.tag == pkg }

    /** Trailing-edge throttle: window events arrive in bursts during animations. Main thread. */
    fun requestScan() {
        if (scanPending) return
        scanPending = true
        handler.postDelayed({
            scanPending = false
            enforceWindows(allowDismiss = true)
        }, 120L)
    }

    /**
     * Visible blocked app windows, or null when the window list is
     * unavailable (fail-closed: callers keep the current surfaces). A list
     * with NO app windows means system UI (notification shade, lock
     * screen) covers the screen: nothing underneath is usable, so the
     * result is empty and the surfaces step aside — accessibility overlays
     * sit above the shade and would otherwise hide it (on-device M52).
     * Closing the shade fires WINDOWS_CHANGED and the rescan restores them.
     * Never throws.
     */
    private fun scanBlockedWindows(): List<BlockedWin>? {
        val ws = try { windows } catch (_: Throwable) { null }
        if (ws.isNullOrEmpty()) return null
        val out = ArrayList<BlockedWin>()
        for (w in ws) {
            try {
                if (w.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
                val root = w.root ?: continue
                val pkg = root.packageName?.toString()
                // Browser on a blocked website: read the address bar while
                // the root is in hand (event text alone never carries the
                // URL — on-device, wikipedia.org loaded unblocked).
                val siteHit = pkg != null && browserOnBlockedSite(root, pkg)
                try { @Suppress("DEPRECATION") root.recycle() } catch (_: Throwable) { }
                if (pkg == null) continue
                if (!siteHit && !isBlockedPkg(pkg)) continue
                val r = Rect()
                w.getBoundsInScreen(r)
                if (r.isEmpty) continue
                val pip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && w.isInPictureInPictureMode
                // Tiny non-PiP windows are window chrome, not content: on
                // Samsung the pop-up toolbar (minimise / full screen / close)
                // is an APPLICATION window of the blocked app itself. Covering
                // it trapped the user with no way to close the pop-up
                // (on-device M52). Nothing usable fits under 80dp.
                if (!pip && r.height() < (80 * resources.displayMetrics.density).toInt()) continue
                out.add(BlockedWin(w.id, pkg, r, pip))
            } catch (_: Throwable) {
            }
        }
        return out
    }

    /**
     * True when [pkg] is a known browser whose address bar shows a blocked
     * domain. Tracks [domainPkg]: set on a hit, cleared once the same
     * browser shows an allowed URL. False for non-browsers / unreadable bars.
     * Never throws.
     */
    private fun browserOnBlockedSite(root: AccessibilityNodeInfo, pkg: String): Boolean {
        val barId = BROWSER_URL_BAR_IDS[pkg] ?: return false
        if (blockedDomains.isEmpty()) return false
        return try {
            val nodes = root.findAccessibilityNodeInfosByViewId(barId)
            val raw = nodes?.firstOrNull()?.text?.toString()
            try { nodes?.forEach { @Suppress("DEPRECATION") it.recycle() } } catch (_: Throwable) { }
            if (raw.isNullOrBlank()) return pkg == domainPkg
            // Samsung Internet prefixes an invisible U+200E LRM mark.
            val url = raw.filter { it.code >= 0x20 && it !in "\u200E\u200F\u202A\u202B\u202C\u202D\u202E" }
                .trim().lowercase(java.util.Locale.ROOT)
            val site = matchBlockedDomain(url)
            if (site != null) {
                domainPkg = pkg
                domainHitName = site
            } else if (domainPkg == pkg) {
                domainPkg = null
            }
            site != null
        } catch (_: Throwable) {
            pkg == domainPkg
        }
    }

    /**
     * Report a block first put under cover by the window scan (website,
     * split screen, pop-up) — those never pass the event path's emit, so
     * they were missing from stats. Shares the per-package cooldown with the
     * event path, so one block is never logged twice.
     */
    private fun noteBlock(pkg: String) {
        try {
            val now = System.currentTimeMillis()
            if (now - (lastBlockedAt[pkg] ?: 0L) < BLOCK_COOLDOWN_MS) return
            lastBlockedAt[pkg] = now
            AppBlockerModule.emitBlockedAttempt(pkg, now, appLabel(this, pkg))
        } catch (_: Throwable) {
        }
    }

    private fun screenRect(): Rect {
        return try {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Rect(wm.currentWindowMetrics.bounds)
            } else {
                val p = android.graphics.Point()
                @Suppress("DEPRECATION") wm.defaultDisplay.getRealSize(p)
                Rect(0, 0, p.x, p.y)
            }
        } catch (_: Throwable) {
            Rect(0, 0, resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels)
        }
    }

    /**
     * Make the block surfaces match the visible blocked windows. A blocked
     * window filling most of the screen gets the full overlay; smaller
     * ones (split / pop-up / PiP / bubble) get a cover pinned to their
     * bounds. [allowDismiss]=false (block-event path) never removes a
     * surface — the window list may lag the event. Main thread. Never throws.
     */
    private fun enforceWindows(allowDismiss: Boolean) {
        try {
            if (!isBlocking) {
                if (allowDismiss) dismissBlockedOverlay()
                return
            }
            val found = scanBlockedWindows() ?: return
            if (found.isEmpty()) {
                if (allowDismiss) {
                    domainPkg = null
                    dismissBlockedOverlay()
                }
                return
            }
            val screen = screenRect()
            val screenArea = screen.width().toLong() * screen.height().toLong()
            // ponytail: 85% area = "full screen" heuristic; tune on OEMs with
            // tall cutouts/taskbars if full apps get window covers instead.
            val full = found.firstOrNull {
                !it.pip && it.bounds.width().toLong() * it.bounds.height() >= screenArea * 85 / 100
            }
            if (full != null) {
                removeCovers()
                val isNew = overlayView == null || overlayPkg != full.pkg
                if (showBlockedOverlay(full.pkg, appLabel(this, full.pkg)) && isNew) noteBlock(full.pkg)
                return
            }
            if (overlayView != null) removeFullOverlay()
            syncCovers(found, screen)
        } catch (t: Throwable) {
            Log.w(TAG, "enforceWindows failed", t)
        }
    }

    private fun syncCovers(found: List<BlockedWin>, screen: Rect) {
        val wm = getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
        loadFonts()
        val live = found.map { it.id }.toSet()
        for (id in covers.keys.filter { it !in live }) {
            covers.remove(id)?.let { v -> try { wm.removeViewImmediate(v) } catch (_: Throwable) { } }
        }
        pausedPipWindows.retainAll(live)
        for (b in found) {
            val lp = coverParams(b, screen)
            val existing = covers[b.id]
            try {
                if (existing != null) {
                    existing.tag = b.pkg
                    wm.updateViewLayout(existing, lp)
                } else {
                    val v = LayoutInflater.from(this).inflate(R.layout.blocked_cover, null)
                    v.tag = b.pkg
                    applyCoverTheme(v)
                    v.findViewById<TextView>(R.id.cover_label)?.let { t ->
                        t.text = "${appLabel(this, b.pkg)} is blocked"
                        fontBold?.let { t.typeface = it }
                    }
                    wm.addView(v, lp)
                    covers[b.id] = v
                    noteBlock(b.pkg)
                }
            } catch (t: Throwable) {
                Log.w(TAG, "cover add/update failed for ${b.pkg}", t)
            }
            // A blocked video minimised into PiP keeps playing: pause it
            // once per PiP window (media keys go to the active session,
            // which is the PiP player here).
            if (b.pip && pausedPipWindows.add(b.id)) pauseMedia()
        }
    }

    /**
     * Cover params. Touchable covers eat input so the hidden app can't be
     * used blind. Exceptions keep an exit reachable: PiP covers pass touch
     * through (drag to dismiss), and pop-up windows keep their caption bar
     * (close / minimise buttons) uncovered.
     */
    private fun coverParams(b: BlockedWin, screen: Rect): WindowManager.LayoutParams {
        // ponytail: "pop-up" = spans neither screen dimension (split panes
        // span one). 14dp keeps Samsung's pop-up drag handle (tap = close /
        // minimise menu) reachable without exposing the app's own toolbar
        // (32dp did, on-device M52); other OEMs' captions may need tuning.
        val popup = !b.pip && b.bounds.width() < screen.width() && b.bounds.height() < screen.height()
        val caption = if (popup) (14 * resources.displayMetrics.density).toInt() else 0
        val top = b.bounds.top + caption
        var flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        if (b.pip) flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        return WindowManager.LayoutParams(
            b.bounds.width(),
            maxOf(1, b.bounds.bottom - top),
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            flags,
            PixelFormat.OPAQUE
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = b.bounds.left
            y = top
        }
    }

    private fun pauseMedia() {
        try {
            val am = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
            am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE))
            am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE))
        } catch (t: Throwable) {
            Log.w(TAG, "media pause failed", t)
        }
    }

    // ── Full block overlay (ADR-0008) ────────────────────────────────────
    // One view at most, added/removed on the main thread only. Every
    // WindowManager call is wrapped in Throwable: this service shares
    // StayT's process, so a BadToken here must never kill the app.
    private var overlayView: View? = null
    private var overlayPkg: String? = null
    private var overlayLabel: String = ""
    private var fontDisplay: Typeface? = null
    private var fontBold: Typeface? = null
    private var fontBody: Typeface? = null

    private fun font(name: String): Typeface? = try {
        Typeface.createFromAsset(assets, "fonts/$name")
    } catch (_: Throwable) {
        null
    }

    private fun loadFonts() {
        if (fontDisplay != null) return
        fontDisplay = font("Anton-Regular.ttf")
        fontBold = font("SpaceGrotesk-Bold.ttf")
        fontBody = font("Inter-Regular.ttf")
    }

    /** Show (or retarget) the full overlay. False = could not add. */
    private fun showBlockedOverlay(pkg: String, label: String): Boolean {
        try {
            val existing = overlayView
            if (existing != null) {
                bindOverlay(existing, pkg, label)
                return true
            }
            val wm = getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return false
            // BACK on the overlay = leave the blocked app (never reveal it).
            val root = object : FrameLayout(this) {
                override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                    if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                        if (event.action == KeyEvent.ACTION_UP) closeBlockedApp()
                        return true
                    }
                    return super.dispatchKeyEvent(event)
                }
            }
            LayoutInflater.from(this).inflate(R.layout.blocked_overlay, root, true)
            loadFonts()
            root.findViewById<TextView>(R.id.overlay_title)?.let { v -> fontDisplay?.let { v.typeface = it } }
            root.findViewById<TextView>(R.id.overlay_sub)?.let { v -> fontBody?.let { v.typeface = it } }
            for (id in intArrayOf(R.id.overlay_back, R.id.overlay_close, R.id.overlay_more)) {
                root.findViewById<TextView>(id)?.let { v -> fontBold?.let { v.typeface = it } }
            }
            root.findViewById<View>(R.id.overlay_back)?.setOnClickListener { backToTask() }
            root.findViewById<View>(R.id.overlay_close)?.setOnClickListener { closeBlockedApp() }
            root.findViewById<View>(R.id.overlay_more)?.setOnClickListener { openMoreOptions() }
            bindOverlay(root, pkg, label)
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.OPAQUE
            )
            // Cover the status bar + cutout too: otherwise the blocked app's
            // own status bar strip shows above the overlay (a black band in
            // light theme, on-device M52).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                lp.fitInsetsTypes = 0
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
            wm.addView(root, lp)
            overlayView = root
            // Dark status-bar icons on the light theme (best-effort: the
            // system may keep the app window's bar appearance).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                try {
                    root.windowInsetsController?.setSystemBarsAppearance(
                        if (isDarkTheme(this)) 0 else android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    )
                } catch (_: Throwable) {
                }
            }
            return true
        } catch (t: Throwable) {
            Log.w(TAG, "overlay add failed for $pkg - falling back to HOME bounce", t)
            overlayView = null
            overlayPkg = null
            return false
        }
    }

    private fun bindOverlay(root: View, pkg: String, label: String) {
        overlayPkg = pkg
        overlayLabel = label
        applyOverlayTheme(root)
        val task = blockingTaskName?.takeIf { it.isNotBlank() }
        try {
            // Website blocks name the site, not the browser.
            val site = if (pkg == domainPkg) domainHitName else null
            val title = when {
                site != null -> "$site is blocked"
                !isListTarget(pkg) && isOverBudget(pkg) -> "$label: today's budget is used up"
                else -> "$label is blocked"
            }
            root.findViewById<TextView>(R.id.overlay_title)?.let {
                it.text = title
                // Long names ("Samsung Browser is blocked") truncated at 40sp.
                it.textSize = if (title.length > 18) 30f else 40f
            }
            root.findViewById<TextView>(R.id.overlay_sub)?.text =
                if (task != null) "You're focusing on $task. Stay with it." else "You're in a focus session. Stay with it."
            root.findViewById<TextView>(R.id.overlay_back)?.text =
                if (task != null) "BACK TO ${task.uppercase()}" else "BACK TO MY TASK"
            root.findViewById<TextView>(R.id.overlay_close)?.text = "CLOSE ${label.uppercase()}"
        } catch (_: Throwable) {
        }
    }

    /** Paint the full overlay in the app theme (tokens.ts). Never throws. */
    private fun applyOverlayTheme(root: View) {
        try {
            val dark = isDarkTheme(this)
            val pal = palette(this)
            root.findViewById<View>(R.id.overlay_root)?.setBackgroundColor(pal.bg)
            root.findViewById<android.widget.ImageView>(R.id.overlay_owl)?.setImageResource(
                if (dark) R.drawable.stayt_owl_blocked_white else R.drawable.stayt_owl_blocked
            )
            root.findViewById<TextView>(R.id.overlay_title)?.setTextColor(pal.ink)
            root.findViewById<TextView>(R.id.overlay_sub)?.setTextColor(pal.muted)
            root.findViewById<TextView>(R.id.overlay_close)?.let {
                it.setTextColor(pal.ink)
                it.setBackgroundResource(if (dark) R.drawable.overlay_btn_secondary else R.drawable.overlay_btn_secondary_light)
            }
            root.findViewById<TextView>(R.id.overlay_more)?.setTextColor(pal.muted)
        } catch (_: Throwable) {
        }
    }

    private fun applyCoverTheme(v: View) {
        try {
            val pal = palette(this)
            v.findViewById<View>(R.id.cover_root)?.setBackgroundColor(pal.bg)
            v.findViewById<android.widget.ImageView>(R.id.cover_owl)?.setImageResource(
                if (isDarkTheme(this)) R.drawable.stayt_owl_blocked_white else R.drawable.stayt_owl_blocked
            )
            v.findViewById<TextView>(R.id.cover_label)?.setTextColor(pal.ink)
        } catch (_: Throwable) {
        }
    }

    /** Theme changed in the app: repaint whatever surfaces are up. Main thread. */
    fun retheme() {
        overlayView?.let { applyOverlayTheme(it) }
        for (v in covers.values) applyCoverTheme(v)
    }

    private fun backToTask() {
        val launch = try { packageManager.getLaunchIntentForPackage(packageName) } catch (_: Throwable) { null }
        launchThenDismiss(launch?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
    }

    private fun openMoreOptions() {
        val pkg = overlayPkg ?: return dismissBlockedOverlay()
        launchThenDismiss(Intent(Intent.ACTION_VIEW, blockedDeepLink(pkg, overlayLabel)).apply {
            setPackage(packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        })
    }

    private fun closeBlockedApp() {
        domainPkg = null
        removeFullOverlay()
        try { performGlobalAction(GLOBAL_ACTION_HOME) } catch (_: Throwable) { }
        // HOME does not close pop-up / PiP windows on every OEM: rescan so
        // a surviving blocked window gets its cover straight away.
        handler.postDelayed({ enforceWindows(allowDismiss = true) }, 600L)
    }

    /**
     * Start StayT while the overlay is still visible (a visible window is a
     * documented BAL exemption), then remove it. Fail-closed: a thrown
     * launch goes HOME; a silently denied one is caught by the rescan —
     * if the blocked app is still visible, it gets covered again.
     */
    private fun launchThenDismiss(intent: Intent?) {
        val launched = try {
            if (intent == null) false else { startActivity(intent); true }
        } catch (t: Throwable) {
            Log.w(TAG, "overlay launch denied", t)
            false
        }
        if (!launched) {
            closeBlockedApp()
            return
        }
        removeFullOverlay()
        handler.postDelayed({ enforceWindows(allowDismiss = true) }, 800L)
    }

    private fun postBlockedNotification(openedPackage: String, appLabel: String) {
        try {
            // Native-M3: one seam — silently skip when POST_NOTIFICATIONS
            // (API 33+) is not granted; the HOME bounce + emit remain.
            if (!canPostNotifications(this)) return
            // Task-aware action text: name the task when known so the tap
            // target is obvious at a glance in the heads-up peek.
            // Same words as the overlay and session note: what is blocked,
            // what you are focusing on, one clear way back.
            val task = try { blockingTaskName?.takeIf { it.isNotBlank() } } catch (_: Exception) { null }
            val actionText = if (task != null) "You're focusing on $task. Tap to go back." else "You're in a focus session. Tap to go back."
            val buttonText = if (task != null) "Back to $task" else "Back to my task"
            val deepLink = blockedDeepLink(openedPackage, appLabel)
            val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            val pending = PendingIntent.getActivity(
                this,
                openedPackage.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val nowNote = System.currentTimeMillis()
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(this, BLOCK_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(this)
            }
            @Suppress("DEPRECATION")
            val notification = builder
                .setContentTitle("$appLabel is blocked")
                .setContentText(actionText)
                .setTicker("$appLabel is blocked")
                .setColor(SESSION_ACCENT)
                .setSmallIcon(R.drawable.ic_stayt_note)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setOngoing(false)
                .setOnlyAlertOnce(false)
                .setWhen(nowNote)
                .setShowWhen(false)
                .setPriority(Notification.PRIORITY_MAX)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setDefaults(Notification.DEFAULT_ALL)
                .addAction(0, buttonText, pending)
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
     * No-overlay (ADR-0005) + heads-up tap path (ADR-0006): best-effort
     * foreground of MainActivity (singleTask) with the blocked deep-link URI
     * so a backgrounded StayT lands straight on the interstitial where the
     * OS still allows it (same-task/recents edge). Resolves via the existing
     * exp+stayt-app scheme intent-filter on MainActivity — no new
     * permissions, no overlay, no full-screen intent. Must never throw: BAL
     * denials (Android 10+, hardened 14/15) are the expected path and fall
     * back to the tap notification, which always fires alongside this call.
     *
     * Exact URI fired:
     * exp+stayt-app://blocked?packageName=<encoded>&label=<encoded>
     */
    private fun foregroundBlockedInterstitial(openedPackage: String, appLabel: String) {
        try {
            val deepLink = blockedDeepLink(openedPackage, appLabel)
            val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(intent)
            Log.d(TAG, "Requested foreground interstitial for $openedPackage")
        } catch (t: Throwable) {
            Log.w(TAG, "Background activity launch blocked for $openedPackage; notification remains the fallback", t)
        }
    }

    /**
     * No-overlay (ADR-0005): retained but currently uncalled — foregrounds
     * StayT on the task picker. Same BAL best-effort semantics as
     * [foregroundBlockedInterstitial] — never throws. Kept as the documented
     * tasks deep-link seam.
     *
     * Exact URI fired: exp+stayt-app://tasks
     * (lands on TaskPicker — App.tsx handler owned by orchestrator).
     */
    private fun foregroundTaskPicker() {
        try {
            val deepLink = Uri.parse(TASKS_DEEP_LINK)
            val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(intent)
            Log.d(TAG, "Requested foreground task picker")
        } catch (t: Throwable) {
            Log.w(TAG, "Background activity launch blocked for task picker; notification remains the fallback", t)
        }
    }

    /**
     * Feed shield: when a shielded section (reels / explore / comments) of an
     * allowed app is on screen, press BACK once (max one per pkg per 10s so
     * it can never fight the user). Hardens feeds, never blocks; callers run
     * it for non-target apps only (hard block wins).
     *
     * Detection reads the live view tree (on-device: tab switches such as
     * Instagram Reels fire no window-state event and carry no "reels" text,
     * so the old event-text match never fired): a known section view id, or
     * — generic across apps — a SELECTED tab named after the section. The
     * event-text keyword match stays as a fallback. Skips while the user is
     * typing. Never throws.
     */
    private fun maybeFeedShield(pkg: String, haystack: String, now: Long) {
        try {
            val rule = feedRules.firstOrNull { it.packageName == pkg && it.enabled } ?: return
            val sections = buildList {
                if (rule.hideReels) add("reels")
                if (rule.hideExplore) add("explore")
                if (rule.hideComments) add("comments")
            }
            if (sections.isEmpty()) return
            if (now - (lastFeedBackAt[pkg] ?: 0L) < FEED_BACK_COOLDOWN_MS) return
            val root = rootInActiveWindow ?: return
            val hit = try {
                if (root.packageName?.toString() != pkg) return
                // Never hijack typing.
                if (root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.isEditable == true) return
                sections.any { sec ->
                    haystack.contains(sec) ||
                        FEED_SECTION_IDS[sec].orEmpty().any { id ->
                            root.findAccessibilityNodeInfosByViewId(id).isNotEmpty()
                        } ||
                        FEED_SECTION_TAB_NAMES[sec].orEmpty().any { name ->
                            root.findAccessibilityNodeInfosByText(name).any { n ->
                                n.isSelected && (n.text?.toString().equals(name, true) ||
                                    n.contentDescription?.toString().equals(name, true))
                            }
                        }
                }
            } finally {
                try { @Suppress("DEPRECATION") root.recycle() } catch (_: Throwable) { }
            }
            if (!hit) return
            lastFeedBackAt[pkg] = now
            val ok = performGlobalAction(GLOBAL_ACTION_BACK)
            Log.d(TAG, "feed shield BACK in $pkg -> $ok")
        } catch (t: Throwable) {
            Log.w(TAG, "maybeFeedShield failed for $pkg", t)
        }
    }

    /** Trailing-edge throttle for content-change driven feed checks. */
    private var feedCheckPending = false
    private fun requestFeedCheck(pkg: String) {
        if (feedCheckPending) return
        feedCheckPending = true
        handler.postDelayed({
            feedCheckPending = false
            if (isBlocking && !isBlockedPkg(pkg)) maybeFeedShield(pkg, "", System.currentTimeMillis())
        }, 250L)
    }

    /**
     * Remove every block surface (full overlay + window covers).
     * Idempotent, never throws. Bridge callers (setBlocking/pause/JS
     * interstitial mount) run off the main thread, so removal always hops
     * to the main looper that added the views.
     */
    fun dismissBlockedOverlay() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            handler.post { dismissBlockedOverlay() }
            return
        }
        domainPkg = null
        removeFullOverlay()
        removeCovers()
    }

    private fun removeFullOverlay() {
        val v = overlayView ?: return
        overlayView = null
        overlayPkg = null
        try {
            (getSystemService(Context.WINDOW_SERVICE) as? WindowManager)?.removeViewImmediate(v)
        } catch (t: Throwable) {
            Log.w(TAG, "overlay remove failed", t)
        }
    }

    private fun removeCovers() {
        if (covers.isEmpty()) return
        val wm = getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        for (v in covers.values) {
            try { wm?.removeViewImmediate(v) } catch (_: Throwable) { }
        }
        covers.clear()
        pausedPipWindows.clear()
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
        // Ongoing session note must die with enforcement — never orphan it.
        try {
            cancelSessionNotification()
        } catch (e: Exception) {
            Log.w(TAG, "session note cancel on destroy failed", e)
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
