package com.nitridee.staytapp.blocker

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
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
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class AppBlockerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "StayTAppBlocker"
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
            val enabledServices = Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""

            val componentName = "${reactApplicationContext.packageName}/com.nitridee.staytapp.blocker.StayTAccessibilityService"
            promise.resolve(enabledServices.contains(componentName))
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

    @ReactMethod
    fun startBlocking(blocked: ReadableArray?, promise: Promise) {
        try {
            if (blocked == null) {
                promise.reject("INVALID_ARGS", "blockedPackages is null")
                return
            }
            val blockedPackages = blocked.toArrayList().map { it.toString() }
            StayTAccessibilityService.setBlocking(blocking = true, blocked = blockedPackages)
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
        val params = Arguments.createMap().apply {
            putString("packageName", packageName)
            putDouble("timestamp", timestamp.toDouble())
            putString("appLabel", appLabel)
        }
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onBlockedAttempt", params)
    }
}
