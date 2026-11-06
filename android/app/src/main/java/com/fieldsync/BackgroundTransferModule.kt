package com.fieldsync

import android.util.Base64
import androidx.work.BackoffPolicy
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class BackgroundTransferModule(
  private val appContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(appContext) {
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun startReportUpload(
    reportId: String,
    description: String,
    createdAt: String,
    imagesJson: String,
    supabaseUrl: String,
    anonKey: String,
    promise: Promise,
  ) {
    execute(promise) {
      enqueueReport(reportId, description, createdAt, imagesJson, supabaseUrl, anonKey)
      null
    }
  }

  @ReactMethod
  fun getReportUploadStatus(reportId: String, promise: Promise) {
    execute(promise) {
      require(reportId.isNotBlank()) { "A report identifier is required." }
      val workManager = WorkManager.getInstance(appContext)
      val infos = workManager.getWorkInfosForUniqueWork(workName(reportId)).get()
      val info = infos.firstOrNull { !it.state.isFinished } ?: infos.lastOrNull()
      val result = Arguments.createMap()
      if (info == null) {
        result.putString("state", "NOT_FOUND")
        result.putInt("progress", 0)
      } else {
        val outputData = info.outputData
        val progressData = info.progress
        result.putString("state", info.state.name)
        result.putInt(
          "progress",
          outputData.getInt(
            ReportUploadWorker.KEY_PROGRESS,
            progressData.getInt(ReportUploadWorker.KEY_PROGRESS, 0),
          ),
        )
        result.putInt(
          "imageIndex",
          outputData.getInt(
            ReportUploadWorker.KEY_IMAGE_INDEX,
            progressData.getInt(ReportUploadWorker.KEY_IMAGE_INDEX, -1),
          ),
        )
        val imageUrl = outputData.getString(ReportUploadWorker.KEY_IMAGE_URL)
          ?: progressData.getString(ReportUploadWorker.KEY_IMAGE_URL)
        imageUrl?.let {
          result.putString("imageUrl", it)
        }
        val imageUrlsJson = outputData.getString(ReportUploadWorker.KEY_IMAGE_URLS)
          ?: progressData.getString(ReportUploadWorker.KEY_IMAGE_URLS)
        imageUrlsJson?.let { imageUrls ->
          val urls = Arguments.createArray()
          val parsedUrls = org.json.JSONArray(imageUrls)
          for (index in 0 until parsedUrls.length()) {
            urls.pushString(parsedUrls.getString(index))
          }
          result.putArray("imageUrls", urls)
        }
        result.putBoolean(
          "successful",
          outputData.getBoolean(ReportUploadWorker.KEY_SUCCESSFUL, false),
        )
        result.putInt(
          "statusCode",
          outputData.getInt(
            ReportUploadWorker.KEY_STATUS_CODE,
            progressData.getInt(ReportUploadWorker.KEY_STATUS_CODE, 0),
          ),
        )
        val message = outputData.getString(ReportUploadWorker.KEY_MESSAGE)
          ?: progressData.getString(ReportUploadWorker.KEY_MESSAGE)
        message?.let {
          result.putString("message", it)
        }
      }
      result
    }
  }

  @ReactMethod
  fun cancelReportTransfers(reportId: String, promise: Promise) {
    execute(promise) {
      require(reportId.isNotBlank()) { "A report identifier is required." }
      WorkManager.getInstance(appContext).cancelAllWorkByTag(reportTag(reportId)).result.get()
      null
    }
  }

  override fun invalidate() {
    executor.shutdown()
    super.invalidate()
  }

  private fun enqueueReport(
    reportId: String,
    description: String,
    createdAt: String,
    imagesJson: String,
    supabaseUrl: String,
    anonKey: String,
  ) {
    require(reportId.isNotBlank()) { "A report identifier is required." }
    require(description.isNotBlank()) { "A report description is required." }
    require(createdAt.isNotBlank()) { "The report creation time is required." }
    require(imagesJson.isNotBlank()) { "The prepared photos are missing." }
    require(supabaseUrl.startsWith("https://")) { "The Supabase URL must use HTTPS." }
    require(anonKey.isNotBlank()) { "The Supabase publishable key is missing." }
    require(isPublishableKey(anonKey)) {
      "A Supabase secret or service-role key cannot be used in a mobile app."
    }

    val input = Data.Builder()
      .putString(ReportUploadWorker.KEY_REPORT_ID, reportId)
      .putString(ReportUploadWorker.KEY_DESCRIPTION, description)
      .putString(ReportUploadWorker.KEY_CREATED_AT, createdAt)
      .putString(ReportUploadWorker.KEY_IMAGES, imagesJson)
      .putString(ReportUploadWorker.KEY_SUPABASE_URL, supabaseUrl.trimEnd('/'))
      .putString(ReportUploadWorker.KEY_ANON_KEY, anonKey)
      .build()
    val request = OneTimeWorkRequestBuilder<ReportUploadWorker>()
      .setInputData(input)
      .setConstraints(ReportUploadWorker.networkConstraints())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, RETRY_BACKOFF_MS, TimeUnit.MILLISECONDS)
      .addTag(reportTag(reportId))
      .build()

    val workManager = WorkManager.getInstance(appContext)
    if (workManager.getWorkInfosForUniqueWork(workName(reportId)).get().isEmpty()) {
      workManager.cancelAllWorkByTag(reportTag(reportId)).result.get()
    }
    workManager.enqueueUniqueWork(workName(reportId), ExistingWorkPolicy.KEEP, request)
      .result
      .get()
  }

  private fun execute(promise: Promise, action: () -> Any?) {
    executor.execute {
      try {
        promise.resolve(action())
      } catch (error: Exception) {
        promise.reject("BACKGROUND_TRANSFER_ERROR", error.message, error)
      }
    }
  }

  private fun workName(reportId: String): String = "$REPORT_WORK_PREFIX$reportId"

  private fun reportTag(reportId: String): String = "$REPORT_TAG_PREFIX$reportId"

  private fun isPublishableKey(key: String): Boolean {
    if (key.isBlank() || key.startsWith("sb_secret_") || key == "service_role") {
      return false
    }
    val parts = key.split('.')
    if (parts.size == 3) {
      return try {
        val payload = String(
          Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP),
          StandardCharsets.UTF_8,
        )
        JSONObject(payload).optString("role") != "service_role"
      } catch (_: Exception) {
        true
      }
    }
    return true
  }

  companion object {
    const val MODULE_NAME = "BackgroundTransfer"
    private const val REPORT_WORK_PREFIX = "field-report-upload:"
    private const val REPORT_TAG_PREFIX = "field-report:"
    private const val RETRY_BACKOFF_MS = 30_000L
  }
}
