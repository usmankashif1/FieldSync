package com.fieldsync

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

class FieldReportQueueModule(
  private val appContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(appContext) {
  private val ioExecutor = Executors.newSingleThreadExecutor()

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun getReports(promise: Promise) {
    execute(promise) {
      reportsToWritableArray(ReportQueueStore.getReports(appContext))
    }
  }

  @ReactMethod
  fun recoverInterruptedUploads(promise: Promise) {
    execute(promise) {
      val workInfos = androidx.work.WorkManager.getInstance(appContext)
        .getWorkInfosForUniqueWork(ReportUploadWorker.UNIQUE_WORK_NAME)
        .get()
      val uploadIsRunning = workInfos.any { info -> info.state == androidx.work.WorkInfo.State.RUNNING }
      if (!uploadIsRunning) {
        val reports = ReportQueueStore.getReports(appContext)
        for (index in 0 until reports.length()) {
          val report = reports.getJSONObject(index)
          if (report.optString("status") != "uploading") {
            continue
          }

          report.put("status", if (report.optInt("retryCount", 0) > 0) "retrying" else "queued")
          report.optJSONArray("images")?.let { images ->
            for (imageIndex in 0 until images.length()) {
              val image = images.getJSONObject(imageIndex)
              if (image.optString("status") == "uploading") {
                image.put("status", "pending")
                  .put("progress", 0)
              }
            }
          }
          ReportQueueStore.updateReport(appContext, report)
        }
      }
      null
    }
  }

  @ReactMethod
  fun enqueueReport(description: String, imageUris: ReadableArray, promise: Promise) {
    execute(promise) {
      val cleanDescription = description.trim()
      require(cleanDescription.isNotEmpty()) { "A report description is required." }
      require(cleanDescription.length <= MAX_DESCRIPTION_CHARACTERS) {
        "A report description can contain no more than $MAX_DESCRIPTION_CHARACTERS characters."
      }
      require(imageUris.size() in 1..MAX_IMAGES) {
        "A report must contain between 1 and $MAX_IMAGES photos."
      }

      val sources = (0 until imageUris.size()).map { index ->
        require(imageUris.getType(index) == ReadableType.String) { "A selected photo has an invalid URI." }
        imageUris.getString(index)
          ?.takeIf { it.isNotBlank() }
          ?: throw IllegalArgumentException("A selected photo has an invalid URI.")
      }
      val reportId = UUID.randomUUID().toString()
      val images = JSONArray()

      try {
        sources.forEachIndexed { index, source ->
          images.put(ReportMediaStore.prepareImage(appContext, source, reportId, index))
        }

        val report = JSONObject()
          .put("id", reportId)
          .put("description", cleanDescription)
          .put("images", images)
          .put("status", "queued")
          .put("retryCount", 0)
          .put("createdAt", System.currentTimeMillis())
          .put("retryable", true)
        ReportQueueStore.addReport(appContext, report)
        reportToWritableMap(report)
      } catch (error: Exception) {
        ReportMediaStore.deleteReportMedia(appContext, reportId)
        throw error
      }
    }
  }

  @ReactMethod
  fun retryReport(reportId: String, promise: Promise) {
    execute(promise) {
      require(reportId.isNotBlank()) { "The report identifier is required." }
      val reports = ReportQueueStore.getReports(appContext)
      val report = findReport(reports, reportId)
        ?: throw IllegalArgumentException("This report is no longer in the local queue.")

      report.put("status", "queued")
        .put("retryCount", 0)
        .put("retryable", true)
        .put("error", JSONObject.NULL)
      report.remove("lastAttemptAt")
      report.optJSONArray("images")?.let { images ->
        for (index in 0 until images.length()) {
          val image = images.getJSONObject(index)
          if (image.optString("status") != "completed") {
            image.put("status", "pending")
              .put("progress", 0)
              .put("error", JSONObject.NULL)
          }
        }
      }

      ReportQueueStore.updateReport(appContext, report)
      null
    }
  }

  @ReactMethod
  fun clearQueue(promise: Promise) {
    execute(promise) {
      androidx.work.WorkManager.getInstance(appContext)
        .cancelUniqueWork(ReportUploadWorker.UNIQUE_WORK_NAME)
        .result
        .get()
      ReportQueueStore.clear(appContext)
      null
    }
  }

  @ReactMethod
  fun migrateLegacyQueue(legacyQueue: String, promise: Promise) {
    execute(promise) {
      val legacyReports = JSONArray(legacyQueue)
      val currentReports = ReportQueueStore.getReports(appContext)
      val currentIds = (0 until currentReports.length())
        .map { currentReports.getJSONObject(it).optString("id") }
        .toMutableSet()
      val migratedReports = JSONArray()
      for (index in 0 until currentReports.length()) {
        migratedReports.put(currentReports.getJSONObject(index))
      }

      for (index in 0 until legacyReports.length()) {
        val legacyReport = legacyReports.optJSONObject(index)
          ?: throw IllegalArgumentException("A saved report has invalid local data.")
        val reportId = legacyReport.optString("id").ifBlank { UUID.randomUUID().toString() }
        if (!currentIds.add(reportId)) {
          continue
        }
        migratedReports.put(migrateReport(legacyReport, reportId))
      }

      ReportQueueStore.replaceReports(appContext, migratedReports)
      null
    }
  }

  @ReactMethod
  fun scheduleQueue(url: String, anonKey: String, delayMs: Double, promise: Promise) {
    execute(promise) {
      val backendUrl = url.trim().trimEnd('/')
      val publishableKey = anonKey.trim()
      require(backendUrl.startsWith("https://")) { "The Supabase URL must use HTTPS." }
      require(publishableKey.isNotEmpty()) { "The Supabase publishable key is missing." }
      require(!publishableKey.startsWith("sb_secret_") && publishableKey != "service_role") {
        "A Supabase secret or service-role key cannot be used in a mobile app."
      }

      ReportUploadWorker.enqueue(appContext, backendUrl, publishableKey, delayMs.toLong().coerceAtLeast(0))
      null
    }
  }

  override fun invalidate() {
    ioExecutor.shutdown()
    super.invalidate()
  }

  private fun migrateReport(legacy: JSONObject, reportId: String): JSONObject {
    val oldImages = legacy.optJSONArray("images")
    val oldUris = legacy.optJSONArray("localImageUris")
    val uploadedUrls = legacy.optJSONArray("uploadedImageUrls")
    val imageCount = oldImages?.length() ?: oldUris?.length() ?: 0
    val images = JSONArray()
    var missingPendingImage = false

    for (index in 0 until imageCount) {
      val oldImage = oldImages?.optJSONObject(index)
      val source = oldImage?.optString("uri")?.takeIf { it.isNotBlank() }
        ?: oldUris?.optString(index)?.takeIf { it.isNotBlank() }
        ?: ""
      val url = oldImage?.optString("url")?.takeIf { it.isNotBlank() }
        ?: uploadedUrls?.optString(index)?.takeIf { it.isNotBlank() }
      val isCompleted = oldImage?.optString("status") == "completed" || url != null

      if (source.isNotEmpty()) {
        try {
          val image = ReportMediaStore.prepareImage(appContext, source, reportId, index)
          if (isCompleted) {
            image.put("status", "completed")
            url?.let { image.put("url", it) }
          }
          images.put(image)
        } catch (error: Exception) {
          if (isCompleted) {
            images.put(
              JSONObject()
                .put("uri", "")
                .put("status", "completed")
                .put("url", url ?: JSONObject.NULL)
                .put("error", error.message ?: "The local preview is no longer available."),
            )
          } else {
            missingPendingImage = true
            images.put(
              JSONObject()
                .put("uri", "")
                .put("status", "failed")
                .put("error", error.message ?: "The selected photo is no longer available."),
            )
          }
        }
      } else if (isCompleted) {
        images.put(
          JSONObject()
            .put("uri", "")
            .put("status", "completed")
            .put("url", url ?: JSONObject.NULL),
        )
      } else {
        missingPendingImage = true
        images.put(
          JSONObject()
            .put("uri", "")
            .put("status", "failed")
            .put("error", "The selected photo is no longer available. Add it to a new report."),
        )
      }
    }

    val description = legacy.optString("description").trim()
    val missingDescription = description.isEmpty()
    val wasSynced = legacy.optString("status") == "synced"
    val status = when {
      wasSynced -> "synced"
      missingPendingImage || missingDescription -> "failed"
      else -> "queued"
    }

    return JSONObject()
      .put("id", reportId)
      .put("description", description)
      .put("images", images)
      .put("status", status)
      .put("retryCount", legacy.optInt("retryCount", 0))
      .put("createdAt", legacy.optLong("createdAt", System.currentTimeMillis()))
      .put("retryable", !missingPendingImage && !missingDescription && !wasSynced)
      .put(
        "error",
        if (missingPendingImage) {
          "A saved photo could not be recovered. Add it to a new report."
        } else if (missingDescription) {
          "A saved report has no description and must be recreated."
        } else {
          JSONObject.NULL
        },
      )
  }

  private fun findReport(reports: JSONArray, reportId: String): JSONObject? {
    for (index in 0 until reports.length()) {
      val report = reports.getJSONObject(index)
      if (report.optString("id") == reportId) {
        return report
      }
    }
    return null
  }

  private fun execute(promise: Promise, action: () -> Any?) {
    ioExecutor.execute {
      try {
        promise.resolve(action())
      } catch (error: Exception) {
        promise.reject("FIELD_REPORT_QUEUE_ERROR", error.message, error)
      }
    }
  }

  private fun reportsToWritableArray(reports: JSONArray): WritableArray {
    val array = Arguments.createArray()
    for (index in 0 until reports.length()) {
      array.pushMap(jsonToWritableMap(reports.getJSONObject(index)))
    }
    return array
  }

  private fun reportToWritableMap(report: JSONObject): WritableMap = jsonToWritableMap(report)

  private fun jsonToWritableMap(json: JSONObject): WritableMap {
    val map = Arguments.createMap()
    val keys = json.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      when (val value = json.get(key)) {
        JSONObject.NULL -> map.putNull(key)
        is String -> map.putString(key, value)
        is Boolean -> map.putBoolean(key, value)
        is Int -> map.putInt(key, value)
        is Number -> map.putDouble(key, value.toDouble())
        is JSONObject -> map.putMap(key, jsonToWritableMap(value))
        is JSONArray -> map.putArray(key, jsonToWritableArray(value))
        else -> map.putString(key, value.toString())
      }
    }
    return map
  }

  private fun jsonToWritableArray(json: JSONArray): WritableArray {
    val array = Arguments.createArray()
    for (index in 0 until json.length()) {
      when (val value = json.get(index)) {
        JSONObject.NULL -> array.pushNull()
        is String -> array.pushString(value)
        is Boolean -> array.pushBoolean(value)
        is Int -> array.pushInt(value)
        is Number -> array.pushDouble(value.toDouble())
        is JSONObject -> array.pushMap(jsonToWritableMap(value))
        is JSONArray -> array.pushArray(jsonToWritableArray(value))
        else -> array.pushString(value.toString())
      }
    }
    return array
  }

  companion object {
    const val MODULE_NAME = "FieldReportQueue"
    private const val MAX_IMAGES = 5
    private const val MAX_DESCRIPTION_CHARACTERS = 500
  }
}
