package com.nitridee.staytapp.blocker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log

/**
 * Fires for SCHEDULE_START / SCHEDULE_STOP alarms programmed by
 * [ScheduleAlarmScheduler]. All work is tiny (prefs read + static flags +
 * maybe one notification) so it runs inline; every step is try/catch.
 *
 * Overlap rule: both START and STOP re-evaluate the UNION of currently-active
 * windows from the mirror. A STOP while another window is still active keeps
 * blocking alive with the union packages instead of unblocking prematurely.
 * A START cancels any active 2-min override (setBlocking clears the pause
 * timer) — the schedule wins over the break, by design.
 */
class ScheduleAlarmReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "StayTScheduleAlarm"
        private const val BLOCK_CHANNEL_ID = "stayt_blocked"
        private const val BLOCK_CHANNEL_NAME = "Blocked apps"
        private const val FOCUS_ON_NOTIFICATION_ID = 43001
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return
        try {
            val action = intent.action ?: return
            if (action != ScheduleAlarmScheduler.ACTION_START &&
                action != ScheduleAlarmScheduler.ACTION_STOP
            ) return
            val idx = try { intent.getIntExtra("schedule_index", -1) } catch (_: Exception) { -1 }
            Log.d(TAG, "alarm fired: $action idx=$idx")

            try {
                val schedules = ScheduleAlarmScheduler.load(context)
                val union = ScheduleAlarmScheduler.unionActive(schedules, System.currentTimeMillis())
                if (action == ScheduleAlarmScheduler.ACTION_START) {
                    if (union.isNotEmpty()) {
                        StayTAccessibilityService.setBlocking(true, union)
                        Log.d(TAG, "START idx=$idx: blocking ${union.size} pkgs")
                        notifyFocusOn(context)
                    } else {
                        Log.w(TAG, "START idx=$idx fired with no active window (clock shifted?); reprogramming")
                    }
                } else {
                    if (union.isNotEmpty()) {
                        // Overlapping schedule still active — stay blocked.
                        StayTAccessibilityService.setBlocking(true, union)
                        Log.d(TAG, "STOP idx=$idx: overlap active, keeping ${union.size} pkgs blocked")
                    } else {
                        StayTAccessibilityService.setBlocking(false)
                        Log.d(TAG, "STOP idx=$idx: blocking off")
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "alarm apply failed for $action", e)
            }

            // Advance the fired alarm (and heal any drift) from the mirror.
            try {
                ScheduleAlarmScheduler.programStored(context)
            } catch (e: Exception) {
                Log.w(TAG, "reprogram after alarm failed", e)
            }
        } catch (e: Exception) {
            Log.e(TAG, "onReceive failed", e)
        }
    }

    /**
     * Best-effort "Focus hours on" tap-to-open notification, following the
     * existing stayt_blocked channel pattern from StayTAccessibilityService.
     * createNotificationChannel is a no-op if the service already created it.
     * Silently skipped when POST_NOTIFICATIONS (API 33+) is not granted.
     */
    private fun notifyFocusOn(context: Context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    val nm = context.getSystemService(NotificationManager::class.java) ?: return
                    nm.createNotificationChannel(
                        NotificationChannel(
                            BLOCK_CHANNEL_ID,
                            BLOCK_CHANNEL_NAME,
                            NotificationManager.IMPORTANCE_HIGH
                        )
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "channel create failed", e)
                    return
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                try {
                    if (context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") !=
                        PackageManager.PERMISSION_GRANTED
                    ) return
                } catch (e: Exception) {
                    Log.w(TAG, "permission check failed", e)
                    return
                }
            }
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(context, BLOCK_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(context)
            }
                .setContentTitle("Focus hours on")
                .setContentText("StayT is now blocking distractions")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setAutoCancel(true)
            try {
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (launch != null) {
                    builder.setContentIntent(
                        PendingIntent.getActivity(
                            context, 9001, launch,
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                        )
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "tap intent failed", e)
            }
            try {
                (context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager)
                    ?.notify(FOCUS_ON_NOTIFICATION_ID, builder.build())
            } catch (e: Exception) {
                Log.w(TAG, "notify failed", e)
            }
        } catch (e: Exception) {
            Log.w(TAG, "notifyFocusOn failed", e)
        }
    }
}
