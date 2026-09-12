package com.nitridee.staytapp.blocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BOOT_COMPLETED: alarms do not survive reboot, so reprogram everything from
 * the SharedPreferences mirror. No JS bridge involved — the store is not
 * running yet at boot; the mirror is the only source available, and
 * reprogramFromMirror also applies the current window (booting inside focus
 * hours starts blocking as soon as the service connects). Empty/missing
 * mirror = cancel-all + silent no-op.
 */
class ScheduleBootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "StayTScheduleBoot"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) return
        try {
            if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
            Log.d(TAG, "boot completed; reprogramming schedule alarms from mirror")
            try {
                ScheduleAlarmScheduler.reprogramFromMirror(context)
            } catch (e: Exception) {
                Log.w(TAG, "boot reprogram failed", e)
            }
        } catch (e: Exception) {
            Log.e(TAG, "onReceive failed", e)
        }
    }
}
