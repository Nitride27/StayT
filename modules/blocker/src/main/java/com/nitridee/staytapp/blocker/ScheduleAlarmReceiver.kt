package com.nitridee.staytapp.blocker

import com.nitridee.staytapp.R

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
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
                        // Schedule wins over a user pause too (ADR-0008),
                        // same as it wins over a break.
                        StayTAccessibilityService.setSessionPaused(context, false)
                        StayTAccessibilityService.reconcileWithSchedules(context, union)
                        Log.d(TAG, "START idx=$idx: blocking ${union.size} pkgs")
                        val now = System.currentTimeMillis()
                        val endsAt = schedules.filter { ScheduleAlarmScheduler.isActiveAt(it, now) }
                            .mapNotNull { ScheduleAlarmScheduler.nextStopMillis(it, now) }
                            .minOrNull()
                        notifyFocusOn(context, union.size, endsAt)
                    } else {
                        Log.w(TAG, "START idx=$idx fired with no active window (clock shifted?); reprogramming")
                    }
                } else {
                    // Overlapping windows and a live manual session both
                    // survive a STOP; blocking only ends when neither is left.
                    StayTAccessibilityService.reconcileWithSchedules(context, union)
                    Log.d(TAG, "STOP idx=$idx: ${union.size} schedule pkgs still active")
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

    /** "Blocking 2 apps until 17:00" in the phone's own 12/24h format. */
    private fun focusOnText(context: Context, appCount: Int, endsAt: Long?): String {
        val apps = if (appCount == 1) "1 app" else "$appCount apps"
        val until = try {
            endsAt?.let { " until " + android.text.format.DateFormat.getTimeFormat(context).format(java.util.Date(it)) }
        } catch (_: Exception) {
            null
        } ?: ""
        return "Blocking $apps$until."
    }

    /**
     * Best-effort "Focus hours started" tap-to-open notification, following the
     * existing stayt_blocked channel pattern from StayTAccessibilityService.
     * createNotificationChannel is a no-op if the service already created it.
     * Silently skipped when POST_NOTIFICATIONS (API 33+) is not granted.
     */
    private fun notifyFocusOn(context: Context, appCount: Int, endsAt: Long?) {
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
            // Native-M3: one seam with the blocked notification below.
            if (!StayTAccessibilityService.canPostNotifications(context)) return
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Notification.Builder(context, BLOCK_CHANNEL_ID)
            } else {
                @Suppress("DEPRECATION")
                Notification.Builder(context)
            }
                .setContentTitle("Focus hours started")
                .setContentText(focusOnText(context, appCount, endsAt))
                .setSmallIcon(R.drawable.ic_stayt_note)
                .setColor(-10957822) // ectoGreen, same accent as the session note
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
