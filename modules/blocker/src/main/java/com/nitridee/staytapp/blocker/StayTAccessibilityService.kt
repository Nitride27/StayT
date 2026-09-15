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
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.nitridee.staytapp.R
import java.util.concurrent.ConcurrentHashMap

class StayTAccessibilityService : AccessibilityService() {
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
                    .apply()
            } catch (e: Exception) {
                Log.w(TAG, "persistDesiredState failed", e)
            }
        }

        fun setBlocking(blocking: Boolean, blocked: List<String> = emptyList(), taskName: String? = null) {
            isBlocking = blocking
            blockingTaskName = if (blocking) taskName?.takeIf { it.isNotBlank() } else null
            blockedPackages.clear()
            blockedPackages.addAll(blocked)
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
            Log.d(TAG, "Pausing blocking for $seconds seconds")
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
            handler.postDelayed(pauseRunnable!!, seconds * 1000)
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
    }

    private var overlayView: View? = null
    private var overlayBlockedPackage: String? = null
    private val overlayHandler = Handler(Looper.getMainLooper())
    private var overlayTimeoutRunnable: Runnable? = null

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
        } catch (e: Exception) {
            Log.w(TAG, "durable intent re-arm failed", e)
        }

        serviceInfo = serviceInfo.apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 100
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

        // Check if package is in the blocked set
        if (blockedPackages.isEmpty() || !blockedPackages.contains(openedPackage)) return

        // Per-package cooldown: WINDOW_STATE_CHANGED fires in bursts
        val now = System.currentTimeMillis()
        val last = lastBlockedAt[openedPackage] ?: 0L
        if (now - last < BLOCK_COOLDOWN_MS) return
        lastBlockedAt[openedPackage] = now

        // Package is blocked - bounce to HOME. If the bounce is denied or
        // throttled, do NOT silently return: the overlay below swallows
        // touches and becomes the enforcement surface instead.
        Log.d(TAG, "Blocked app: $openedPackage")
        // Throwable (not just Exception): this service shares StayT's process,
        // so anything escaping here kills the whole app, not just the block.
        val bounced = try {
            performGlobalAction(GLOBAL_ACTION_HOME)
        } catch (t: Throwable) {
            Log.w(TAG, "performGlobalAction threw for $openedPackage - overlay will enforce", t)
            false
        }
        if (!bounced) {
            Log.w(TAG, "performGlobalAction denied/throttled for $openedPackage - overlay will enforce")
            lastBlockedAt.remove(openedPackage)
        }

        // Resolve the display label once — shared by emit, notification, deep link.
        val appLabel = try {
            val info = packageManager.getApplicationInfo(openedPackage, 0)
            packageManager.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            openedPackage
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
        showBlockedOverlay(openedPackage, appLabel)
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
                        overlayTimeoutRunnable = Runnable {
                            try {
                                dismissBlockedOverlay()
                            } catch (e: Exception) {
                                Log.w(TAG, "overlay timeout dismiss failed", e)
                            }
                        }
                        overlayHandler.postDelayed(overlayTimeoutRunnable!!, OVERLAY_TIMEOUT_MS)
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
        val anton = try { Typeface.createFromAsset(assets, "fonts/Anton-Regular.ttf") } catch (_: Exception) { null }
        val grotesk = try { Typeface.createFromAsset(assets, "fonts/SpaceGrotesk-Bold.ttf") } catch (_: Exception) { null }
        val inter = try { Typeface.createFromAsset(assets, "fonts/Inter-Regular.ttf") } catch (_: Exception) { null }

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
        pauseRunnable?.let { handler.removeCallbacks(it) }
        pauseRunnable = null
        super.onDestroy()
        Log.d(TAG, "Accessibility service destroyed")
    }
}
