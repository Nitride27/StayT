package com.nitridee.staytapp.blocker

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

/**
 * P2-2 Quick Settings tile (PRO). Toggles last-task session blocking via the
 * StayTAccessibilityService statics — no new permissions, no activity launch
 * on the block path (single-surface rule untouched).
 *
 * Entitlement comes from the same [WidgetData] prefs mirror the widget uses
 * (JS writes isSubscribed on grant/restore), so the tile works with the app
 * dead. Locked (non-Pro) taps route to the paywall deep link
 * ([StayTAccessibilityService.PAYWALL_DEEP_LINK], handled in App.tsx) instead
 * of toggling.
 *
 * B1 strict mode: a STOP while the mirror says strictActive is denied (the
 * tile shows the "Strict session" subtitle and never toggles); a START is
 * only allowed with no active session. M4: everything trusts the live
 * service state first — when the accessibility service is disabled the tile
 * labels "Off" and never toggles.
 */
class StayTTileService : TileService() {

    companion object {
        private const val TAG = "StayTTile"
        private const val PAYWALL_REQ = 9101
    }

    override fun onStartListening() {
        super.onStartListening()
        try {
            val tile = qsTile ?: return
            val snap = WidgetData.load(this)
            val serviceOn = StayTAccessibilityService.isServiceEnabled(this)
            // Tile.subtitle is API 29+; labels alone carry the state below that.
            val setSubtitle: (String) -> Unit = { sub ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try {
                        tile.subtitle = sub
                    } catch (_: Exception) {
                    }
                }
            }
            if (!serviceOn) {
                tile.state = Tile.STATE_INACTIVE
                tile.label = "StayT Off"
                setSubtitle("Enable in Settings")
            } else if (!snap.subscribed) {
                tile.state = Tile.STATE_INACTIVE
                tile.label = "StayT Pro"
                setSubtitle("Unlock to quick-block")
            } else if (snap.strictActive) {
                tile.state = Tile.STATE_ACTIVE
                tile.label = "Blocking"
                setSubtitle("Strict session")
            } else if (StayTAccessibilityService.isBlockingNow() && snap.lastPackages.isNotEmpty()) {
                tile.state = Tile.STATE_ACTIVE
                tile.label = "Blocking"
                setSubtitle("${snap.lastPackages.size} app(s)")
            } else {
                tile.state = Tile.STATE_INACTIVE
                tile.label = "StayT"
                setSubtitle(if (snap.lastPackages.isEmpty()) "Open StayT to set up" else "Tap to block")
            }
            tile.updateTile()
        } catch (e: Exception) {
            Log.w(TAG, "onStartListening failed", e)
        }
    }

    override fun onClick() {
        super.onClick()
        try {
            // M4: dead service means dead state — never toggle, just relabel.
            if (!StayTAccessibilityService.isServiceEnabled(this)) {
                try {
                    onStartListening()
                } catch (e: Exception) {
                    Log.w(TAG, "post-toggle refresh failed", e)
                }
                return
            }
            val snap = WidgetData.load(this)
            if (!snap.subscribed) {
                // Locked state: route to the paywall, never toggle.
                routeToPaywall()
                return
            }
            // B1: strict sessions cannot be stopped from the tile.
            if (snap.strictActive) {
                try {
                    onStartListening()
                } catch (e: Exception) {
                    Log.w(TAG, "post-toggle refresh failed", e)
                }
                return
            }
            if (StayTAccessibilityService.isBlockingNow()) {
                StayTAccessibilityService.setBlocking(false)
            } else if (!snap.sessionActive && snap.lastPackages.isNotEmpty()) {
                StayTAccessibilityService.setBlocking(true, snap.lastPackages)
            }
            try {
                onStartListening()
            } catch (e: Exception) {
                Log.w(TAG, "post-toggle refresh failed", e)
            }
        } catch (e: Exception) {
            Log.w(TAG, "onClick failed", e)
        }
    }

    /**
     * H1: route to the paywall via the PendingIntent overload on API 34+
     * (targetSdk 36: the plain-Intent overload is dead on Android 14+).
     * Legacy Intent path below 34. Never throws; failures only log — the
     * tile relabel above remains the visible fallback.
     */
    private fun routeToPaywall() {
        try {
            val intent = Intent(
                Intent.ACTION_VIEW,
                Uri.parse(StayTAccessibilityService.PAYWALL_DEEP_LINK)
            ).apply {
                setPackage(packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                if (Build.VERSION.SDK_INT >= 34) {
                    val pi = PendingIntent.getActivity(
                        this, PAYWALL_REQ, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    startActivityAndCollapse(pi)
                } else {
                    @Suppress("DEPRECATION")
                    startActivityAndCollapse(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "paywall route failed", e)
            }
        } catch (e: Exception) {
            Log.w(TAG, "paywall route failed", e)
        }
    }
}
