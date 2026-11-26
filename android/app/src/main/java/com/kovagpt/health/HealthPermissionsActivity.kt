package com.kovagpt.health

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle

class HealthPermissionsActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AlertDialog.Builder(this)
            .setTitle(R.string.app_name)
            .setMessage(
                getString(R.string.health_connect_privacy) + "\n\n" + getString(R.string.health_step_write_privacy),
            )
            .setPositiveButton(android.R.string.ok) { _, _ -> finish() }
            .setOnCancelListener { finish() }
            .show()
    }
}
