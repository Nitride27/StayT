package com.nitridee.staytapp.blocker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Native programmer for focus-schedule alarms (JS bridge: AppBlocker.setSchedules).
 *
 * CONTRACT (JS side in src/native/AppBlocker.ts already calls this):
 * each item is a map {days: [Double 0-6, Sun=0], startMinutes: Double,
 * endMinutes: Double, enabled: Bool, blockedPackages: [String]}.
 * Parsing is defensive: malformed items are skipped, this object never throws.
 *
 * DESIGN:
 * - The last pushed list is mirrored to SharedPreferences ("stayt_focus_schedules").
 *   Source of truth stays the JS store; JS re-pushes after every edit, so every
 *   setSchedules call reprograms from scratch (edits/disables take effect immediately).
 * - Alarms use AlarmManager.setAndAllowWhileIdle (INEXACT — deliberately avoids
 *   SCHEDULE_EXACT_ALARM permission friction; minute-level precision is fine for
 *   focus hours). One START + one STOP PendingIntent per enabled schedule
 *   (capped at MAX_SCHEDULES), recomputed on every push / alarm fire / boot.
 * - Overnight windows (end <= start) mean "until end next day". end == start is
 *   treated as a full 24h window.
 * - No SYSTEM_ALERT_WINDOW, no exact alarms, no new dangerous permissions.
 *   RECEIVE_BOOT_COMPLETED is a normal permission (no Play declaration needed).
 *
 * DOCUMENTED LIMITATIONS (deliberate, kept minimal):
 * - Timezone/daylight changes: wall-clock RTC alarms are recomputed on BOOT and on
 *   every setSchedules push only. A TZ shift between pushes drifts firings until
 *   the next push/reboot. No TIMEZONE_CHANGED observer (keeps manifest minimal);
 *   any app foreground that re-pushes schedules heals it.
 * - Overlap: START/STOP re-evaluate the UNION of currently-active windows, so an
 *   overlapping schedule keeps blocking alive. A scheduled START cancels any active
 *   2-min override (existing setBlocking semantics clear the pause timer) —
 *   the schedule wins over the break.
 * - Schedules with an empty blockedPackages list are persisted but get no alarms
 *   (nothing to enforce).
 */
object ScheduleAlarmScheduler {
    const val PREFS_NAME = "stayt_focus_schedules"
    private const val KEY_JSON = "schedules_json"
    const val ACTION_START = "com.nitridee.staytapp.blocker.SCHEDULE_START"
    const val ACTION_STOP = "com.nitridee.staytapp.blocker.SCHEDULE_STOP"
    private const val TAG = "StayTSchedules"
    private const val MAX_SCHEDULES = 32
    private const val REQ_BASE = 1000
    private const val DAY_MINUTES = 1440

    data class FocusSchedule(
        val days: Set<Int>,
        val startMinutes: Int,
        val endMinutes: Int,
        val enabled: Boolean,
        val blockedPackages: List<String>
    )

    // ---------- parsing (never throws) ----------

    fun parseItem(map: ReadableMap?): FocusSchedule? {
        try {
            if (map == null) return null
            if (!map.hasKey("days") || map.getType("days") != ReadableType.Array) return null
            val daysRaw = try { map.getArray("days") } catch (_: Exception) { null } ?: return null
            val days = mutableSetOf<Int>()
            for (i in 0 until daysRaw.size()) {
                try {
                    if (daysRaw.getType(i) != ReadableType.Number) continue
                    val d = daysRaw.getDouble(i).toInt()
                    if (d in 0..6) days.add(d)
                } catch (_: Exception) {
                }
            }
            if (days.isEmpty()) return null
            if (!map.hasKey("startMinutes") || map.getType("startMinutes") != ReadableType.Number) return null
            if (!map.hasKey("endMinutes") || map.getType("endMinutes") != ReadableType.Number) return null
            val start = try { map.getDouble("startMinutes").toInt() } catch (_: Exception) { return null }
            val end = try { map.getDouble("endMinutes").toInt() } catch (_: Exception) { return null }
            if (start !in 0..DAY_MINUTES || end !in 0..DAY_MINUTES) return null
            if (!map.hasKey("enabled") || map.getType("enabled") != ReadableType.Boolean) return null
            val enabled = try { map.getBoolean("enabled") } catch (_: Exception) { return null }
            val pkgs = mutableListOf<String>()
            try {
                if (map.hasKey("blockedPackages") && map.getType("blockedPackages") == ReadableType.Array) {
                    val arr = map.getArray("blockedPackages")
                    if (arr != null) {
                        for (i in 0 until arr.size()) {
                            try {
                                if (arr.getType(i) != ReadableType.String) continue
                                val p = arr.getString(i)
                                if (!p.isNullOrBlank()) pkgs.add(p)
                            } catch (_: Exception) {
                            }
                        }
                    }
                }
            } catch (_: Exception) {
            }
            return FocusSchedule(days, start, end, enabled, pkgs)
        } catch (_: Exception) {
            return null
        }
    }

