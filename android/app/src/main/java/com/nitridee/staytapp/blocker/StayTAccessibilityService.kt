package com.nitridee.staytapp.blocker

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent

class StayTAccessibilityService : AccessibilityService() {
    companion object {
        private const val TAG = "StayTAccessibility"
        var instance: StayTAccessibilityService? = null
            private set

        private var isBlocking = false
        private var allowedPackages = mutableSetOf<String>()

        fun setBlocking(blocking: Boolean, allowed: List<String> = emptyList()) {
            isBlocking = blocking
            allowedPackages.clear()
            allowedPackages.addAll(allowed)
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

        // Check if package is allowed
        if (allowedPackages.isNotEmpty() && allowedPackages.contains(packageName)) return

        // Package is blocked - perform global action to go HOME
        Log.d(TAG, "Blocked app: $packageName")
        performGlobalAction(GLOBAL_ACTION_HOME)

        // Broadcast to React Native
        val intent = Intent("com.nitridee.staytapp.BLOCKED_ATTEMPT").apply {
            putExtra("packageName", packageName)
            putExtra("timestamp", System.currentTimeMillis())
        }
        sendBroadcast(intent)
    }

    override fun onInterrupt() {
        Log.d(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
        Log.d(TAG, "Accessibility service destroyed")
    }
}
