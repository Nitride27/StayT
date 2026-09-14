package com.nitridee.staytapp.blocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BOOT_COMPLETED + MY_PACKAGE_REPLACED (L4: an app update kills alarms the
 * same way a reboot does): alarms do not survive either, so reprogram
 * everything from the SharedPreferences mirror. No JS bridge involved — the
 * store is not running yet at boot; the mirror is the only source available,
 * and reprogramFromMirror also applies the current window (booting inside
 * focus hours starts blocking as soon as the service connects).
 * Empty/missing mirror = cancel-all + silent no-op.
 */
class ScheduleBootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "StayTScheduleBoot"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) return
        try {
            val action = intent?.action
            if (action != Intent.ACTION_BOOT_COMPLETED &&
                action != Intent.ACTION_MY_PACKAGE_REPLACED
            ) return
            Log.d(TAG, "boot/replace completed; reprogramming schedule alarms from mirror")
            try {
                ScheduleAlarmScheduler.reprogramFromMirror(context)
            } catch (e: Exception) {
                Log.w(TAG, "boot reprogram failed", e)
            }
            // P2-1: alarms do not survive reboot — re-arm the widget midnight
            // rollover and repaint from the mirror (app is dead at boot).
            try {
                WidgetData.programMidnightAlarm(context)
            } catch (e: Exception) {
                Log.w(TAG, "widget alarm re-arm failed", e)
            }
            try {
                StayTWidgetProvider.refreshAll(context)
            } catch (e: Exception) {
                Log.w(TAG, "widget boot refresh failed", e)
            }
        } catch (e: Exception) {
            Log.e(TAG, "onReceive failed", e)
        }
    }
}
