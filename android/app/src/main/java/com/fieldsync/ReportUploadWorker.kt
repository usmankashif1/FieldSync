package com.fieldsync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

internal class ReportUploadWorker(
  context: Context,
  workerParams: WorkerParameters,
) : Worker(context, workerParams) {
  @Volatile
  private var activeConnection: HttpURLConnection? = null

  override fun doWork(): Result =
    try {
      setForegroundAsync(createForegroundInfo()).get()
      transferFile()
    } catch (error: Exception) {
      Result.failure(
        transferResult(
          successful = false,
          statusCode = 0,
          message = error.message ?: "The photo transfer failed.",
        ),
      )
    }

  override fun onStopped() {
    activeConnection?.disconnect()
    super.onStopped()
  }

  private fun transferFile(): Result {
    val filePath = inputData.getString(KEY_FILE_PATH)
      ?: return failure(0, "The local photo path is missing.")
    val uploadUrl = inputData.getString(KEY_UPLOAD_URL)
      ?: return failure(0, "The upload URL is missing.")
    val reportId = inputData.getString(KEY_REPORT_ID)
      ?: return failure(0, "The report identifier is missing.")
    val anonKey = inputData.getString(KEY_ANON_KEY)
      ?: return failure(0, "The publishable key is missing.")
    val contentType = inputData.getString(KEY_CONTENT_TYPE) ?: "image/jpeg"
    if (!uploadUrl.startsWith("https://")) {
      return failure(0, "The upload URL must use HTTPS.")
    }
    if (!contentType.startsWith("image/")) {
      return failure(0, "The photo content type is invalid.")
    }

    val file = File(filePath)
    if (!file.isFile || !file.canRead() || file.length() == 0L) {
      return failure(0, "The saved photo is no longer available.")
    }

    val connection = URL(uploadUrl).openConnection() as HttpURLConnection
    activeConnection = connection
    if (isStopped) {
      connection.disconnect()
      return failure(0, "The photo transfer was interrupted.")
    }
    val lastWriteAt = AtomicLong(System.currentTimeMillis())
    val writeWatchdog = watchdogExecutor.scheduleAtFixedRate(
      {
        if (System.currentTimeMillis() - lastWriteAt.get() > NETWORK_IDLE_TIMEOUT_MS) {
          connection.disconnect()
        }
      },
      WATCHDOG_CHECK_INTERVAL_MS.toLong(),
      WATCHDOG_CHECK_INTERVAL_MS.toLong(),
      TimeUnit.MILLISECONDS,
    )
    return try {
      setProgressAsync(Data.Builder().putInt(KEY_PROGRESS, 0).build()).get()
      connection.requestMethod = "POST"
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(file.length())
      connection.setRequestProperty("apikey", anonKey)
      connection.setRequestProperty("Authorization", "Bearer $anonKey")
      connection.setRequestProperty("Content-Type", contentType)
      connection.setRequestProperty("x-upsert", "true")
      connection.setRequestProperty("x-report-id", reportId)

      BufferedInputStream(FileInputStream(file)).use { input ->
        BufferedOutputStream(connection.outputStream).use { output ->
          val buffer = ByteArray(BUFFER_SIZE)
          var bytesWritten = 0L
          var nextProgress = 10
          var bytesRead = input.read(buffer)
          while (bytesRead >= 0) {
            if (isStopped) {
              throw IOException("The photo transfer was interrupted.")
            }
            if (bytesRead > 0) {
              output.write(buffer, 0, bytesRead)
              lastWriteAt.set(System.currentTimeMillis())
              bytesWritten += bytesRead
              val progress = ((bytesWritten * 100) / file.length()).toInt().coerceAtMost(99)
              if (progress >= nextProgress) {
                setProgressAsync(Data.Builder().putInt(KEY_PROGRESS, progress).build()).get()
                nextProgress = (progress / 10 + 1) * 10
              }
            }
            bytesRead = input.read(buffer)
          }
          output.flush()
        }
      }

      val response = readResponse(connection)
      val success = response.statusCode in 200..299
      Result.success(
        transferResult(
          successful = success,
          statusCode = response.statusCode,
          message = if (success) "" else response.body.ifBlank {
            "Server returned HTTP ${response.statusCode}."
          },
        ),
      )
    } catch (error: Exception) {
      failure(0, error.message ?: "The photo transfer failed.")
    } finally {
      writeWatchdog.cancel(false)
      connection.disconnect()
      if (activeConnection === connection) {
        activeConnection = null
      }
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
      .setContentText("A saved photo is being transferred.")
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

  private fun readResponse(connection: HttpURLConnection): HttpResponse {
    val statusCode = connection.responseCode
    val responseStream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
    val body = responseStream?.use { stream ->
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(BUFFER_SIZE)
      while (output.size() < MAX_RESPONSE_BYTES) {
        val remaining = MAX_RESPONSE_BYTES - output.size()
        val bytesRead = stream.read(buffer, 0, minOf(buffer.size, remaining))
        if (bytesRead < 0) break
        output.write(buffer, 0, bytesRead)
      }
      output.toString(StandardCharsets.UTF_8.name())
    }.orEmpty()
    return HttpResponse(statusCode, body)
  }

  private fun failure(statusCode: Int, message: String): Result =
    Result.failure(transferResult(successful = false, statusCode = statusCode, message = message))

  private fun transferResult(successful: Boolean, statusCode: Int, message: String): Data =
    Data.Builder()
      .putBoolean(KEY_SUCCESSFUL, successful)
      .putInt(KEY_STATUS_CODE, statusCode)
      .putString(KEY_MESSAGE, message)
      .build()

  private data class HttpResponse(val statusCode: Int, val body: String)

  companion object {
    const val KEY_REPORT_ID = "report_id"
    const val KEY_FILE_PATH = "file_path"
    const val KEY_UPLOAD_URL = "upload_url"
    const val KEY_ANON_KEY = "anon_key"
    const val KEY_CONTENT_TYPE = "content_type"
    const val KEY_PROGRESS = "progress"
    const val KEY_SUCCESSFUL = "successful"
    const val KEY_STATUS_CODE = "status_code"
    const val KEY_MESSAGE = "message"
    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val READ_TIMEOUT_MS = 120_000
    private const val NETWORK_IDLE_TIMEOUT_MS = 150_000
    private const val WATCHDOG_CHECK_INTERVAL_MS = 15_000
    private const val BUFFER_SIZE = 16 * 1024
    private const val MAX_RESPONSE_BYTES = 4096
    private const val NOTIFICATION_CHANNEL_ID = "field-report-uploads"
    private const val NOTIFICATION_ID = 4401
    private val watchdogExecutor = java.util.concurrent.Executors
      .newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "field-report-upload-watchdog").apply { isDaemon = true }
      }

    fun networkConstraints(): Constraints =
      Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
  }
}