    fun parseArray(schedules: ReadableArray?): List<FocusSchedule> {
        val out = mutableListOf<FocusSchedule>()
        try {
            if (schedules == null) return out
            for (i in 0 until schedules.size()) {
                try {
                    if (schedules.getType(i) != ReadableType.Map) continue
                    parseItem(schedules.getMap(i))?.let { out.add(it) }
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
        }
        return out
    }

    // ---------- persistence (SharedPreferences mirror) ----------

    fun persist(context: Context, list: List<FocusSchedule>) {
        try {
            val arr = JSONArray()
            for (s in list) {
                try {
                    val o = JSONObject()
                    val days = JSONArray()
                    for (d in s.days) days.put(d)
                    o.put("days", days)
                    o.put("start", s.startMinutes)
                    o.put("end", s.endMinutes)
                    o.put("enabled", s.enabled)
                    val pkgs = JSONArray()
                    for (p in s.blockedPackages) pkgs.put(p)
                    o.put("pkgs", pkgs)
                    arr.put(o)
                } catch (_: Exception) {
                }
            }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putString(KEY_JSON, arr.toString()).apply()
        } catch (e: Exception) {
            Log.w(TAG, "persist failed", e)
        }
    }

    fun load(context: Context): List<FocusSchedule> {
        val out = mutableListOf<FocusSchedule>()
        try {
            val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_JSON, null) ?: return out
            val arr = try { JSONArray(raw) } catch (_: Exception) { return out }
            for (i in 0 until arr.length()) {
                try {
                    val o = arr.optJSONObject(i) ?: continue
                    val days = mutableSetOf<Int>()
                    val ja = o.optJSONArray("days") ?: continue
                    for (j in 0 until ja.length()) {
                        val d = ja.optInt(j, -1)
                        if (d in 0..6) days.add(d)
                    }
                    if (days.isEmpty()) continue
                    val start = o.optInt("start", -1)
                    val end = o.optInt("end", -1)
                    if (start !in 0..DAY_MINUTES || end !in 0..DAY_MINUTES) continue
                    val pkgs = mutableListOf<String>()
                    val jp = o.optJSONArray("pkgs")
                    if (jp != null) {
                        for (j in 0 until jp.length()) {
                            val p = jp.optString(j, "")
                            if (p.isNotBlank()) pkgs.add(p)
                        }
                    }
                    out.add(FocusSchedule(days, start, end, o.optBoolean("enabled", false), pkgs))
                } catch (_: Exception) {
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "load failed", e)
        }
        return out
    }

    // ---------- entry points ----------

    /** setSchedules path: persist mirror, reprogram all alarms, apply current window now. */
    fun saveAndProgram(context: Context, list: List<FocusSchedule>) {
        persist(context, list)
        program(context, list)
        applyCurrentState(context, list)
    }

    /** Boot path: no JS running, work purely from the mirror. */
    fun reprogramFromMirror(context: Context) {
        val list = load(context)
        program(context, list)
        applyCurrentState(context, list)
    }

    /** Alarm-fire path: advance firings; the receiver applies state explicitly. */
    fun programStored(context: Context) {
        program(context, load(context))
    }

    // ---------- time math ----------

    /** Overnight (end <= start) spans into the next day; end == start = full 24h. */
    private fun durationMinutes(s: FocusSchedule): Int {
        val d = (s.endMinutes - s.startMinutes + DAY_MINUTES) % DAY_MINUTES
        return if (d == 0) DAY_MINUTES else d
    }

    /** Calendar.SUNDAY(1)..SATURDAY(7) -> JS 0..6 (Sun=0). */
    private fun jsDayOf(cal: Calendar): Int = cal.get(Calendar.DAY_OF_WEEK) - 1

    private fun atMinutes(base: Calendar, minutes: Int): Calendar =
        (base.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, minutes / 60)
            set(Calendar.MINUTE, minutes % 60)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

    fun nextStartMillis(s: FocusSchedule, nowMillis: Long): Long? {
        try {
            val now = Calendar.getInstance().apply { timeInMillis = nowMillis }
            var best: Long? = null
            for (offset in 0..7) {
                val day = (now.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, offset) }
                if (jsDayOf(day) !in s.days) continue
                val cand = atMinutes(day, s.startMinutes).timeInMillis
                if (cand > nowMillis && (best == null || cand < best)) best = cand
            }
            return best
        } catch (_: Exception) {
            return null
        }
    }

    fun nextStopMillis(s: FocusSchedule, nowMillis: Long): Long? {
        try {
            val durMs = durationMinutes(s) * 60_000L
            val now = Calendar.getInstance().apply { timeInMillis = nowMillis }
            var best: Long? = null
            // -1 catches an overnight window that started yesterday and ends today.
            for (offset in -1..7) {
                val day = (now.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, offset) }
                if (jsDayOf(day) !in s.days) continue
                val stop = atMinutes(day, s.startMinutes).timeInMillis + durMs
                if (stop > nowMillis && (best == null || stop < best)) best = stop
            }
            return best
        } catch (_: Exception) {
            return null
        }
    }

