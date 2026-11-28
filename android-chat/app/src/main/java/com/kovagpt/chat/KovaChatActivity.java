package com.kovagpt.chat;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ActivityNotFoundException;
import android.content.res.Configuration;
import android.content.pm.PackageManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.fragment.app.FragmentActivity;
import androidx.webkit.WebViewCompat;
import androidx.webkit.JavaScriptReplyProxy;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;

public final class KovaChatActivity extends FragmentActivity {
    private static final String LOCK = "device-lock";
    static final String TASKS_CHANNEL = "scheduled_tasks";
    private static final String UPDATES_CHANNEL = "account_updates";
    private static final int AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    private WebView web;
    private LinearLayout lockView;
    private TextView lockMessage;
    private AudioManager audioManager;
    private boolean locked;
    private boolean verifying;
    private boolean visible;
    private String voiceServiceId;
    private final BroadcastReceiver voiceServiceState = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String id = intent.getStringExtra(KovaVoiceService.ID);
            if (id == null || !id.equals(voiceServiceId)) return;
            boolean running = intent.getBooleanExtra(KovaVoiceService.RUNNING, false);
            if (!running) voiceServiceId = null;
            if (web == null || locked || !KovaDestination.isTrusted(web.getUrl())) return;
            web.evaluateJavascript("if(location.origin==='https://kovagpt.com') "
                + "window.dispatchEvent(new CustomEvent('kova-android-voice-service',{detail:{id:"
                + JSONObject.quote(id) + ",running:" + running + "}}));", null);
        }
    };
    private boolean webWatchesBack;
    private PermissionRequest pendingMicrophone;
    private ValueCallback<Uri[]> pendingFiles;
    private Uri pendingPhoto;
    private KovaDestination destinationAfterUnlock;
    private Uri googleExchangeAfterUnlock;

    private final OnBackPressedCallback webBack = new OnBackPressedCallback(false) {
        @Override public void handleOnBackPressed() {
            if (locked) {
                finish();
                return;
            }
            String script = "location.origin === 'https://kovagpt.com' && "
                + "!window.dispatchEvent(new Event('kova-native-back', {cancelable:true}))";
            web.evaluateJavascript(script, handled -> {
                if ("true".equals(handled) || isFinishing()) return;
                if (web.canGoBack()) web.goBack();
                else finish();
            });
        }
    };
    private final AudioDeviceCallback audioRoutes = new AudioDeviceCallback() {
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            for (AudioDeviceInfo device : removed) {
                int type = device.getType();
                if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                    || type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                    || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLE_HEADSET) {
                    stopVoiceService();
                    signal("kova-native-audio-interruption");
                    return;
                }
            }
        }
    };

    private final ActivityResultLauncher<String> microphone = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(), granted -> {
            PermissionRequest request = pendingMicrophone;
            pendingMicrophone = null;
            if (request == null) return;
            if (granted && !locked && KovaDestination.isTrusted(web.getUrl())
                && KovaDestination.isTrusted(request.getOrigin().toString())) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else request.deny();
        }
    );
    private final ActivityResultLauncher<String> notifications = registerForActivityResult(
        new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted && !locked) openNotificationSettings();
        }
    );
    private final ActivityResultLauncher<PickVisualMediaRequest> photos = registerForActivityResult(
        new ActivityResultContracts.PickVisualMedia(), uri -> completeFiles(uri == null ? null : new Uri[]{uri})
    );
    private final ActivityResultLauncher<PickVisualMediaRequest> multiplePhotos = registerForActivityResult(
        new ActivityResultContracts.PickMultipleVisualMedia(20), uris -> completeFiles(
            uris.isEmpty() ? null : uris.toArray(new Uri[0]))
    );
    private final ActivityResultLauncher<Intent> documents = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> completeFiles(WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData()))
    );
    private final ActivityResultLauncher<Uri> camera = registerForActivityResult(
        new ActivityResultContracts.TakePicture(), saved -> {
            Uri result = pendingPhoto;
            pendingPhoto = null;
            completeFiles(saved && result != null ? new Uri[]{result} : null, result);
        }
    );

    @Override protected void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout root = new FrameLayout(this);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime()
            );
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        updateSystemBars(root);
        web = new WebView(this);
        root.addView(web);
        lockView = createLockView();
        root.addView(lockView);
        setContentView(root);
        ViewCompat.requestApplyInsets(root);
        getOnBackPressedDispatcher().addCallback(this, webBack);
        locked = getPreferences(MODE_PRIVATE).getBoolean(LOCK, false);
        presentLock();
        configureWeb();
        createNotificationChannels();
        audioManager = getSystemService(AudioManager.class);
        audioManager.registerAudioDeviceCallback(audioRoutes, null);
        ContextCompat.registerReceiver(this, voiceServiceState,
            new IntentFilter(KovaVoiceService.STATE), ContextCompat.RECEIVER_NOT_EXPORTED);
        if (openGoogleExchange(getIntent().getData())) return;
        if (savedState == null || web.restoreState(savedState) == null) {
            KovaDestination initial = KovaDestination.fromShortcut(getIntent().getDataString());
            open(initial == null ? KovaDestination.CHAT : initial);
        }
    }

    private void updateSystemBars(View root) {
        boolean light = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            != Configuration.UI_MODE_NIGHT_YES;
        int color = light ? 0xfff7f7f8 : 0xff111111;
        root.setBackgroundColor(color);
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightStatusBars(light);
        WindowCompat.getInsetsController(getWindow(), root).setAppearanceLightNavigationBars(light);
    }

    private LinearLayout createLockView() {
        LinearLayout panel = new LinearLayout(this);
        panel.setGravity(Gravity.CENTER);
        panel.setOrientation(LinearLayout.VERTICAL);
        lockMessage = new TextView(this);
        lockMessage.setTextSize(20);
        lockMessage.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        panel.addView(lockMessage);
        Button unlock = new Button(this);
        unlock.setText("Unlock KovaGPT");
        unlock.setMinimumHeight((int) (48 * getResources().getDisplayMetrics().density));
        unlock.setOnClickListener(view -> authenticate(null));
        panel.addView(unlock);
        return panel;
    }

    private void configureWeb() {
        android.webkit.WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " KovaGPTNative/Android");
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri url = request.getUrl();
                if (KovaDestination.isTrusted(url.toString())) {
                    String challenge = url.getQueryParameter("native_challenge");
                    if ("/api/auth/google/start".equals(url.getPath()) && challenge != null
                            && challenge.matches("[a-f0-9]{64}")) {
                        if (!locked && KovaDestination.isTrusted(web.getUrl()))
                            launchExternal(new Intent(Intent.ACTION_VIEW, url));
                        return true;
                    }
                    return false;
                }
                if (!locked && "https".equals(url.getScheme()) && url.getUserInfo() == null
                    && (request.hasGesture() || "accounts.google.com".equals(url.getHost()))) {
                    launchExternal(new Intent(Intent.ACTION_VIEW, url));
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                stopVoiceService();
                webWatchesBack = false;
                if (pendingMicrophone != null) {
                    pendingMicrophone.deny();
                    pendingMicrophone = null;
                }
                completeFiles(null);
                refreshBack();
            }
            @Override public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                refreshBack();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (locked || !KovaDestination.isTrusted(request.getOrigin().toString())
                    || !KovaDestination.isTrusted(web.getUrl()) || pendingMicrophone != null
                    || !Arrays.equals(request.getResources(), new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE})) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    pendingMicrophone = request;
                    microphone.launch(Manifest.permission.RECORD_AUDIO);
                }
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMicrophone == request) pendingMicrophone = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                chooseFiles(callback, params);
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "kovaNative", Collections.singleton(KovaDestination.ORIGIN),
                (view, message, origin, mainFrame, reply) -> {
                    if (!locked && mainFrame && KovaDestination.isTrusted(origin.toString())
                        && KovaDestination.isTrusted(web.getUrl())) {
                        handleMessage(message.getData(), reply);
                    }
                });
        }
    }

    private void chooseFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        completeFiles(null);
        if (locked || !KovaDestination.isTrusted(web.getUrl())) {
            callback.onReceiveValue(null);
            return;
        }
        pendingFiles = callback;
        String[] types = params.getAcceptTypes();
        boolean imageOnly = types.length > 0 && Arrays.stream(types).allMatch(type -> type.startsWith("image/"));
        try {
            if (imageOnly && params.isCaptureEnabled()) {
                File folder = new File(getCacheDir(), "composer-camera");
                if (!folder.mkdirs() && !folder.isDirectory()) throw new IOException("Camera cache unavailable");
                File[] previous = folder.listFiles();
                if (previous != null) for (File file : previous) {
                    if (file.lastModified() < System.currentTimeMillis() - 86_400_000L) file.delete();
                }
                File photo = File.createTempFile("capture-", ".jpg", folder);
                pendingPhoto = FileProvider.getUriForFile(this, getPackageName() + ".camera", photo);
                camera.launch(pendingPhoto);
            } else if (imageOnly && Arrays.stream(types).allMatch("image/*"::equals)) {
                PickVisualMediaRequest request =
                    new PickVisualMediaRequest.Builder().setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE).build();
                if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) multiplePhotos.launch(request);
                else photos.launch(request);
            } else {
                documents.launch(params.createIntent());
            }
        } catch (ActivityNotFoundException | IOException failure) {
            pendingPhoto = null;
            completeFiles(null);
        }
    }

    private void completeFiles(Uri[] result) {
        completeFiles(result, null);
    }

    private void completeFiles(Uri[] result, Uri cameraResult) {
        ValueCallback<Uri[]> callback = pendingFiles;
        pendingFiles = null;
        if (callback == null) return;
        if (!KovaDestination.isTrusted(web.getUrl())) {
            callback.onReceiveValue(null);
            return;
        }
        Uri[] safe = result == null ? null : Arrays.stream(result)
            .filter(uri -> uri != null && "content".equals(uri.getScheme())
                && (!(getPackageName() + ".camera").equals(uri.getAuthority()) || uri.equals(cameraResult)))
            .toArray(Uri[]::new);
        callback.onReceiveValue(safe == null || safe.length == 0 ? null : safe);
    }

    private void handleMessage(String raw, JavaScriptReplyProxy reply) {
        if (raw == null || raw.length() > 40_000) return;
        try {
            JSONObject message = new JSONObject(raw);
            switch (message.optString("action")) {
                case "android-voice-start":
                    String voiceId = message.optString("id");
                    if (visible && !locked && voiceServiceId == null
                        && voiceId.matches("[a-f0-9-]{36}")
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        try {
                            voiceServiceId = voiceId;
                            ContextCompat.startForegroundService(this,
                                new Intent(this, KovaVoiceService.class).putExtra(KovaVoiceService.ID, voiceId));
                        } catch (RuntimeException unavailable) {
                            voiceServiceId = null;
                        }
                    }
                    break;
                case "android-voice-stop":
                    if (message.optString("id").equals(voiceServiceId)) stopVoiceService();
                    break;
                case "haptic":
                    web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                    break;
                case "device-lock":
                    authenticate(!getPreferences(MODE_PRIVATE).getBoolean(LOCK, false));
                    break;
                case "push-token":
                    String requestId = message.optString("requestId");
                    if (!requestId.matches("[a-f0-9-]{36}")) return;
                    if (FirebaseApp.getApps(this).isEmpty()
                        || !getSystemService(NotificationManager.class).areNotificationsEnabled()) {
                        reply.postMessage(requestId + ":");
                        return;
                    }
                    FirebaseMessaging.getInstance().getToken().addOnCompleteListener(this, result -> {
                        if (!locked && KovaDestination.isTrusted(web.getUrl())) {
                            reply.postMessage(requestId + ":" + (result.isSuccessful() ? result.getResult() : ""));
                        }
                    });
                    break;
                case "notifications":
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) notifications.launch(Manifest.permission.POST_NOTIFICATIONS);
                    else openNotificationSettings();
                    break;
                case "watch-back":
                    webWatchesBack = message.optBoolean("active");
                    refreshBack();
                    break;
                case "share":
                    String text = message.optString("text");
                    if (!text.isEmpty() && text.length() <= 32_768) {
                        Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
                        launchExternal(Intent.createChooser(share, null));
                    }
                    break;
                default:
                    break;
            }
        } catch (JSONException malformed) {
            // Malformed web messages never reach a native action.
        }
    }

    private void createNotificationChannels() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(TASKS_CHANNEL, "Scheduled tasks", NotificationManager.IMPORTANCE_DEFAULT));
        manager.createNotificationChannel(new NotificationChannel(UPDATES_CHANNEL, "Account updates", NotificationManager.IMPORTANCE_LOW));
    }

    private void openNotificationSettings() {
        launchExternal(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
    }

    private void authenticate(Boolean preference) {
        if (verifying) return;
        if (BiometricManager.from(this).canAuthenticate(AUTHENTICATORS) != BiometricManager.BIOMETRIC_SUCCESS) {
            android.widget.Toast.makeText(this, "Set up a device screen lock in Settings.", android.widget.Toast.LENGTH_LONG).show();
            return;
        }
        verifying = true;
        BiometricPrompt prompt = new BiometricPrompt(this, ContextCompat.getMainExecutor(this),
            new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    verifying = false;
                    if (preference != null) getPreferences(MODE_PRIVATE).edit().putBoolean(LOCK, preference).apply();
                    setLocked(false);
                    if (googleExchangeAfterUnlock != null) {
                        web.loadUrl(googleExchangeAfterUnlock.toString());
                        googleExchangeAfterUnlock = null;
                        destinationAfterUnlock = null;
                    }
                    if (destinationAfterUnlock != null) {
                        KovaDestination destination = destinationAfterUnlock;
                        destinationAfterUnlock = null;
                        open(destination);
                    }
                }
                @Override public void onAuthenticationError(int code, CharSequence error) {
                    verifying = false;
                }
            });
        prompt.authenticate(new BiometricPrompt.PromptInfo.Builder()
            .setTitle(preference == null ? "Unlock KovaGPT" : "Change KovaGPT device lock")
            .setAllowedAuthenticators(AUTHENTICATORS)
            .build());
    }

    private void setLocked(boolean value) {
        if (value) stopVoiceService();
        locked = value;
        presentLock();
    }

    private void presentLock() {
        web.setVisibility(locked ? View.INVISIBLE : View.VISIBLE);
        web.setImportantForAccessibility(locked ? View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            : View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        lockView.setVisibility(locked ? View.VISIBLE : View.GONE);
        lockMessage.setText("KovaGPT is locked");
        refreshBack();
    }

    private void refreshBack() {
        webBack.setEnabled(locked || webWatchesBack || (web != null && web.canGoBack()));
    }

    private void launchExternal(Intent intent) {
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException unavailable) {
            android.widget.Toast.makeText(this, "No application can open this item.", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    private void signal(String event) {
        if (!KovaDestination.isTrusted(web.getUrl())) return;
        web.evaluateJavascript("if(location.origin==='https://kovagpt.com') window.dispatchEvent(new Event("
            + JSONObject.quote(event) + "));", null);
    }

    private void open(KovaDestination destination) {
        if (locked) {
            destinationAfterUnlock = destination;
            return;
        }
        Uri current = web.getUrl() == null ? null : Uri.parse(web.getUrl());
        if (destination == KovaDestination.VOICE && current != null && "/".equals(current.getPath())
            && KovaDestination.isTrusted(current.toString())) signal("kova-native-open-voice");
        else web.loadUrl(destination.url);
    }

    private boolean openGoogleExchange(Uri callback) {
        if (callback == null || !"kovagpt-native".equals(callback.getScheme())
                || !"google".equals(callback.getEncodedAuthority())
                || !"/exchange".equals(callback.getEncodedPath()) || callback.getFragment() != null)
            return false;
        if (callback.getQueryParameterNames().size() != 2
                || callback.getQueryParameters("handoff").size() != 1
                || callback.getQueryParameters("binding").size() != 1) return false;
        String handoff = callback.getQueryParameter("handoff");
        String binding = callback.getQueryParameter("binding");
        if (handoff == null || !handoff.matches("[A-Za-z0-9_-]{43,128}") || binding == null
                || binding.isEmpty() || binding.length() > 4096) return false;
        Uri exchange = Uri.parse(KovaDestination.ORIGIN + "/api/auth/google/exchange").buildUpon()
                .appendQueryParameter("handoff", handoff).appendQueryParameter("binding", binding)
                .build();
        if (locked) googleExchangeAfterUnlock = exchange;
        else web.loadUrl(exchange.toString());
        return true;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (openGoogleExchange(intent.getData())) return;
        KovaDestination next = KovaDestination.fromShortcut(intent.getDataString());
        if (next != null) open(next);
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        web.getSettings().setTextZoom(Math.round(configuration.fontScale * 100));
        updateSystemBars((View) web.getParent());
    }
    private void stopVoiceService() {
        if (voiceServiceId == null) return;
        voiceServiceId = null;
        stopService(new Intent(this, KovaVoiceService.class));
    }

    @Override protected void onStart() {
        super.onStart();
        visible = true;
        if (web != null) signal("kova-native-foreground");
    }
    @Override protected void onStop() {
        visible = false;
        if (!verifying && getPreferences(MODE_PRIVATE).getBoolean(LOCK, false)) {
            stopVoiceService();
            signal("kova-native-audio-interruption");
            setLocked(true);
        } else {
            signal("kova-native-background");
        }
        super.onStop();
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }
    @Override protected void onDestroy() {
        stopVoiceService();
        unregisterReceiver(voiceServiceState);
        audioManager.unregisterAudioDeviceCallback(audioRoutes);
        completeFiles(null);
        if (pendingMicrophone != null) pendingMicrophone.deny();
        ((FrameLayout) web.getParent()).removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
