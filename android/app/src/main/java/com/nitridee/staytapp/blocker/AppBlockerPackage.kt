package com.nitridee.staytapp.blocker

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AppBlockerPackage : ReactPackage {
    private var module: AppBlockerModule? = null

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        module = AppBlockerModule(reactContext)
        module?.startListening()
        return listOf(module!!)
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }

    fun onDestroy() {
        module?.stopListening()
    }
}
