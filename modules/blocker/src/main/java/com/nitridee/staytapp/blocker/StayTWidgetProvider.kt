package com.nitridee.staytapp.blocker

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import com.nitridee.staytapp.R

/**
 * P2-1 home-screen widget (FREE), clean + minimal like the app: hairline
 * card in the app theme, app icon + name + status word, big Anton
 * focus-today total, task / rough-day line, one streak + blocked-apps line. Pure prefs-mirror reader ([WidgetData]) so it works with the app
 * dead. No entitlement gate. Tap opens the app. Updates are pushed (session
 * start/end via syncWidgetData, midnight rollover) — updatePeriodMillis
 * stays 0. Day/night follows the app theme mirrored from JS (setThemeDark),
 * falling back to the system night mode.
 */
class StayTWidgetProvider : AppWidgetProvider() {

    companion object {
        private const val TAG = "StayTWidget"
        private const val GREEN = "#58CC02"

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
            // App theme (mirrored from JS), not the phone's: matches the app.
            val night = StayTAccessibilityService.isDarkTheme(context)
            val pal = StayTAccessibilityService.palette(context)
            val green = Color.parseColor(if (night) GREEN else "#46A302")
            val views = RemoteViews(context.packageName, R.layout.stayt_widget)
            val focusing = snap.sessionActive
            // Mood: the mascotMood mirror wins; else give-ins (old shells).
            val mood = try {
                snap.mascotMood.ifEmpty {
                    when {
                        snap.giveInsToday > 2 -> "wilted"
                        snap.giveInsToday >= 1 -> "steady"
                        else -> "bright"
                    }
                }
            } catch (_: Exception) {
                "bright"
            }
            // Each piece best-effort: one bad setter must not blank the widget.
            fun safe(what: String, block: () -> Unit) {
                try { block() } catch (e: Exception) { Log.w(TAG, "$what failed", e) }
            }
            safe("card") {
                views.setInt(
                    R.id.widget_root, "setBackgroundResource",
                    if (night) R.drawable.stayt_widget_bg else R.drawable.stayt_widget_bg_light
                )
            }
            safe("status") {
                views.setTextViewText(
                    R.id.widget_status,
                    when {
                        focusing && snap.strictActive -> "\u25CF Strict"
                        focusing -> "\u25CF Focusing"
                        snap.lastPackages.isNotEmpty() -> "Ready"
                        else -> "Set up"
                    }
                )
                views.setTextColor(R.id.widget_status, if (focusing) green else pal.muted)
            }
            safe("owl") {
                // Same art the app uses per theme (outlined set on dark).
                val art = when {
                    focusing -> if (night) R.drawable.stayt_owl_working_white else R.drawable.stayt_owl_working
                    mood == "wilted" -> if (night) R.drawable.stayt_owl_blocked_white else R.drawable.stayt_owl_blocked
                    mood == "steady" -> if (night) R.drawable.stayt_owl_thinking_white else R.drawable.stayt_owl_thinking
                    else -> if (night) R.drawable.stayt_owl_cheering_white else R.drawable.stayt_owl_cheering
                }
                views.setImageViewResource(R.id.widget_owl, art)
                // Narrow resize (< 250dp): the owl yields its space to the numbers.
                val minW = try {
                    mgr.getAppWidgetOptions(appWidgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 300)
                } catch (_: Exception) {
                    300
                }
                views.setViewVisibility(R.id.widget_owl, if (minW < 250) View.GONE else View.VISIBLE)
            }
            safe("line") {
                // Active task in accent; a rough day is quiet, not celebratory.
                val (line, color) = when {
                    focusing && snap.activeTaskName.isNotBlank() -> "Now: ${snap.activeTaskName}" to green
                    mood == "wilted" -> "Rough day. Rebound tomorrow." to pal.muted
                    else -> null to pal.muted
                }
                if (line != null) {
                    views.setTextViewText(R.id.widget_task, line)
                    views.setTextColor(R.id.widget_task, color)
                    views.setViewVisibility(R.id.widget_task, View.VISIBLE)
                } else {
                    views.setViewVisibility(R.id.widget_task, View.GONE)
                }
            }
            safe("numbers") {
                views.setTextViewText(R.id.widget_focus, formatFocus(snap.todayFocusMin))
                val streak = maxOf(0, snap.streak)
                views.setTextViewText(R.id.widget_streak, streak.toString())
                views.setTextViewText(R.id.widget_streak_label, "day streak")
                val n = maxOf(0, snap.lastPackages.size)
                views.setTextViewText(R.id.widget_apps, n.toString())
                views.setTextViewText(R.id.widget_apps_label, if (n == 1) "app blocked" else "apps blocked")
                for (id in intArrayOf(R.id.widget_brand, R.id.widget_focus, R.id.widget_streak, R.id.widget_apps)) {
                    views.setTextColor(id, pal.ink)
                }
                for (id in intArrayOf(R.id.widget_focus_label, R.id.widget_streak_label, R.id.widget_apps_label)) {
                    views.setTextColor(id, pal.muted)
                }
            }
            safe("tap intent") {
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (launch != null) {
                    val pi = android.app.PendingIntent.getActivity(
                        context, 7702, launch,
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                            android.app.PendingIntent.FLAG_IMMUTABLE
                    )
                    views.setOnClickPendingIntent(R.id.widget_root, pi)
                }
            }
            mgr.updateAppWidget(appWidgetId, views)
        }
    }

    // Resized on the home screen: re-render so the owl shows/hides.
    override fun onAppWidgetOptionsChanged(
        context: Context?,
        appWidgetManager: AppWidgetManager?,
        appWidgetId: Int,
        newOptions: android.os.Bundle?
    ) {
        if (context == null || appWidgetManager == null) return
        try {
            updateOne(context, appWidgetManager, appWidgetId)
        } catch (e: Exception) {
            Log.w(TAG, "options update #$appWidgetId failed", e)
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
