package com.kovagpt.health

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.LocalDate
import java.time.Period
import org.json.JSONArray
import org.json.JSONObject

internal object HealthReport {
    private val steps = HealthPermission.getReadPermission(StepsRecord::class)
    private val sleep = HealthPermission.getReadPermission(SleepSessionRecord::class)
    private val heartRate = HealthPermission.getReadPermission(HeartRateRecord::class)
    val permissions = setOf(steps, sleep, heartRate)

    suspend fun read(client: HealthConnectClient): JSONObject? {
        val granted = client.permissionController.getGrantedPermissions()
        val metrics = buildSet<AggregateMetric<*>> {
            if (steps in granted) add(StepsRecord.COUNT_TOTAL)
            if (sleep in granted) add(SleepSessionRecord.SLEEP_DURATION_TOTAL)
            if (heartRate in granted) add(HeartRateRecord.BPM_AVG)
        }
        if (metrics.isEmpty()) return null

        val today = LocalDate.now()
        // The default Health Connect grant covers history within 30 days.
        val start = today.minusDays(28)
        val result = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = metrics,
                timeRangeFilter = TimeRangeFilter.between(start.atStartOfDay(), today.plusDays(1).atStartOfDay()),
                timeRangeSlicer = Period.ofDays(1),
                dataOriginFilter = emptySet(),
            ),
        )
        val readings = mutableMapOf<String, JSONArray>()
        for (day in result.take(29)) {
            val date = day.startTime.toLocalDate()
            if (date < start || date > today) continue
            fun add(metric: String, value: Number?) {
                if (value != null) {
                    val entry = JSONObject().put("date", date.toString()).put("value", value)
                    readings.getOrPut(metric) { JSONArray() }.put(entry)
                }
            }
            if (steps in granted) add("StepCount", day.result[StepsRecord.COUNT_TOTAL])
            if (sleep in granted) {
                add("SleepAnalysis", day.result[SleepSessionRecord.SLEEP_DURATION_TOTAL]?.toMillis()?.div(3_600_000.0))
            }
            if (heartRate in granted) add("HeartRate", day.result[HeartRateRecord.BPM_AVG])
        }
        return JSONObject().put("asOf", today.toString()).put("metrics", JSONObject(readings))
    }
}
