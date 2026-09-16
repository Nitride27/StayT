package com.nitridee.staytapp.blocker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * P2-1 home-screen widget data mirror (FREE).
 *
 * The widget (and the P2-2 QS tile) must work with the app dead, so they
 * cannot touch AsyncStorage/JS. Instead JS pushes a snapshot here via
 * AppBlocker.syncWidgetData() on session start/end and Pro grant; the
 * widget provider and tile read this file directly.
 *
 * Midnight rollover: syncWidgetData() always (re)programs one inexact daily
 * alarm; WidgetMidnightReceiver zeroes todayFocusMin when the date flips,
 * refreshes the widget, and reprograms. Boot re-arms via
 * ScheduleBootReceiver (alarms do not survive reboot).
 */
object WidgetData {
    const val PREFS_NAME = "stayt_widget"
    private const val TAG = "StayTWidgetData"
    private const val KEY_DATE = "date"
    private const val KEY_TODAY_MIN = "todayFocusMin"
    private const val KEY_STREAK = "streak"
    private const val KEY_SUBSCRIBED = "subscribed"
    private const val KEY_LAST_PKGS = "lastPackages"
    // B1 strict-mode mirror: written by syncWidgetNow on session start/end
    // and override consume; read by the QS tile with the app dead.
    private const val KEY_SESSION_ACTIVE = "sessionActive"
    private const val KEY_STRICT_ACTIVE = "strictActive"
    // Dashboard mirror: active task name for the widget's NOW line.
    private const val KEY_ACTIVE_TASK = "activeTaskName"
    // Mood mirror: give-ins today for the widget's mood line (>2 = rough day).
    private const val KEY_GIVEINS = "giveInsToday"
    // Feature 4 mascot mood mirror: 'bright' (0 give-ins) | 'steady' (1-2) |
    // 'wilted' (>2), derived JS-side via widgetMascotMood and pushed as the
    // optional 9th syncWidgetData arg. "" = unknown (old JS / pre-sync).
    private const val KEY_MOOD = "mascotMood"
    private const val MIDNIGHT_REQ = 7701

    /** Whitelisted mood strings. Anything else reads back as "" (unknown). Never throws. */
    fun sanitizeMood(raw: String?): String {
        return try {
            val clean = raw?.trim()?.lowercase(Locale.ROOT).orEmpty()
            if (clean == "bright" || clean == "steady" || clean == "wilted") clean else ""
        } catch (_: Exception) {
            ""
        }
    }

    data class Snapshot(
        val todayFocusMin: Int,
        val streak: Int,
        val subscribed: Boolean,
        val lastPackages: List<String>,
        val sessionActive: Boolean = false,
        val strictActive: Boolean = false,
        val activeTaskName: String = "",
        val giveInsToday: Int = 0,
        val mascotMood: String = ""
    )

    fun todayString(now: Long = System.currentTimeMillis()): String {
        return try {
            SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(now))
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * JS push path. An empty lastPackages keeps the previous value (callers
     * pass [] when they have nothing new — e.g. a Pro grant with no
     * session — so the tile never loses its toggle target). mascotMood
     * follows the same keep-previous rule: null/blank/unknown keeps the
     * stored value (so 8-arg callers on stale shells never wipe it); only a
     * whitelisted 'bright'|'steady'|'wilted' overwrites.
     */
    fun save(
        context: Context,
        todayFocusMin: Int,
        streak: Int,
        subscribed: Boolean,
        lastPackages: List<String>,
        sessionActive: Boolean = false,
        strictActive: Boolean = false,
        activeTaskName: String? = null,
        giveInsToday: Int = 0,
        mascotMood: String? = null
    ) {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val edit = prefs.edit()
                .putString(KEY_DATE, todayString())
                .putInt(KEY_TODAY_MIN, maxOf(0, todayFocusMin))
                .putInt(KEY_STREAK, maxOf(0, streak))
                .putBoolean(KEY_SUBSCRIBED, subscribed)
                .putBoolean(KEY_SESSION_ACTIVE, sessionActive)
                .putBoolean(KEY_STRICT_ACTIVE, strictActive)
                .putInt(KEY_GIVEINS, maxOf(0, giveInsToday))
            val cleanTask = activeTaskName?.trim().orEmpty()
            if (sessionActive && cleanTask.isNotEmpty()) {
                edit.putString(KEY_ACTIVE_TASK, cleanTask)
            } else if (!sessionActive) {
                edit.remove(KEY_ACTIVE_TASK)
            }
            val cleanMood = sanitizeMood(mascotMood)
            if (cleanMood.isNotEmpty()) {
                edit.putString(KEY_MOOD, cleanMood)
            }
            val clean = lastPackages.filter { it.isNotBlank() }.distinct()
            if (clean.isNotEmpty()) {
                edit.putStringSet(KEY_LAST_PKGS, clean.toSet())
            }
            edit.apply()
        } catch (e: Exception) {
            Log.w(TAG, "save failed", e)
        }
    }

