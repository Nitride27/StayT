package com.nitridee.staytapp.blocker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import java.util.concurrent.ConcurrentHashMap

class StayTAccessibilityService : AccessibilityService() {
    companion object {
        private const val TAG = "StayTAccessibility"
        var instance: StayTAccessibilityService? = null
            private set

        @Volatile
        private var isBlocking = false
        private val blockedPackages: MutableSet<String> = ConcurrentHashMap.newKeySet()
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

        val packageName = event.packageName?.toString() ?: return

        // Allow our own package
        if (packageName == "com.nitridee.staytapp") return

        // Check if package is in the blocked set
        if (blockedPackages.isEmpty() || !blockedPackages.contains(packageName)) return

        // Package is blocked - perform global action to go HOME
        Log.d(TAG, "Blocked app: $packageName")
        performGlobalAction(GLOBAL_ACTION_HOME)

        // Emit event to React Native
        AppBlockerModule.emitBlockedAttempt(packageName, System.currentTimeMillis())
    }

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        instance = null
        isBlocking = false
        blockedPackages.clear()
        pauseRunnable?.let { handler.removeCallbacks(it) }
        pauseRunnable = null
        super.onDestroy()
        Log.d(TAG, "Accessibility service destroyed")
    }
}
