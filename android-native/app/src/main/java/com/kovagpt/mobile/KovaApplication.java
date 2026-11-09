package com.kovagpt.mobile;

import android.app.Application;
import android.os.Build;
import android.webkit.WebView;

/** Each signed-in account uses a separate persistent WebView cookie/storage container. */
public final class KovaApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        // Must run before any WebView method, including setWebContentsDebuggingEnabled.
        // Account one retains the original default data directory for existing sign-ins.
        if (Build.VERSION.SDK_INT >= 28 &&
                Application.getProcessName().equals(getPackageName() + ":accountTwo")) {
            WebView.setDataDirectorySuffix("account-two");
        }
    }
}
