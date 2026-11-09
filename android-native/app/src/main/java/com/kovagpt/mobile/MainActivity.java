package com.kovagpt.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Native navigation, sharing and file selection without exposing a JavaScript bridge. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://kovagpt.com/";
    private static final int PICK_FILES = 1031;
    private WebView web;
    private ValueCallback<Uri[]> files;

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
            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) {
                // No implicit camera, microphone or other native permissions.
                request.deny();
            }
        });
        setContentView(web);
        if (saved != null) web.restoreState(saved);
        else web.loadUrl(HOME);
    }

    @Override public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "Share current page");
        return true;
    }
    @Override public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() != 1) return super.onOptionsItemSelected(item);
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
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (files != null) files.onReceiveValue(null);
        files = null;
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        super.onDestroy();
    }
}
