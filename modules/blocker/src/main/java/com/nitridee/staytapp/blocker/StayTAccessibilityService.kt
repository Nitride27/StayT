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
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
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
        private const val SESSION_CHANNEL_ID = "stayt_session"
        private const val SESSION_CHANNEL_NAME = "Ongoing session"
        private const val SESSION_NOTIFICATION_ID = 57001
        private const val SESSION_TAP_REQ = 7001
        // 5s refresh: the note carries live HRS/MINS/SECS boxes (a per-minute
        // tick froze SECS at :00 and read as a stuck counter). Silent same-ID
        // updates, no sound/vibration — comparable to any timer app.
        private const val SESSION_TICK_MS = 5_000L
        // ectoGreen accent for the small icon (mirrors theme tokens).
        // Signed decimal for 0xFF58CC02 — a raw 0xFF… literal overflows
        // Kotlin Int and will not compile.
        private const val SESSION_ACCENT = -10957822
        @Volatile
        private var sessionStartMs: Long = 0L
        private var sessionTick: Runnable? = null
        // Note-lifecycle flag, independent of isBlocking: an intention
        // break pauses enforcement but the SESSION continues, so the note +
        // ticker must survive pauseBlocking (which flips isBlocking false and
        // used to starve the ticker dead — frozen 00:00 until the next
        // setBlocking). Only cancelSessionNotification clears this.
        @Volatile
        private var sessionNoteOn = false
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
            // Ongoing session note (ADR-0007): mirrors enforcement — up
            // while blocking, gone the moment it stops. pauseBlocking
            // deliberately leaves it posted (a break is still an active
            // session; only setBlocking(false) ends enforcement).
            if (!blocking) cancelSessionNotification() else postSessionNotification(instance)
            // No-overlay (ADR-0005): dismiss is a no-op shim kept for the JS seam.
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

            // No-overlay (ADR-0005): dismiss is a no-op shim kept for the JS seam.
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
                // The session note survives breaks (session never ended) —
                // refresh immediately so no stale text lingers.
                refreshSessionNotification()
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
         * Ongoing session note, music-player style (ADR-0007): persistent,
         * non-dismissible (ongoing) status note while blocking is enforced —
         * "StayT · <task>" + live elapsed — whose tap resumes the app on the
         * session screen. Plain NotificationManager.post, so POST_NOTIFICATIONS
         * denial (API 33+) silently skips via [canPostNotifications] and no
         * foreground-service permission/type is ever needed. Never throws.
         */
        fun postSessionNotification(ctx: Context?) {
            try {
                val c = ctx ?: appCtx ?: return
                if (!canPostNotifications(c)) return
                ensureSessionChannel(c)
                val now = System.currentTimeMillis()
                // Elapsed base: the persisted blocking-start survives process
                // death, so a re-armed note keeps counting the same session.
                if (sessionStartMs <= 0L) {
                    sessionStartMs = try {
                        c.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
                            .getLong(STATE_KEY_AT, 0L).takeIf { it > 0L } ?: now
                    } catch (_: Exception) {
                        now
                    }
                }
                buildAndNotifySession(c, now)
                sessionNoteOn = true
                startSessionTicker()
            } catch (e: Exception) {
                Log.w(TAG, "postSessionNotification failed", e)
            }
        }

        /** Silent elapsed refresh of the session note. Never throws. */
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

        /** Drop the session note + ticker. Idempotent. Never throws. */
        fun cancelSessionNotification() {
            try {
                try {
                    sessionTick?.let { handler.removeCallbacks(it) }
                } catch (_: Exception) {
                }
                sessionTick = null
                sessionNoteOn = false
                sessionStartMs = 0L
                val c = instance ?: appCtx ?: return
                try {
                    c.getSystemService(NotificationManager::class.java)?.cancel(SESSION_NOTIFICATION_ID)
                } catch (_: Exception) {
                }
            } catch (e: Exception) {
                Log.w(TAG, "cancelSessionNotification failed", e)
            }
        }

        /** Session channel: LOW (silent, persistent) + upgrade sweep. Never throws. */
        private fun ensureSessionChannel(ctx: Context) {
            try {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
                val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
                try {
                    val existing = nm.getNotificationChannel(SESSION_CHANNEL_ID)
                    if (existing != null && existing.importance != NotificationManager.IMPORTANCE_NONE &&
                        existing.importance != NotificationManager.IMPORTANCE_LOW
                    ) {
                        try { nm.deleteNotificationChannel(SESSION_CHANNEL_ID) } catch (_: Exception) { }
                    }
                } catch (_: Exception) { }
                val channel = NotificationChannel(
                    SESSION_CHANNEL_ID,
                    SESSION_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_LOW
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
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(ctx, SESSION_CHANNEL_ID)
            } else {
                Notification.Builder(ctx)
            }
            // Small icon MUST be a white alpha silhouette (Play-compliant) —
            // the tile bolt vector is exactly that, reused, no new asset.
            // Rich card (icon tile + HRS/MINS/SECS boxes): custom content on
            // N+ via DecoratedCustomViewStyle; title/text below double as the
            // fallback, lockscreen line, and accessibility text. Lockscreen is
            // covered by VISIBILITY_PUBLIC here + on the channel.
            val (eh, em, es) = sessionElapsedParts(now)
            val pad2 = { v: Long -> v.toString().padStart(2, '0') }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    val card = android.widget.RemoteViews(ctx.packageName, R.layout.session_note)
                    try { card.setTextViewText(R.id.session_title, "StayT · $task") } catch (_: Exception) { }
                    try { card.setTextViewText(R.id.session_sub, sessionElapsedText(now)) } catch (_: Exception) { }
                    try { card.setTextViewText(R.id.session_hrs, pad2(eh)) } catch (_: Exception) { }
                    try { card.setTextViewText(R.id.session_mins, pad2(em)) } catch (_: Exception) { }
                    try { card.setTextViewText(R.id.session_secs, pad2(es)) } catch (_: Exception) { }
                    builder.setStyle(Notification.DecoratedCustomViewStyle())
                    builder.setCustomContentView(card)
                    builder.setCustomBigContentView(card)
                } catch (e: Exception) {
                    Log.w(TAG, "session card failed, standard template", e)
                }
            }
            builder
                .setContentTitle("StayT · $task")
                .setContentText(sessionElapsedText(now))
                .setSmallIcon(R.drawable.ic_stayt_tile)
                .setColor(SESSION_ACCENT)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setWhen(sessionStartMs)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                // Explicit setPriority call (not Kotlin property syntax):
                // the synthetic `priority` accessor does not resolve
                // against this deprecated Java setter and breaks the build.
                try { builder.setPriority(Notification.PRIORITY_LOW) } catch (_: Exception) { }
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

        private fun sessionElapsedParts(now: Long): Triple<Long, Long, Long> {
            return try {
                val base = if (sessionStartMs > 0L) sessionStartMs else now
                val totalSec = maxOf(0L, (now - base) / 1000L)
                Triple(totalSec / 3600, (totalSec % 3600) / 60, totalSec % 60)
            } catch (_: Exception) {
                Triple(0L, 0L, 0L)
            }
        }

        private fun sessionElapsedText(now: Long): String {
            return try {
                val (h, m, s) = sessionElapsedParts(now)
                val fmt = if (h > 0) "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
                    else "${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}"
                "$fmt in focus · tap to return"
            } catch (_: Exception) {
                "In focus · tap to return"
            }
        }

        private fun startSessionTicker() {
            try {
                try {
                    sessionTick?.let { handler.removeCallbacks(it) }
                } catch (_: Exception) {
                }
                val r = object : Runnable {
                    override fun run() {
                        try {
                            // Stopped meanwhile: do not reschedule — the
                            // cancel path owns teardown. Gated on the note
                            // flag (not isBlocking) so breaks don't kill it.
                            if (!sessionNoteOn) return
                            refreshSessionNotification()
                        } catch (e: Exception) {
                            Log.w(TAG, "session tick failed", e)
                        } finally {
                            try {
                                if (sessionNoteOn) handler.postDelayed(this, SESSION_TICK_MS)
                            } catch (_: Exception) {
                            }
                        }
                    }
                }
                sessionTick = r
                handler.postDelayed(r, SESSION_TICK_MS)
            } catch (e: Exception) {
                Log.w(TAG, "startSessionTicker failed", e)
            }
        }

        /**
         * No-overlay (ADR-0005): no-op seam. The JS interstitial still calls
         * this on mount; with no native window it trivially succeeds.
         * Never throws.
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

    // No-overlay (ADR-0005): no native window is ever added, so there is no
    // overlay view, timeout, or countdown state. dismissBlockedOverlay()
    // below is a no-op shim kept for the JS seam.

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
            // Session-note re-arm (ADR-0007): a process death between
            // setBlocking(true) and (false) leaves a stale ongoing note with
            // NOBODY owning its ticker (statics are lost on death). Re-post
            // when enforcement is re-armed (elapsed continues from the
            // persisted start); otherwise sweep the orphan.
            try {
                if (isBlocking) postSessionNotification(this) else cancelSessionNotification()
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
        // Evaluated BEFORE any counting, so bursts never inflate the
        // budget opens meter.
        // Order on a qualifying open: cooldown -> budget count (telemetry
        // only, never allows) -> HOME bounce + emit + notification.
        // Hard blocks always win.
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
        // notification below, over or under budget.
        if (domainHit == null) {
            try {
                countBudgetOpen(openedPackage, dayKey(now))
            } catch (e: Exception) {
                Log.w(TAG, "budget meter failed for $openedPackage", e)
            }
        }

        // No-overlay (ADR-0005): native friction wait retired — the JS
        // interstitial owns the breathe gate (BlockedInterstitialScreen reads
        // the same prefs). Every qualifying open takes the HOME + emit +
        // notification path below unconditionally.

        // Package is blocked - bounce to HOME. If the bounce is denied or
        // throttled, do NOT silently return: the emit + notification below
        // remain the enforcement path instead.
        // Every qualifying open bounces: the budget meter above counts
        // only and never exempts.
        //
        // No-overlay block pattern (ADR-0005): at most ONE GLOBAL_ACTION_HOME
        // per debounced open. HOME only backgrounds the target process (it
        // never kills or crashes it). No native window exists anymore, so the
        // bounce always fires — no skip, no race with an overlay window token.
        // Denial/throttle falls through to the emit + notification below (the
        // notification tap deep-link is the BAL-safe foreground path).
        Log.d(TAG, "Blocked app: $openedPackage")
        // Throwable (not just Exception): this service shares StayT's process,
        // so anything escaping here kills the whole app, not just the block.
        val bounced = try {
            performGlobalAction(GLOBAL_ACTION_HOME)
        } catch (t: Throwable) {
            Log.w(TAG, "performGlobalAction threw for $openedPackage - emit + notification remain", t)
            false
        }
        if (!bounced) {
            Log.w(TAG, "performGlobalAction denied/throttled for $openedPackage - emit + notification remain")
            // Deliberately KEEP the per-package cooldown entry: dropping it
            // would let the next burst of window events re-enter immediately
            // — re-counting budget opens, re-emitting to JS — instead of
            // debouncing.
        }

        // Emit event to React Native (label travels with it — no per-block
        // app-list scan on the JS side).
        AppBlockerModule.emitBlockedAttempt(openedPackage, now, appLabel)

        // Best-effort direct foreground (ADR-0006): same-task/recents edge
        // only. BAL denies background startActivity on Android 10+ (hardened
        // 14/15), so denial is the expected path — the notification below
        // always fires regardless. Never throws, no new permission.
        try {
            foregroundBlockedInterstitial(openedPackage, appLabel)
        } catch (t: Throwable) {
            Log.w(TAG, "best-effort foreground failed for $openedPackage; notification remains", t)
        }

        // Play-safe heads-up notification whose tap deep-links back into
        // StayT (label embedded — JS resolves taskId like App.tsx does).
        // No SYSTEM_ALERT_WINDOW, no full-screen intent (ADR-0006).
        postBlockedNotification(openedPackage, appLabel)

        // No-overlay (ADR-0005) + heads-up tap path (ADR-0006): the JS
        // interstitial is reached via the onBlockedAttempt emit (live
        // runtime), the best-effort foreground above (same-task edge), or
        // the notification tap (dead runtime / BAL-denied — the reliable
        // path). No native window is ever added; no new permissions.
    }

    private fun postBlockedNotification(openedPackage: String, appLabel: String) {
        try {
            // Native-M3: one seam — silently skip when POST_NOTIFICATIONS
            // (API 33+) is not granted; the HOME bounce + emit remain.
            if (!canPostNotifications(this)) return
            // Task-aware action text: name the task when known so the tap
            // target is obvious at a glance in the heads-up peek.
            val task = try { blockingTaskName?.takeIf { it.isNotBlank() } } catch (_: Exception) { null }
            val actionText = if (task != null) "Tap to return to $task" else "Tap to return to your task"
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
                .setContentTitle("StayT blocked $appLabel")
                .setContentText(actionText)
                .setTicker("StayT blocked $appLabel")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
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
                .addAction(0, "Return to task", pending)
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
     * No-overlay (ADR-0005): harmless no-op shim. No native window is ever
     * added, so there is nothing to dismiss. Kept — with the bridge method
     * AppBlockerModule.dismissBlockedOverlay and the companion dismissOverlay
     * — so the JS seam needs zero changes (the interstitial still calls it
     * on mount). Never throws.
     */
    private fun dismissBlockedOverlay() {
        // Intentionally empty: no overlay exists to remove.
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
