package com.kovagpt.mobile;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.HapticFeedbackConstants;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.ArrayList;

/** Native navigation, sharing and file selection without exposing a JavaScript bridge. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://kovagpt.com/";
    private static final int PICK_FILES = 1031;
    private static final int MEDIA_PERMISSION = 1032;
    private WebView web;
    private ValueCallback<Uri[]> files;
    private PermissionRequest pendingMedia;
    private String[] pendingMediaResources;

    private static boolean trusted(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
            && "kovagpt.com".equalsIgnoreCase(uri.getHost())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void openExternal(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())
                || uri.getHost() == null || uri.getUserInfo() != null) return;
        new AlertDialog.Builder(this)
            .setTitle("Open outside KovaGPT?")
            .setMessage("Open " + uri.getHost() + " in your browser?")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Open", (d, button) -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri)
                        .addCategory(Intent.CATEGORY_BROWSABLE));
                } catch (ActivityNotFoundException e) {
                    new AlertDialog.Builder(this).setMessage("No browser available.")
                        .setPositiveButton("OK", null).show();
                }
            }).show();
    }

    private void denyPendingMedia() {
        if (pendingMedia == null) return;
        pendingMedia.deny();
        pendingMedia = null;
        pendingMediaResources = null;
    }

    private void requestMedia(PermissionRequest request) {
        runOnUiThread(() -> {
            if (web == null || web.getUrl() == null || !trusted(request.getOrigin())
                    || !trusted(Uri.parse(web.getUrl())) || pendingMedia != null) {
                request.deny();
                return;
            }
            String[] resources = request.getResources();
            if (resources.length == 0) {
                request.deny();
                return;
            }
            boolean audio = false, video = false;
            for (String resource : resources) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) video = true;
                else {
                    request.deny();
                    return;
                }
            }
            ArrayList<String> permissions = new ArrayList<>();
            if (audio) permissions.add(Manifest.permission.RECORD_AUDIO);
            if (video) permissions.add(Manifest.permission.CAMERA);
            pendingMedia = request;
            pendingMediaResources = resources.clone();
            new AlertDialog.Builder(this)
                .setTitle("Allow KovaGPT media access?")
                .setMessage("Android will ask before allowing " +
                    (audio && video ? "microphone and camera" : audio ? "microphone" : "camera") +
                    " access. You can deny either request.")
                .setNegativeButton("Don't allow", (d, choice) -> denyPendingMedia())
                .setOnCancelListener(d -> denyPendingMedia())
                .setPositiveButton("Continue", (d, choice) ->
                    requestPermissions(permissions.toArray(new String[0]), MEDIA_PERMISSION))
                .show();
        });
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                                      int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != MEDIA_PERMISSION || pendingMedia == null) return;
        boolean granted = permissions.length > 0 && permissions.length == results.length;
        for (int result : results) granted &= result == PackageManager.PERMISSION_GRANTED;
        if (granted && web != null && web.getUrl() != null
                && trusted(pendingMedia.getOrigin()) && trusted(Uri.parse(web.getUrl()))) {
            pendingMedia.grant(pendingMediaResources);
            pendingMedia = null;
            pendingMediaResources = null;
        } else denyPendingMedia();
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        WebView.setWebContentsDebuggingEnabled(false);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (!req.isForMainFrame()) return false;
                if (trusted(req.getUrl())) return false;
                openExternal(req.getUrl());
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                         FileChooserParams params) {
                if (files != null) files.onReceiveValue(null);
                files = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                    params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(pick, PICK_FILES);
                    return true;
                } catch (ActivityNotFoundException e) {
                    files = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                requestMedia(request);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (pendingMedia == request) {
                        pendingMedia = null;
                        pendingMediaResources = null;
                    }
                });
            }
        });
        setContentView(web);
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(HOME);
    }

    private boolean nativeHapticsEnabled() {
        return getSharedPreferences("kova-native-settings", MODE_PRIVATE)
            .getBoolean("haptic-feedback", false);
    }

    private void confirmNativeAction() {
        // View-owned haptics defer to the user's system touch-feedback preference.
        if (nativeHapticsEnabled() && web != null)
            web.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
    }

    @Override public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "Share current page");
        menu.add(0, 2, 1, "About KovaGPT");
        menu.add(0, 3, 2, "Haptic feedback")
            .setCheckable(true).setChecked(nativeHapticsEnabled());
        return true;
    }
    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 3) {
            boolean enabled = !nativeHapticsEnabled();
            getSharedPreferences("kova-native-settings", MODE_PRIVATE).edit()
                .putBoolean("haptic-feedback", enabled).apply();
            item.setChecked(enabled);
            confirmNativeAction();
            return true;
        }
        if (item.getItemId() == 2) {
            confirmNativeAction();
            String version;
            try {
                version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                version = "Unavailable";
            }
            new AlertDialog.Builder(this)
                .setTitle("About KovaGPT")
                .setMessage("App version: " + version)
                .setPositiveButton("OK", null)
                .show();
            return true;
        }
        if (item.getItemId() != 1) return super.onOptionsItemSelected(item);
        confirmNativeAction();
        Uri uri = Uri.parse(web.getUrl() == null ? HOME : web.getUrl());
        if (trusted(uri)) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, uri.toString());
            startActivity(Intent.createChooser(send, "Share KovaGPT link"));
        }
        return true;
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILES || files == null) return;
        Uri[] selected = null;
        if (result == RESULT_OK && data != null) {
            ClipData clips = data.getClipData();
            if (clips != null) {
                selected = new Uri[clips.getItemCount()];
                for (int i = 0; i < clips.getItemCount(); i++)
                    selected[i] = clips.getItemAt(i).getUri();
            } else if (data.getData() != null) selected = new Uri[] { data.getData() };
        }
        files.onReceiveValue(selected);
        files = null;
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        web.saveState(out);
        super.onSaveInstanceState(out);
    }
    /** Ask the trusted Kova page to dismiss its topmost modal before leaving a route.
     * The evaluated script is a fixed constant and cannot accept web-supplied commands. */
    private static final String DISMISS_OPEN_OVERLAY =
        "(function(){"
        + "const drawer=document.querySelector('.kova-sidebar[role=dialog][data-state=open]');"
        + "if(drawer){const close=drawer.querySelector('button[aria-label=\\\"Close sidebar\\\"]');"
        + "if(close){close.click();return true;}}"
        + "const overlay=document.querySelector('[role=alertdialog],"
        + "[role=dialog][aria-modal=true], [role=menu][data-state=open], dialog[open]');"
        + "if(!overlay)return false;"
        + "document.dispatchEvent(new KeyboardEvent('keydown',"
        + "{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));return true;"
        + "})()";

    private void finishBackNavigation() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override public void onBackPressed() {
        if (web == null || web.getUrl() == null || !trusted(Uri.parse(web.getUrl()))) {
            finishBackNavigation();
            return;
        }
        // JavaScript is evaluated only in the exact first-party HTTPS WebView.
        web.evaluateJavascript(DISMISS_OPEN_OVERLAY, handled -> {
            if (!"true".equals(handled)) finishBackNavigation();
        });
    }
    @Override protected void onDestroy() {
        denyPendingMedia();
        if (files != null) files.onReceiveValue(null);
        files = null;
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        super.onDestroy();
    }
}
