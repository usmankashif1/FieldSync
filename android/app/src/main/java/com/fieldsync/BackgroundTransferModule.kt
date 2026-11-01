package com.fieldsync

import android.util.AtomicFile
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.FileNotFoundException
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

class BackgroundTransferModule(
  private val appContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(appContext) {
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = MODULE_NAME

  @ReactMethod
  fun startTransfer(
    taskId: String,
    reportId: String,
    filePath: String,
    uploadUrl: String,
    anonKey: String,
    mimeType: String,
    promise: Promise,
  ) {
    execute(promise) {
      enqueueTransfer(taskId, reportId, filePath, uploadUrl, anonKey, mimeType, ExistingWorkPolicy.KEEP)
      null
    }
  }

  @ReactMethod
  fun restartTransfer(
    taskId: String,
    reportId: String,
    filePath: String,
    uploadUrl: String,
    anonKey: String,
    mimeType: String,
    promise: Promise,
  ) {
    execute(promise) {
      enqueueTransfer(taskId, reportId, filePath, uploadUrl, anonKey, mimeType, ExistingWorkPolicy.REPLACE)
      null
    }
  }

  @ReactMethod
  fun getTransferStatus(taskId: String, promise: Promise) {
    execute(promise) {
      require(taskId.isNotBlank()) { "A transfer identifier is required." }
      val infos = WorkManager.getInstance(appContext)
        .getWorkInfosForUniqueWork(workName(taskId))
        .get()
      val info = infos.firstOrNull { !it.state.isFinished } ?: infos.lastOrNull()
      val result = Arguments.createMap()
      if (info == null) {
        result.putString("state", "NOT_FOUND")
        result.putInt("progress", 0)
      } else {
        result.putString("state", info.state.name)
        result.putInt("progress", info.progress.getInt(ReportUploadWorker.KEY_PROGRESS, 0))
        result.putBoolean(
          "successful",
          info.outputData.getBoolean(ReportUploadWorker.KEY_SUCCESSFUL, false),
        )
        result.putInt(
          "statusCode",
          info.outputData.getInt(ReportUploadWorker.KEY_STATUS_CODE, 0),
        )
        info.outputData.getString(ReportUploadWorker.KEY_MESSAGE)?.let {
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

  @ReactMethod
  fun readLegacyQueue(promise: Promise) {
    execute(promise) {
      val file = AtomicFile(appContext.filesDir.resolve(LEGACY_QUEUE_FILE))
      try {
        file.openRead().bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
      } catch (_: FileNotFoundException) {
        null
      }
    }
  }

  @ReactMethod
  fun finishLegacyQueueMigration(promise: Promise) {
    execute(promise) {
      WorkManager.getInstance(appContext).cancelUniqueWork(LEGACY_WORK_NAME).result.get()
      AtomicFile(appContext.filesDir.resolve(LEGACY_QUEUE_FILE)).delete()
      null
    }
  }

  override fun invalidate() {
    executor.shutdown()
    super.invalidate()
  }

  private fun enqueueTransfer(
    taskId: String,
    reportId: String,
    filePath: String,
    uploadUrl: String,
    anonKey: String,
    mimeType: String,
    policy: ExistingWorkPolicy,
  ) {
    require(taskId.isNotBlank()) { "A transfer identifier is required." }
    require(reportId.isNotBlank()) { "A report identifier is required." }
    require(filePath.isNotBlank()) { "A local photo path is required." }
    require(uploadUrl.startsWith("https://")) { "The upload URL must use HTTPS." }
    require(anonKey.isNotBlank()) { "The Supabase publishable key is missing." }
    require(!anonKey.startsWith("sb_secret_") && anonKey != "service_role") {
      "A Supabase secret or service-role key cannot be used in a mobile app."
    }
    require(mimeType.startsWith("image/")) { "The photo content type is invalid." }

    val input = Data.Builder()
      .putString(ReportUploadWorker.KEY_REPORT_ID, reportId)
      .putString(ReportUploadWorker.KEY_FILE_PATH, filePath)
      .putString(ReportUploadWorker.KEY_UPLOAD_URL, uploadUrl)
      .putString(ReportUploadWorker.KEY_ANON_KEY, anonKey)
      .putString(ReportUploadWorker.KEY_CONTENT_TYPE, mimeType)
      .build()
    val request = OneTimeWorkRequestBuilder<ReportUploadWorker>()
      .setInputData(input)
      .setConstraints(ReportUploadWorker.networkConstraints())
      .addTag(reportTag(reportId))
      .build()
    WorkManager.getInstance(appContext)
      .enqueueUniqueWork(workName(taskId), policy, request)
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

  private fun workName(taskId: String): String = "$TRANSFER_WORK_PREFIX$taskId"

  private fun reportTag(reportId: String): String = "$REPORT_TAG_PREFIX$reportId"

  companion object {
    const val MODULE_NAME = "BackgroundTransfer"
    private const val TRANSFER_WORK_PREFIX = "field-report-transfer:"
    private const val REPORT_TAG_PREFIX = "field-report:"
    private const val LEGACY_QUEUE_FILE = "field-report-queue.json"
    private const val LEGACY_WORK_NAME = "field-report-upload-queue"
  }
}
