package com.nitridee.staytapp.blocker

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import com.nitridee.staytapp.R

/**
 * P2-1 home-screen widget (FREE). Pure prefs-mirror reader: renders
 * {todayFocusMin, streak} from [WidgetData] so it works with the app dead.
 * No entitlement gate. Tap opens the app. Updates are pushed (session end
 * via syncWidgetData, midnight rollover) — updatePeriodMillis stays 0.
 */
class StayTWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val TAG = "StayTWidget"

        fun refreshAll(context: Context) {
            try {
                val mgr = AppWidgetManager.getInstance(context) ?: return
                val cn = ComponentName(context, StayTWidgetProvider::class.java)
                val ids = try {
                    mgr.getAppWidgetIds(cn)
                } catch (_: Exception) {
                    return
                }
                for (id in ids) {
                    try {
                        updateOne(context, mgr, id)
                    } catch (e: Exception) {
                        Log.w(TAG, "update #$id failed", e)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "refreshAll failed", e)
            }
        }

        private fun updateOne(context: Context, mgr: AppWidgetManager, appWidgetId: Int) {
            val snap = WidgetData.load(context)
            val views = RemoteViews(context.packageName, R.layout.stayt_widget)
            try {
                views.setTextViewText(R.id.widget_focus, "${snap.todayFocusMin}m")
            } catch (e: Exception) {
                Log.w(TAG, "focus text failed", e)
            }
            try {
                views.setTextViewText(
                    R.id.widget_streak,
                    if (snap.streak > 0) "${snap.streak}-day streak" else "Start your streak"
                )
            } catch (e: Exception) {
                Log.w(TAG, "streak text failed", e)
            }
            try {
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (launch != null) {
                    val pi = android.app.PendingIntent.getActivity(
                        context, 7702, launch,
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                            android.app.PendingIntent.FLAG_IMMUTABLE
                    )
                    views.setOnClickPendingIntent(R.id.widget_root, pi)
                }
            } catch (e: Exception) {
                Log.w(TAG, "tap intent failed", e)
            }
            mgr.updateAppWidget(appWidgetId, views)
        }
    }

    override fun onUpdate(
        context: Context?,
        appWidgetManager: AppWidgetManager?,
        appWidgetIds: IntArray?
    ) {
        if (context == null || appWidgetManager == null || appWidgetIds == null) return
        for (id in appWidgetIds) {
            try {
                updateOne(context, appWidgetManager, id)
            } catch (e: Exception) {
                Log.w(TAG, "onUpdate #$id failed", e)
            }
        }
    }
}