    fun isActiveAt(s: FocusSchedule, nowMillis: Long): Boolean {
        try {
            if (!s.enabled) return false
            val durMs = durationMinutes(s) * 60_000L
            val now = Calendar.getInstance().apply { timeInMillis = nowMillis }
            for (offset in -1..0) {
                val day = (now.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, offset) }
                if (jsDayOf(day) !in s.days) continue
                val startMs = atMinutes(day, s.startMinutes).timeInMillis
                if (nowMillis in startMs until startMs + durMs) return true
            }
            return false
        } catch (_: Exception) {
            return false
        }
    }

    /** Union of blocked packages across all windows active right now (overlap rule). */
    fun unionActive(list: List<FocusSchedule>, nowMillis: Long): List<String> {
        try {
            return list.filter { isActiveAt(it, nowMillis) }
                .flatMap { it.blockedPackages }.distinct()
        } catch (_: Exception) {
            return emptyList()
        }
    }

    /**
     * If we are inside a focus window right now (push while inside, or boot while
     * inside), start blocking immediately. Never auto-stops: outside a window we
     * leave state untouched so a manual session survives a schedule push.
     */
    fun applyCurrentState(context: Context, list: List<FocusSchedule>) {
        try {
            val union = unionActive(list, System.currentTimeMillis())
            if (union.isNotEmpty()) {
                StayTAccessibilityService.setBlocking(true, union)
                Log.d(TAG, "inside focus window now; blocking ${union.size} pkgs")
            } else {
                Log.d(TAG, "no active window now; leaving blocking state untouched")
            }
        } catch (e: Exception) {
            Log.w(TAG, "applyCurrentState failed", e)
        }
    }

    // ---------- alarms ----------

    fun program(context: Context, schedules: List<FocusSchedule>) {
        try {
            val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            if (am == null) {
                Log.w(TAG, "program skipped: no AlarmManager")
                return
            }
            cancelAll(context, am)
            val now = System.currentTimeMillis()
            var count = 0
            schedules.take(MAX_SCHEDULES).forEachIndexed { idx, s ->
                try {
                    if (!s.enabled || s.blockedPackages.isEmpty()) return@forEachIndexed
                    nextStartMillis(s, now)?.let { fireAt ->
                        setInexact(am, context, ACTION_START, idx, fireAt)
                        count++
                        Log.d(TAG, "START #$idx at $fireAt")
                    }
                    nextStopMillis(s, now)?.let { fireAt ->
                        setInexact(am, context, ACTION_STOP, idx, fireAt)
                        count++
                        Log.d(TAG, "STOP #$idx at $fireAt")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "program #$idx failed", e)
                }
            }
            Log.d(TAG, "programmed $count alarms from ${schedules.size} schedules")
        } catch (e: Exception) {
            Log.e(TAG, "program failed", e)
        }
    }

    private fun reqCode(idx: Int, action: String): Int =
        REQ_BASE + idx * 2 + if (action == ACTION_STOP) 1 else 0

    private fun alarmIntent(context: Context, action: String, idx: Int): Intent =
        Intent(context, ScheduleAlarmReceiver::class.java)
            .setAction(action)
            .putExtra("schedule_index", idx)

    private fun setInexact(am: AlarmManager, context: Context, action: String, idx: Int, fireAt: Long) {
        val pi = PendingIntent.getBroadcast(
            context, reqCode(idx, action), alarmIntent(context, action, idx),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
        } else {
            @Suppress("DEPRECATION")
            am.set(AlarmManager.RTC_WAKEUP, fireAt, pi)
        }
    }

    private fun cancelAll(context: Context, am: AlarmManager) {
        for (idx in 0 until MAX_SCHEDULES) {
            for (action in arrayOf(ACTION_START, ACTION_STOP)) {
                try {
                    val quiet = Intent(context, ScheduleAlarmReceiver::class.java).setAction(action)
                    val pi = PendingIntent.getBroadcast(
                        context, reqCode(idx, action), quiet,
                        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
                    )
                    if (pi != null) {
                        am.cancel(pi)
                        pi.cancel()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "cancel #$idx failed", e)
                }
            }
        }
    }
}
