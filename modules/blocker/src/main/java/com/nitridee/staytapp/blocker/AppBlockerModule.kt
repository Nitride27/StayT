package com.nitridee.staytapp.blocker

import android.content.Context
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class AppBlockerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private var instance: AppBlockerModule? = null

        fun emitBlockedAttempt(packageName: String, timestamp: Long) {
            instance?.emitToJS(packageName, timestamp)
        }
    }

    init {
        instance = this
    }

    override fun getName(): String = "AppBlocker"

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        val enabledServices = Settings.Secure.getString(
            reactApplicationContext.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""

        val componentName = "${reactApplicationContext.packageName}/com.nitridee.staytapp.blocker.StayTAccessibilityService"
        val isEnabled = enabledServices.contains(componentName)
        promise.resolve(isEnabled)
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun startBlocking(blockedPackages: List<String>) {
        StayTAccessibilityService.setBlocking(blocking = true, blocked = blockedPackages)
    }

    @ReactMethod
    fun stopBlocking() {
        StayTAccessibilityService.setBlocking(blocking = false)
    }

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        val pm = reactApplicationContext.packageManager
        val apps = pm.getInstalledApplications(0)
            .filter { pm.getLaunchIntentForPackage(it.packageName) != null }
            .map { appInfo ->
                val map = Arguments.createMap()
                map.putString("packageName", appInfo.packageName)
                map.putString("appName", pm.getApplicationLabel(appInfo).toString())
                map
            }
        val result = Arguments.createArray()
        apps.forEach { result.pushMap(it) }
        promise.resolve(result)
    }

    @ReactMethod
    fun pauseBlocking(seconds: Double) {
        StayTAccessibilityService.pauseBlocking(seconds.toLong())
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

    private fun emitToJS(packageName: String, timestamp: Long) {
        val params = Arguments.createMap().apply {
            putString("packageName", packageName)
            putDouble("timestamp", timestamp.toDouble())
        }
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onBlockedAttempt", params)
    }
}
