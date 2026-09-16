package com.nitridee.staytapp.blocker

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import com.nitridee.staytapp.R

/**
 * P2-1 home-screen widget (FREE). Focus dashboard: owl mascot + live status
 * header, big focus-today total, active-task line, streak / guarded-apps
 * footer. Pure prefs-mirror reader ([WidgetData]) so it works with the app
 * dead. No entitlement gate. Tap opens the app. Updates are pushed (session
 * start/end via syncWidgetData, midnight rollover) — updatePeriodMillis
 * stays 0. Day/night card follows the system night mode (the JS app-theme
 * override is not visible from native).
 */
class StayTWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val TAG = "StayTWidget"
        private const val GREEN = "#58CC02"
        private const val MIDNIGHT = "#000437"

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

        private fun formatFocus(totalMin: Int): String {
            val m = maxOf(0, totalMin)
            if (m < 60) return "${m}m"
            val h = m / 60
            val rest = m % 60
            return if (rest == 0) "${h}h" else "${h}h ${rest.toString().padStart(2, '0')}m"
        }

        private fun updateOne(context: Context, mgr: AppWidgetManager, appWidgetId: Int) {
            val snap = WidgetData.load(context)
            val night = (context.resources.configuration.uiMode and
                Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            val green = Color.parseColor(GREEN)
            val ink = if (night) Color.WHITE else Color.parseColor(MIDNIGHT)
            val muted = if (night) Color.parseColor("#B9B9B9") else Color.parseColor("#4B4B4B")
            val views = RemoteViews(context.packageName, R.layout.stayt_widget)
            try {
                views.setInt(
                    R.id.widget_root,
                    "setBackgroundResource",
                    if (night) R.drawable.stayt_widget_bg else R.drawable.stayt_widget_bg_light
                )
            } catch (e: Exception) {
                Log.w(TAG, "card background failed", e)
            }
            try {
                views.setImageViewResource(
                    R.id.widget_mascot,
                    if (night) R.drawable.stayt_owl_blocked_white else R.drawable.stayt_owl_blocked
                )
            } catch (e: Exception) {
                Log.w(TAG, "mascot failed", e)
            }
            val focusing = snap.sessionActive
            try {
                val status = when {
                    focusing && snap.strictActive -> "STRICT SESSION • FOCUSING"
                    focusing -> "FOCUSING NOW"
                    snap.lastPackages.isNotEmpty() -> "READY TO FOCUS"
                    else -> "OPEN STAYT TO SET UP"
                }
                views.setTextViewText(R.id.widget_status, status)
                views.setTextColor(R.id.widget_status, if (focusing) green else muted)
            } catch (e: Exception) {
                Log.w(TAG, "status failed", e)
            }
            try {
                if (focusing && snap.activeTaskName.isNotBlank()) {
                    views.setTextViewText(
                        R.id.widget_task,
                        "NOW: ${snap.activeTaskName.uppercase()}"
                    )
                    views.setTextColor(R.id.widget_task, green)
                    views.setViewVisibility(R.id.widget_task, View.VISIBLE)
                } else {
                    views.setViewVisibility(R.id.widget_task, View.GONE)
                }
            } catch (e: Exception) {
                Log.w(TAG, "task line failed", e)
            }
            // Mood line: 'wilted' shows the rebound copy. The mascotMood
            // mirror ('bright'|'steady'|'wilted', "" = unknown from old JS)
            // wins when present; otherwise fall back to the give-ins count
            // (>2 = rough day) so stale shells keep the old behavior.
            // Wilted also dims the mascot (alpha ~0.6) — additive, no restyle.
            val isWilted = try {
                if (snap.mascotMood.isNotEmpty()) snap.mascotMood == "wilted"
                else snap.giveInsToday > 2
            } catch (_: Exception) {
                false
            }
            try {
                if (isWilted) {
                    views.setTextViewText(R.id.widget_mood, "ROUGH DAY — OWL BELIEVES IN REBOUNDS")
                    views.setTextColor(R.id.widget_mood, green)
                    views.setViewVisibility(R.id.widget_mood, View.VISIBLE)
                } else {
                    views.setViewVisibility(R.id.widget_mood, View.GONE)
                }
            } catch (e: Exception) {
                Log.w(TAG, "mood line failed", e)
            }
            try {
                views.setInt(
                    R.id.widget_mascot,
                    "setImageAlpha",
                    if (isWilted) 153 else 255
                )
            } catch (e: Exception) {
                Log.w(TAG, "mascot alpha failed", e)
            }
            try {
                views.setTextViewText(R.id.widget_focus, formatFocus(snap.todayFocusMin))
                views.setTextColor(R.id.widget_focus, ink)
            } catch (e: Exception) {
                Log.w(TAG, "focus text failed", e)
            }
            try {
                views.setTextViewText(
                    R.id.widget_streak,
                    if (snap.streak > 0) "${snap.streak}-DAY STREAK" else "NO STREAK YET"
                )
                views.setTextColor(R.id.widget_streak, ink)
            } catch (e: Exception) {
                Log.w(TAG, "streak text failed", e)
            }
            try {
                val n = snap.lastPackages.size
                views.setTextViewText(
                    R.id.widget_guarded,
                    when {
                        n <= 0 -> "NO APPS GUARDED"
                        n == 1 -> "1 APP GUARDED"
                        else -> "$n APPS GUARDED"
                    }
                )
                views.setTextColor(R.id.widget_guarded, muted)
            } catch (e: Exception) {
                Log.w(TAG, "guarded text failed", e)
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