    fun load(context: Context): Snapshot {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val storedDate = prefs.getString(KEY_DATE, null)
            // Read-time rollover: a new day with no JS push yet shows 0, not
            // yesterday's total. (The midnight alarm normally handles this;
            // this covers a missed alarm with no extra permissions.)
            val rolled = storedDate != null && storedDate != todayString()
            val pkgs = try {
                prefs.getStringSet(KEY_LAST_PKGS, emptySet())?.filter { it.isNotBlank() } ?: emptyList()
            } catch (_: Exception) {
                emptyList()
            }
            return Snapshot(
                todayFocusMin = if (rolled) 0 else maxOf(0, prefs.getInt(KEY_TODAY_MIN, 0)),
                streak = maxOf(0, prefs.getInt(KEY_STREAK, 0)),
                subscribed = prefs.getBoolean(KEY_SUBSCRIBED, false),
                lastPackages = pkgs,
                sessionActive = prefs.getBoolean(KEY_SESSION_ACTIVE, false),
                strictActive = prefs.getBoolean(KEY_STRICT_ACTIVE, false),
                activeTaskName = try {
                    prefs.getString(KEY_ACTIVE_TASK, null).orEmpty()
                } catch (_: Exception) {
                    ""
                },
                giveInsToday = if (rolled) 0 else try {
                    maxOf(0, prefs.getInt(KEY_GIVEINS, 0))
                } catch (_: Exception) {
                    0
                },
                // Mood derives from give-ins, so a stale date rolls it back
                // to unknown ("") like the counters above.
                mascotMood = if (rolled) "" else try {
                    sanitizeMood(prefs.getString(KEY_MOOD, null))
                } catch (_: Exception) {
                    ""
                }
            )
        } catch (e: Exception) {
            Log.w(TAG, "load failed", e)
            return Snapshot(0, 0, false, emptyList())
        }
    }

    /**
     * L6: day-rollover seam. Zeroes todayFocusMin when the stored date is
     * stale, stamps today, and reports whether a reset happened. The midnight
     * receiver (and any future caller) uses this instead of raw key strings.
     * Mood + give-ins roll with the date (mood re-derives on next JS push).
     */
    fun resetDayIfStale(context: Context): Boolean {
        try {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            if (prefs.getString(KEY_DATE, null) != todayString()) {
                prefs.edit()
                    .putString(KEY_DATE, todayString())
                    .putInt(KEY_TODAY_MIN, 0)
                    .putInt(KEY_GIVEINS, 0)
                    .remove(KEY_MOOD)
                    .apply()
                return true
            }
            return false
        } catch (e: Exception) {
            Log.w(TAG, "resetDayIfStale failed", e)
            return false
        }
    }

    /** (Re)program the daily midnight rollover alarm. Never throws. */
    fun programMidnightAlarm(context: Context) {
        try {
            val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(context, WidgetMidnightReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                context, MIDNIGHT_REQ, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val nextMidnight = Calendar.getInstance().apply {
                add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 1)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, nextMidnight, pi)
            } else {
                @Suppress("DEPRECATION")
                am.set(AlarmManager.RTC_WAKEUP, nextMidnight, pi)
            }
        } catch (e: Exception) {
            Log.w(TAG, "programMidnightAlarm failed", e)
        }
    }
}
