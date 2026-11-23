package com.kovagpt.health

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.text.DateFormat
import java.time.Instant
import java.time.ZoneId
import java.util.Date
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import org.json.JSONObject

class HealthActivity : ComponentActivity() {
    private data class Session(val id: String, val owner: String)
    private data class StepEntry(val session: Session, val count: Long, val start: Instant, val end: Instant)

    private lateinit var webView: WebView
    private val preferences by lazy { getSharedPreferences("kova_health", MODE_PRIVATE) }
    private var hasBridge = false
    private var foreground = false
    private var session: Session? = null
    private var awaitingPermissions: Session? = null
    private var refresh: Job? = null
    private var consentDialog: AlertDialog? = null
    private var stepDialog: AlertDialog? = null
    private var stepEntry: StepEntry? = null
    private var awaitingStepPermission: StepEntry? = null
    private var readyToWriteSteps = false
    private var stepWrite: Job? = null

    private val requestStepPermission = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { granted ->
        val entry = awaitingStepPermission
        awaitingStepPermission = null
        if (entry != null && current(entry.session) && stepEntry == entry) {
            if (WRITE_STEPS in granted) {
                readyToWriteSteps = true
                saveSteps()
            } else {
                finishSteps(entry, "permission_required")
            }
        }
    }

    private val requestPermissions = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { granted ->
        val approved = awaitingPermissions
        awaitingPermissions = null
        if (approved != null && current(approved)) {
            if (granted.none { it in HealthReport.permissions }) {
                sendState(approved, "permission_required")
                stop()
            } else {
                preferences.edit().putString(APPROVED_OWNER, approved.owner).apply()
                startRead(approved)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || trusted(request.url)) return false
                if (request.hasGesture() && request.url.scheme == "https") {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: ActivityNotFoundException) {
                        // Stay on the Health page if a browser is unavailable.
                    }
                }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                stop()
                if (!trusted(url?.let(Uri::parse))) view.stopLoading()
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            hasBridge = true
            WebViewCompat.addWebMessageListener(webView, BRIDGE, setOf(ORIGIN)) { view, message, origin, mainFrame, _ ->
                if (view === webView && mainFrame && trusted(origin)) receive(message.data)
            }
        }
        setContentView(webView)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        webView.loadUrl("$ORIGIN/apps?connection_view=health")
    }

    override fun onResume() {
        super.onResume()
        foreground = true
        session?.let { startRead(it) }
        saveSteps()
    }

    override fun onPause() {
        foreground = false
        if (refresh?.isActive == true) session?.let { sendState(it, "paused") }
        refresh?.cancel()
        refresh = null
        super.onPause()
    }

    override fun onDestroy() {
        stop()
        if (hasBridge) WebViewCompat.removeWebMessageListener(webView, BRIDGE)
        webView.destroy()
        super.onDestroy()
    }

    private fun receive(raw: String?) {
        if (raw == null || raw.length > 512) return
        val message = try { JSONObject(raw) } catch (_: org.json.JSONException) { return }
        val id = uuid(message.optString("id")) ?: return
        val action = message.optString("action")
        val active = session
        if (active != null && active.id == id && (action == "stop" || action == "disconnect")) {
            if (action == "disconnect" && isApproved(active)) {
                preferences.edit().remove(APPROVED_OWNER).apply()
            }
            stop()
            return
        }
        if (active != null && active.id == id && action == "record_steps") {
            confirmSteps(active, message)
            return
        }
        if (active != null || !foreground || !isHealthPage() || action !in setOf("start", "resume")) return
        val owner = uuid(message.optString("owner")) ?: return
        val requested = Session(id, owner)
        session = requested
        if (HealthConnectClient.getSdkStatus(this) != HealthConnectClient.SDK_AVAILABLE) {
            if (action == "start") Toast.makeText(this, R.string.health_connect_unavailable, Toast.LENGTH_LONG).show()
            sendState(requested, "unavailable")
            stop()
            return
        }
        if (action == "resume") {
            if (isApproved(requested)) startRead(requested)
            else {
                sendState(requested, "not_connected")
                stop()
            }
            return
        }
        if (awaitingPermissions != null) {
            sendState(requested, "permission_required")
            stop()
            return
        }
        consentDialog = AlertDialog.Builder(this)
            .setTitle(R.string.health_connect_title)
            .setMessage(R.string.health_connect_privacy)
            .setNegativeButton(android.R.string.cancel) { _, _ -> cancelConsent(requested) }
            .setOnCancelListener { cancelConsent(requested) }
            .setPositiveButton(R.string.health_connect_continue) { _, _ ->
                if (current(requested)) {
                    awaitingPermissions = requested
                    try {
                        requestPermissions.launch(HealthReport.permissions)
                    } catch (_: ActivityNotFoundException) {
                        awaitingPermissions = null
                        sendState(requested, "unavailable")
                        stop()
                    }
                }
            }
            .show()
    }

    private fun confirmSteps(bound: Session, message: JSONObject) {
        if (!current(bound) || !isApproved(bound) || stepEntry != null) return
        if (!foreground || awaitingStepPermission != null) {
            send(bound, JSONObject().put("stepWriteState", "error"))
            return
        }
        val count = message.optString("count").toLongOrNull()
        val start = message.optString("start").toLongOrNull()
        val end = message.optString("end").toLongOrNull()
        if (count == null || count !in 1L..1_000_000L || start == null || end == null ||
            start <= 0 || start >= end || end > System.currentTimeMillis()
        ) {
            send(bound, JSONObject().put("stepWriteState", "invalid"))
            return
        }
        val entry = StepEntry(bound, count, Instant.ofEpochMilli(start), Instant.ofEpochMilli(end))
        stepEntry = entry
        val format = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
        stepDialog = AlertDialog.Builder(this)
            .setTitle(R.string.health_step_write_title)
            .setMessage(getString(
                R.string.health_step_write_review, count, format.format(Date(start)), format.format(Date(end)),
            ))
            .setNegativeButton(android.R.string.cancel) { _, _ -> finishSteps(entry, "cancelled") }
            .setOnCancelListener { finishSteps(entry, "cancelled") }
            .setPositiveButton(R.string.health_step_write_confirm) { _, _ -> authorizeSteps(entry) }
            .show()
    }

    private fun authorizeSteps(entry: StepEntry) {
        if (!foreground || !current(entry.session) || !isApproved(entry.session)) {
            finishSteps(entry, "cancelled")
            return
        }
        lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@HealthActivity)
                val granted = client.permissionController.getGrantedPermissions()
                if (stepEntry != entry || !current(entry.session) || !isApproved(entry.session)) return@launch
                if (!foreground) {
                    finishSteps(entry, "cancelled")
                } else if (WRITE_STEPS in granted) {
                    readyToWriteSteps = true
                    saveSteps()
                } else {
                    awaitingStepPermission = entry
                    requestStepPermission.launch(setOf(WRITE_STEPS))
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (awaitingStepPermission == entry) awaitingStepPermission = null
                finishSteps(entry, "error")
            }
        }
    }

    private fun saveSteps() {
        val entry = stepEntry ?: return
        if (!readyToWriteSteps || !foreground || !current(entry.session) || !isApproved(entry.session)) return
        readyToWriteSteps = false
        stepWrite = lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@HealthActivity)
                val rules = ZoneId.systemDefault().rules
                client.insertRecords(
                    listOf(
                        StepsRecord(
                            count = entry.count,
                            startTime = entry.start,
                            endTime = entry.end,
                            startZoneOffset = rules.getOffset(entry.start),
                            endZoneOffset = rules.getOffset(entry.end),
                            metadata = Metadata.manualEntry(),
                        ),
                    ),
                )
                finishSteps(entry, "saved")
                refresh?.cancel()
                refresh = null
                startRead(entry.session)
            } catch (error: CancellationException) {
                throw error
            } catch (_: SecurityException) {
                finishSteps(entry, "permission_required")
            } catch (_: Exception) {
                finishSteps(entry, "error")
            }
        }
    }

    private fun finishSteps(entry: StepEntry, state: String) {
        if (stepEntry != entry) return
        stepEntry = null
        readyToWriteSteps = false
        stepDialog = null
        send(entry.session, JSONObject().put("stepWriteState", state))
    }

    private fun startRead(bound: Session) {
        if (!foreground || refresh?.isActive == true || awaitingPermissions != null ||
            !current(bound) || !isApproved(bound)
        ) return
        refresh = lifecycleScope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(this@HealthActivity)
                while (foreground && current(bound) && isApproved(bound)) {
                    val report = HealthReport.read(client)
                    ensureActive()
                    if (!foreground || !current(bound) || !isApproved(bound)) break
                    if (report == null) {
                        sendState(bound, "permission_required")
                        stop()
                        break
                    }
                    send(bound, JSONObject().put("report", report).put("canWriteSteps", true))
                    delay(60_000)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: SecurityException) {
                if (current(bound)) {
                    sendState(bound, "permission_required")
                    stop()
                }
            } catch (_: Exception) {
                if (current(bound)) {
                    sendState(bound, "error")
                    stop()
                }
            }
        }
    }

    private fun cancelConsent(bound: Session) {
        if (!current(bound)) return
        sendState(bound, "not_connected")
        stop()
    }

    private fun sendState(bound: Session, state: String) = send(bound, JSONObject().put("state", state))

    private fun send(bound: Session, values: JSONObject) {
        if (!current(bound)) return
        val payload = JSONObject.quote(values.put("id", bound.id).toString())
        webView.evaluateJavascript(
            """
            if (location.origin === '$ORIGIN' && location.pathname === '/apps' &&
                new URLSearchParams(location.search).get('connection_view') === 'health') {
              window.dispatchEvent(new CustomEvent('kova-health-update-v1', {detail: JSON.parse($payload)}));
            }
            """.trimIndent(),
            null,
        )
    }

    private fun stop() {
        session = null
        stepEntry = null
        readyToWriteSteps = false
        stepWrite?.cancel()
        stepWrite = null
        stepDialog?.dismiss()
        stepDialog = null
        refresh?.cancel()
        refresh = null
        consentDialog?.dismiss()
        consentDialog = null
    }

    private fun current(bound: Session) = session == bound && isHealthPage()
    private fun isApproved(bound: Session) = preferences.getString(APPROVED_OWNER, null) == bound.owner

    private fun isHealthPage(): Boolean {
        val url = webView.url?.let(Uri::parse) ?: return false
        return trusted(url) && url.path == "/apps" && url.getQueryParameter("connection_view") == "health"
    }

    private fun trusted(uri: Uri?): Boolean =
        uri != null && uri.scheme == "https" && uri.host == BuildConfig.HEALTH_WEB_HOST && uri.userInfo == null &&
            (uri.port == -1 || uri.port == 443)

    private fun uuid(value: String): String? {
        if (value.length != 36) return null
        val canonical = try { UUID.fromString(value).toString() } catch (_: IllegalArgumentException) { return null }
        return canonical.takeIf { it.equals(value, ignoreCase = true) }
    }

    companion object {
        private const val ORIGIN = "https://" + BuildConfig.HEALTH_WEB_HOST
        private const val BRIDGE = "kovaAndroidHealth"
        private const val APPROVED_OWNER = "approved_owner"
        private val WRITE_STEPS = HealthPermission.getWritePermission(StepsRecord::class)
    }
}
