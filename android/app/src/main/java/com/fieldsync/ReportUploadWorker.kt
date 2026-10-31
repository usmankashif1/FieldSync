package com.fieldsync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

internal class ReportUploadWorker(
  context: Context,
  workerParams: WorkerParameters,
) : Worker(context, workerParams) {
  override fun doWork(): Result {
    val reports = try {
      ReportQueueStore.getReports(applicationContext)
    } catch (error: Exception) {
      Log.e(TAG, "Could not read the local report queue.", error)
      return Result.failure()
    }

    val hasPendingReports = (0 until reports.length()).any { index ->
      val report = reports.optJSONObject(index) ?: return@any false
      report.optString("status") != "synced" &&
        !(report.optString("status") == "failed" && !report.optBoolean("retryable", true))
    }
    if (!hasPendingReports) {
      return Result.success()
    }

    val backendUrl = inputData.getString(KEY_BACKEND_URL)
    val anonKey = inputData.getString(KEY_ANON_KEY)
    if (backendUrl.isNullOrBlank() || anonKey.isNullOrBlank()) {
      markConfigurationFailure(reports, "Upload configuration is missing. Check the Supabase settings.")
      return Result.failure()
    }

    try {
      setForegroundAsync(createForegroundInfo()).get()
      processReports(reports, backendUrl.trimEnd('/'), anonKey)
      return Result.success()
    } catch (error: UploadFailure) {
      if (error.retryable) {
        return Result.retry()
      }
      Log.e(TAG, "Report upload worker stopped on a permanent failure.", error)
      return Result.failure()
    } catch (error: Exception) {
      Log.e(TAG, "Unexpected report upload worker failure.", error)
      markInterruptedReportsAsRetrying()
      return Result.retry()
    }
  }

  private fun processReports(reports: JSONArray, backendUrl: String, anonKey: String) {
    for (index in 0 until reports.length()) {
      if (isStopped) {
        throw UploadFailure("Upload work was stopped.", true)
      }

      val report = reports.optJSONObject(index) ?: continue
      val status = report.optString("status")
      if (status == "synced" || (status == "failed" && !report.optBoolean("retryable", true))) {
        continue
      }

      report.put("status", "uploading")
        .put("retryable", true)
        .put("lastAttemptAt", System.currentTimeMillis())
        .put("error", JSONObject.NULL)
      ReportQueueStore.updateReport(applicationContext, report)

      try {
        uploadReport(report, backendUrl, anonKey)
        report.put("status", "synced")
          .put("retryable", false)
          .put("error", JSONObject.NULL)
        ReportQueueStore.updateReport(applicationContext, report)
      } catch (error: UploadFailure) {
        recordReportFailure(report, error)
        if (error.retryable) {
          throw error
        }
      } catch (error: SocketTimeoutException) {
        val uploadFailure = UploadFailure(error.message ?: "The server took too long to respond.", true)
        recordReportFailure(report, uploadFailure)
        throw uploadFailure
      } catch (error: IOException) {
        val uploadFailure = UploadFailure(error.message ?: "The network connection was interrupted.", true)
        recordReportFailure(report, uploadFailure)
        throw uploadFailure
      } catch (error: Exception) {
        val uploadFailure = UploadFailure(
          error.message ?: "The report could not be uploaded. Check its details and try again.",
          false,
        )
        recordReportFailure(report, uploadFailure)
      }
    }
  }

  private fun uploadReport(report: JSONObject, backendUrl: String, anonKey: String) {
    val reportId = report.getString("id")
    val images = report.optJSONArray("images")
      ?: throw UploadFailure("The report has no saved photos.", false)
    if (images.length() !in 1..MAX_IMAGES) {
      throw UploadFailure("A report must contain between 1 and $MAX_IMAGES photos.", false)
    }

    val imageUrls = JSONArray()
    for (index in 0 until images.length()) {
      val image = images.getJSONObject(index)
      if (image.optString("status") == "completed" && image.optString("url").isNotBlank()) {
        imageUrls.put(image.getString("url"))
        continue
      }

      val imageFile = localFile(image.optString("uri"))
      if (!imageFile.isFile || !imageFile.canRead() || imageFile.length() == 0L) {
        val failure = UploadFailure("Saved photo ${index + 1} is no longer available on this device.", false)
        image.put("status", "failed").put("error", failure.message)
        ReportQueueStore.updateReport(applicationContext, report)
        throw failure
      }
      if (imageFile.length() > ReportMediaStore.MAX_IMAGE_BYTES) {
        val failure = UploadFailure("Photo ${index + 1} exceeds the 5 MB upload limit.", false)
        image.put("status", "failed").put("error", failure.message)
        ReportQueueStore.updateReport(applicationContext, report)
        throw failure
      }

      image.put("status", "uploading")
        .put("progress", 0)
        .put("error", JSONObject.NULL)
      ReportQueueStore.updateReport(applicationContext, report)

      val objectPath = "reports/$reportId/$index.jpg"
      try {
        uploadImage(backendUrl, anonKey, objectPath, imageFile, report, image)
      } catch (error: Exception) {
        val failure = classifyUploadError(error)
        image.put("status", "failed").put("error", failure.message)
        ReportQueueStore.updateReport(applicationContext, report)
        throw failure
      }

      val publicUrl = "$backendUrl/storage/v1/object/public/field-reports/$objectPath"
      image.put("status", "completed")
        .put("url", publicUrl)
        .put("progress", 100)
        .put("error", JSONObject.NULL)
      ReportQueueStore.updateReport(applicationContext, report)
      imageUrls.put(publicUrl)
    }

    val createdAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      .apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(Date(report.optLong("createdAt", System.currentTimeMillis())))
    val reportBody = JSONObject()
      .put("id", reportId)
      .put("description", report.getString("description"))
      .put("image_urls", imageUrls)
      .put("created_at", createdAt)

    val response = executeRequest(
      "$backendUrl/rest/v1/reports?on_conflict=id",
      "POST",
      mapOf(
        "apikey" to anonKey,
        "Authorization" to "Bearer $anonKey",
        "Content-Type" to "application/json",
        "Prefer" to "resolution=merge-duplicates,return=minimal",
      ),
      "[$reportBody]".toByteArray(StandardCharsets.UTF_8),
    )
    requireSuccess(response)
  }

  private fun uploadImage(
    backendUrl: String,
    anonKey: String,
    objectPath: String,
    imageFile: File,
    report: JSONObject,
    image: JSONObject,
  ) {
    val encodedPath = objectPath.split('/').joinToString("/") {
      java.net.URLEncoder.encode(it, StandardCharsets.UTF_8.name()).replace("+", "%20")
    }
    val connection = (URL("$backendUrl/storage/v1/object/field-reports/$encodedPath").openConnection() as HttpURLConnection)
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(imageFile.length())
      connection.setRequestProperty("apikey", anonKey)
      connection.setRequestProperty("Authorization", "Bearer $anonKey")
      connection.setRequestProperty("Content-Type", "image/jpeg")
      connection.setRequestProperty("x-upsert", "true")
      BufferedInputStream(FileInputStream(imageFile)).use { input ->
        BufferedOutputStream(connection.outputStream).use { output ->
          val buffer = ByteArray(16 * 1024)
          var totalWritten = 0L
          var nextProgressThreshold = 10
          var bytesRead = input.read(buffer)
          while (bytesRead >= 0) {
            if (bytesRead > 0) {
              output.write(buffer, 0, bytesRead)
              totalWritten += bytesRead
              val progress = ((totalWritten * 100) / imageFile.length()).toInt().coerceAtMost(99)
              if (progress >= nextProgressThreshold) {
                image.put("progress", progress)
                ReportQueueStore.updateReport(applicationContext, report)
                nextProgressThreshold = (progress / 10 + 1) * 10
              }
            }
            bytesRead = input.read(buffer)
          }
          output.flush()
        }
      }
      requireSuccess(readResponse(connection))
    } finally {
      connection.disconnect()
    }
  }

  private fun executeRequest(
    requestUrl: String,
    method: String,
    headers: Map<String, String>,
    body: ByteArray,
  ): HttpResponse {
    val connection = URL(requestUrl).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = method
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.doOutput = true
      headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      connection.setFixedLengthStreamingMode(body.size)
      connection.outputStream.use { output -> output.write(body) }
      return readResponse(connection)
    } finally {
      connection.disconnect()
    }
  }

  private fun readResponse(connection: HttpURLConnection): HttpResponse {
    val statusCode = connection.responseCode
    val responseStream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
    val responseBody = responseStream?.use { stream ->
      val buffer = ByteArray(1024)
      val output = ByteArrayOutputStream()
      while (output.size() < MAX_RESPONSE_BYTES) {
        val remaining = MAX_RESPONSE_BYTES - output.size()
        val bytesRead = stream.read(buffer, 0, minOf(buffer.size, remaining))
        if (bytesRead < 0) {
          break
        }
        output.write(buffer, 0, bytesRead)
      }
      output.toString(StandardCharsets.UTF_8.name())
    }.orEmpty()
    return HttpResponse(statusCode, responseBody)
  }

  private fun requireSuccess(response: HttpResponse) {
    if (response.statusCode in 200..299) {
      return
    }
    val retryable = response.statusCode == 408 ||
      response.statusCode == 425 ||
      response.statusCode == 429 ||
      response.statusCode >= 500
    val detail = response.body.trim().takeIf { it.isNotEmpty() }
    val message = detail?.let { "Server returned HTTP ${response.statusCode}: $it" }
      ?: "Server returned HTTP ${response.statusCode}."
    throw UploadFailure(message, retryable)
  }

  private fun classifyUploadError(error: Exception): UploadFailure = when (error) {
    is UploadFailure -> error
    is SocketTimeoutException -> UploadFailure(error.message ?: "The server took too long to respond.", true)
    is IOException -> UploadFailure(error.message ?: "The network connection was interrupted.", true)
    else -> UploadFailure(error.message ?: "The photo could not be uploaded.", false)
  }

  private fun recordReportFailure(report: JSONObject, failure: UploadFailure) {
    report.put("status", if (failure.retryable) "retrying" else "failed")
      .put("retryable", failure.retryable)
      .put("retryCount", report.optInt("retryCount", 0) + 1)
      .put("error", failure.message)
    ReportQueueStore.updateReport(applicationContext, report)
    Log.w(TAG, "Report ${report.optString("id")} upload failed: ${failure.message}")
  }

  private fun markConfigurationFailure(reports: JSONArray, message: String) {
    for (index in 0 until reports.length()) {
      val report = reports.optJSONObject(index) ?: continue
      if (report.optString("status") == "synced") {
        continue
      }
      report.put("status", "failed")
        .put("retryable", false)
        .put("error", message)
      report.optJSONArray("images")?.let { images ->
        for (imageIndex in 0 until images.length()) {
          val image = images.getJSONObject(imageIndex)
          if (image.optString("status") == "uploading") {
            image.put("status", "pending")
              .put("progress", 0)
          }
        }
      }
      ReportQueueStore.updateReport(applicationContext, report)
    }
  }

  private fun markInterruptedReportsAsRetrying() {
    try {
      val reports = ReportQueueStore.getReports(applicationContext)
      for (index in 0 until reports.length()) {
        val report = reports.getJSONObject(index)
        if (report.optString("status") != "uploading") {
          continue
        }
        report.put("status", "retrying")
          .put("retryable", true)
          .put("retryCount", report.optInt("retryCount", 0) + 1)
        report.optJSONArray("images")?.let { images ->
          for (imageIndex in 0 until images.length()) {
            val image = images.getJSONObject(imageIndex)
            if (image.optString("status") == "uploading") {
              image.put("status", "pending")
                .put("progress", 0)
            }
          }
        }
        ReportQueueStore.updateReport(applicationContext, report)
      }
    } catch (error: Exception) {
      Log.e(TAG, "Could not persist interrupted report status.", error)
    }
  }

  private fun createForegroundInfo(): ForegroundInfo {
    val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          NOTIFICATION_CHANNEL_ID,
          "Report uploads",
          NotificationManager.IMPORTANCE_LOW,
        ),
      )
    }

    val notification = NotificationCompat.Builder(applicationContext, NOTIFICATION_CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Uploading field reports")
      .setContentText("Saved reports are syncing in the background.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }

  private fun localFile(uri: String): File {
    val path = android.net.Uri.parse(uri).path
      ?: throw UploadFailure("A saved photo path is invalid.", false)
    return File(path)
  }

  private data class HttpResponse(val statusCode: Int, val body: String)

  private class UploadFailure(
    override val message: String,
    val retryable: Boolean,
  ) : Exception(message)

  companion object {
    const val UNIQUE_WORK_NAME = "field-report-upload-queue"
    private const val TAG = "FieldReportUpload"
    private const val KEY_BACKEND_URL = "supabase_url"
    private const val KEY_ANON_KEY = "supabase_anon_key"
    private const val MAX_IMAGES = 5
    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val READ_TIMEOUT_MS = 120_000
    private const val MAX_RESPONSE_BYTES = 4096
    private const val NOTIFICATION_CHANNEL_ID = "field-report-uploads"
    private const val NOTIFICATION_ID = 4401

    fun enqueue(context: Context, url: String, anonKey: String, delayMs: Long) {
      val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
      val input = Data.Builder()
        .putString(KEY_BACKEND_URL, url)
        .putString(KEY_ANON_KEY, anonKey)
        .build()
      val request = OneTimeWorkRequestBuilder<ReportUploadWorker>()
        .setConstraints(constraints)
        .setInputData(input)
        .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        .build()

      WorkManager.getInstance(context).enqueueUniqueWork(
        UNIQUE_WORK_NAME,
        ExistingWorkPolicy.APPEND_OR_REPLACE,
        request,
      ).result.get()
    }
  }
}
