package com.nitridee.staytapp.blocker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Session-note play/pause button (ADR-0008). Explicit, not exported. */
class SessionControlReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_TOGGLE = "com.nitridee.staytapp.SESSION_TOGGLE"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_TOGGLE) return
        try {
            StayTAccessibilityService.toggleSessionPause(context.applicationContext)
        } catch (t: Throwable) {
            Log.w("StayTSessionControl", "toggle failed", t)
        }
    }
}
