package com.nitridee.staytapp.blocker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import java.util.concurrent.ConcurrentHashMap

class StayTAccessibilityService : AccessibilityService() {
    companion object {
        private const val TAG = "StayTAccessibility"
        private const val BLOCK_COOLDOWN_MS = 1000L
        private const val BLOCK_CHANNEL_ID = "stayt_blocked"
        private const val BLOCK_CHANNEL_NAME = "Blocked apps"

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
        }

        fun pauseBlocking(seconds: Long) {
            Log.d(TAG, "Pausing blocking for $seconds seconds")
            isBlocking = false

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
        if (!isBlocking) return

        val openedPackage = event.packageName?.toString() ?: return

        // Allow our own package
        if (openedPackage == packageName) return

        // Check if package is in the blocked set
        if (blockedPackages.isEmpty() || !blockedPackages.contains(openedPackage)) return

        // Per-package cooldown: WINDOW_STATE_CHANGED fires in bursts
        val now = System.currentTimeMillis()
        val last = lastBlockedAt[openedPackage] ?: 0L
        if (now - last < BLOCK_COOLDOWN_MS) return
        lastBlockedAt[openedPackage] = now

        // Package is blocked - perform global action to go HOME
        Log.d(TAG, "Blocked app: $openedPackage")
        if (!performGlobalAction(GLOBAL_ACTION_HOME)) {
            Log.w(TAG, "performGlobalAction denied/throttled for $openedPackage")
            lastBlockedAt.remove(openedPackage)
            return
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
    }

    private fun postBlockedNotification(openedPackage: String, appLabel: String) {
        try {
            val deepLink = Uri.parse(
                "exp+stayt-app://blocked?packageName=${Uri.encode(openedPackage)}&label=${Uri.encode(appLabel)}"
            )
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
     */
    private fun foregroundBlockedInterstitial(openedPackage: String, appLabel: String) {
        try {
            val deepLink = Uri.parse(
                "exp+stayt-app://blocked?packageName=${Uri.encode(openedPackage)}&label=${Uri.encode(appLabel)}"
            )
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

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
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
