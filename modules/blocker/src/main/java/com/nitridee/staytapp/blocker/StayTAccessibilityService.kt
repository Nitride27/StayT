package com.nitridee.staytapp.blocker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
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
        private val blockedPackages: MutableSet<String> = ConcurrentHashMap.newKeySet()
        private val lastBlockedAt: MutableMap<String, Long> = ConcurrentHashMap()
        private val handler = Handler(Looper.getMainLooper())
        private var pauseRunnable: Runnable? = null

        fun setBlocking(blocking: Boolean, blocked: List<String> = emptyList()) {
            isBlocking = blocking
            blockedPackages.clear()
            blockedPackages.addAll(blocked)
            // A (re)start or stop invalidates a scheduled pause-resume —
            // otherwise ending a session mid-override re-enables blocking
            // later with no session (phantom blocks).
            pauseRunnable?.let { handler.removeCallbacks(it) }
            pauseRunnable = null
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
        if (!performGlobalAction(GLOBAL_ACTION_HOME)) {
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

        // Best-effort auto-popup: foreground our (possibly backgrounded) task
        // straight into the interstitial via the same blocked deep link App.tsx
        // already handles (Linking → parseBlockedDeepLink → BlockedInterstitial).
        // BAL restrictions vary by Android version/OEM — failure is silent,
        // the notification above remains the fallback. No new permissions.
        foregroundBlockedInterstitial(openedPackage, appLabel)

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
        } catch (e: Exception) {
            Log.w(TAG, "postBlockedNotification failed for $openedPackage", e)
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
        } catch (e: Exception) {
            Log.w(TAG, "Background activity launch blocked for $openedPackage; notification remains the fallback", e)
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
        } catch (e: Exception) {
            Log.w(TAG, "Background activity launch blocked for task picker; notification remains the fallback", e)
        }
    }

    /**
     * Show the fullscreen block overlay for [openedPackage]. Single instance:
     * any existing overlay is removed first, never stacked. Auto-dismisses
     * after 30s via [overlayHandler]. Must never throw — on any failure the
     * notification + HOME bounce above remain the fallbacks.
     */
    private fun showBlockedOverlay(openedPackage: String, appLabel: String) {
        try {
            // Single instance: replace, never stack.
            dismissBlockedOverlay()
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                Log.w(TAG, "overlay skipped for $openedPackage: TYPE_ACCESSIBILITY_OVERLAY needs API 26+")
                return
            }
            val wm = getSystemService(WINDOW_SERVICE) as? WindowManager
            if (wm == null) {
                Log.w(TAG, "overlay skipped for $openedPackage: no WindowManager")
                return
            }
            val root = try {
                buildOverlayView(openedPackage, appLabel)
            } catch (e: Exception) {
                Log.w(TAG, "buildOverlayView failed for $openedPackage", e)
                null
            } ?: return
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
            Log.d(TAG, "Overlay shown for $openedPackage")
        } catch (e: Exception) {
            Log.w(TAG, "showBlockedOverlay failed for $openedPackage", e)
            try {
                dismissBlockedOverlay()
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Remove the overlay if present and cancel its 30s timeout. Idempotent —
     * safe to call when no overlay is showing.
     */
    private fun dismissBlockedOverlay() {
        try {
            overlayTimeoutRunnable?.let { overlayHandler.removeCallbacks(it) }
            overlayTimeoutRunnable = null
            val view = overlayView
            overlayView = null
            overlayBlockedPackage = null
            if (view != null) {
                try {
                    (getSystemService(WINDOW_SERVICE) as? WindowManager)?.removeView(view)
                    Log.d(TAG, "Overlay dismissed")
                } catch (e: Exception) {
                    Log.w(TAG, "removeView failed", e)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "dismissBlockedOverlay failed", e)
        }
    }

    /**
     * Build the overlay content programmatically: fullscreen black (#000),
     * bold white headline + blocked-app label, three green (#58CC02)
     * actions — BACK TO TASK (filled), SWITCH TASK (outline),
     * 2-MIN OVERRIDE (outline). Every button dismisses the overlay first.
     */
    private fun buildOverlayView(openedPackage: String, appLabel: String): LinearLayout {
        val density = resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()
        val green = Color.parseColor(GREEN_ACCENT)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            // Swallow touches so the blocked app underneath can't be used.
            isClickable = true
            isFocusable = true
            setPadding(dp(32), dp(48), dp(32), dp(48))
        }

        val headline = TextView(this).apply {
            text = "THIS ISN'T PART OF YOUR TASK"
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            gravity = Gravity.CENTER
        }
        try {
            val owl = ImageView(this).apply {
                setImageResource(R.drawable.stayt_owl_blocked)
            }
            root.addView(
                owl,
                LinearLayout.LayoutParams(dp(180), dp(180)).apply {
                    gravity = Gravity.CENTER
                    bottomMargin = dp(24)
                }
            )
        } catch (e: Exception) {
            Log.w(TAG, "overlay mascot missing, continuing without it", e)
        }
        root.addView(
            headline,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        )

        val labelView = TextView(this).apply {
            text = appLabel
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
        }
        root.addView(
            labelView,
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
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply {
                setColor(green)
                cornerRadius = dp(16).toFloat()
            }
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        fun outlineButton(label: String): Button = Button(this).apply {
            text = label
            setTextColor(green)
            setTypeface(typeface, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                setStroke(dp(2), green)
                cornerRadius = dp(16).toFloat()
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
            } catch (e: Exception) {
                Log.w(TAG, "BACK TO TASK action failed", e)
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
            } catch (e: Exception) {
                Log.w(TAG, "SWITCH TASK action failed", e)
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
