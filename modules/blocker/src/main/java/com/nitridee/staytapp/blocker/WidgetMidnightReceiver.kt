package com.nitridee.staytapp.blocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * P2-1 midnight rollover. Alarms do not survive reboot (ScheduleBootReceiver
 * re-arms), and every fire reprograms the next one, so a missed alarm heals
 * on the next JS syncWidgetData push. Work is tiny: zero today's total when
 * the date flipped, refresh the widget, reprogram. Never throws.
 */
class WidgetMidnightReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "StayTWidgetMidnight"
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) return
        try {
            // L6: rollover through the WidgetData seam, not raw key strings.
            try {
                WidgetData.resetDayIfStale(context)
            } catch (e: Exception) {
                Log.w(TAG, "rollover failed", e)
            }
            try {
                StayTWidgetProvider.refreshAll(context)
            } catch (e: Exception) {
                Log.w(TAG, "refresh failed", e)
            }
        } catch (e: Exception) {
            Log.e(TAG, "onReceive failed", e)
        } finally {
            try {
                WidgetData.programMidnightAlarm(context)
            } catch (_: Exception) {
            }
        }
    }
}
