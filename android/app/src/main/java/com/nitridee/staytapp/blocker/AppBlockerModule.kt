package com.nitridee.staytapp.blocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings
import android.text.TextUtils
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class AppBlockerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var receiver: BroadcastReceiver? = null

    override fun getName(): String = "AppBlockerModule"

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        val service = reactApplicationContext
            .getSystemService(Context.ACCESSIBILITY_SERVICE) as android.view.accessibility.AccessibilityManager
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
        StayTAccessibilityService.setBlocking(blocking = true, allowed = blockedPackages)
    }

    @ReactMethod
    fun stopBlocking() {
        StayTAccessibilityService.setBlocking(blocking = false)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for NativeEventEmitter
    }

    fun startListening() {
        val filter = IntentFilter("com.nitridee.staytapp.BLOCKED_ATTEMPT")
        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val packageName = intent.getStringExtra("packageName") ?: return
                val timestamp = intent.getLongExtra("timestamp", System.currentTimeMillis())
                val params = Arguments.createMap().apply {
                    putString("packageName", packageName)
                    putDouble("timestamp", timestamp.toDouble())
                }
                emit("onBlockedAttempt", params)
            }
        }
        reactApplicationContext.registerReceiver(receiver, filter)
    }

    fun stopListening() {
        receiver?.let {
            reactApplicationContext.unregisterReceiver(it)
            receiver = null
        }
    }

    override fun invalidate() {
        stopListening()
        super.invalidate()
    }

    private fun emit(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }
}
