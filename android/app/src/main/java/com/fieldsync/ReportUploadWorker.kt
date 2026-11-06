package com.fieldsync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
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
      uploadReport()
    } catch (error: IOException) {
      retry(error.message ?: "The report upload was interrupted.")
    } catch (error: Exception) {
      failure(0, error.message ?: "The report upload failed.")
    }

  override fun onStopped() {
    activeConnection?.disconnect()
    super.onStopped()
  }

  private fun uploadReport(): Result {
    val reportId = inputData.getString(KEY_REPORT_ID)
      ?: return failure(0, "The report identifier is missing.")
    val description = inputData.getString(KEY_DESCRIPTION)
      ?: return failure(0, "The report description is missing.")
    val createdAt = inputData.getString(KEY_CREATED_AT)
      ?: return failure(0, "The report creation time is missing.")
    val supabaseUrl = inputData.getString(KEY_SUPABASE_URL)?.trimEnd('/')
      ?: return failure(0, "The Supabase URL is missing.")
    val anonKey = inputData.getString(KEY_ANON_KEY)
      ?: return failure(0, "The publishable key is missing.")
    val imagesJson = inputData.getString(KEY_IMAGES)
      ?: return failure(0, "The prepared photos are missing.")

    if (!supabaseUrl.startsWith("https://")) {
      return failure(0, "The Supabase URL must use HTTPS.")
    }
    if (!isPublishableKey(anonKey)) {
      return failure(0, "A Supabase publishable/anon key is required.")
    }
    if (description.isBlank() || description.length > MAX_DESCRIPTION_LENGTH) {
      return failure(0, "The report description is invalid.")
    }

    val images = try {
      JSONArray(imagesJson)
    } catch (_: Exception) {
      return failure(0, "The prepared photo list is invalid.")
    }
    if (images.length() !in 1..MAX_IMAGES) {
      return failure(0, "A report must contain between 1 and $MAX_IMAGES photos.")
    }

    val imageUrls = try {
      SequentialReportUpload<String>(
        uploadPhoto = { index, completedImageUrls ->
          if (isStopped) {
            throw UploadAborted(failure(0, "The report upload was cancelled."))
          }

          val image = images.optJSONObject(index)
            ?: throw UploadAborted(failure(0, "Photo ${index + 1} has invalid upload data."))
          val filePath = image.optString("filePath")
          val mimeType = image.optString("mimeType", "image/jpeg")
          val contentType = image.optString("contentType", "image/jpeg")
          if (!contentType.startsWith("image/")) {
            throw UploadAborted(failure(0, "Photo ${index + 1} has an invalid content type."))
          }

          val file = File(filePath)
          if (!file.isFile || !file.canRead() || file.length() == 0L) {
            throw UploadAborted(
              failure(0, "The saved copy of photo ${index + 1} is no longer available."),
            )
          }

          val objectPath = "reports/$reportId/$index.${fileExtension(mimeType)}"
          val uploadUrl = "$supabaseUrl/storage/v1/object/field-reports/$objectPath"
          setPhotoProgress(index, 0, imageUrls = completedImageUrls)

          val response = try {
            uploadPhoto(
              uploadUrl,
              reportId,
              anonKey,
              contentType,
              file,
              index,
              completedImageUrls,
            )
          } catch (error: IOException) {
            throw UploadAborted(
              retry(error.message ?: "Photo ${index + 1} could not be uploaded."),
            )
          }
          if (response.statusCode !in 200..299) {
            val message = response.body.ifBlank {
              "Server returned HTTP ${response.statusCode} while uploading photo ${index + 1}."
            }
            throw UploadAborted(httpFailure(response.statusCode, message))
          }

          val publicUrl = "$supabaseUrl/storage/v1/object/public/field-reports/$objectPath"
          setPhotoProgress(
            index,
            100,
            publicUrl,
            completedImageUrls + publicUrl,
          )
          publicUrl
        },
        submitReport = { uploadedImageUrls ->
          val reportRow = JSONObject()
            .put("id", reportId)
            .put("description", description)
            .put("image_urls", JSONArray(uploadedImageUrls))
            .put("created_at", createdAt)
            .toString()
            .toByteArray(StandardCharsets.UTF_8)

          val rowResponse = try {
            request(
              "$supabaseUrl/rest/v1/reports?on_conflict=id",
              anonKey,
              "application/json",
              reportRow,
            )
          } catch (error: IOException) {
            throw UploadAborted(
              retry(error.message ?: "The report could not be saved."),
            )
          }
          if (rowResponse.statusCode !in 200..299) {
            val message = rowResponse.body.ifBlank {
              "Server returned HTTP ${rowResponse.statusCode} while saving the report."
            }
            throw UploadAborted(httpFailure(rowResponse.statusCode, message))
          }
        },
      ).execute(images.length())
    } catch (error: UploadAborted) {
      return error.result
    }

    return Result.success(
      Data.Builder()
        .putBoolean(KEY_SUCCESSFUL, true)
        .putString(KEY_IMAGE_URLS, JSONArray(imageUrls).toString())
        .putInt(KEY_PROGRESS, 100)
        .build(),
    )
  }

  private fun uploadPhoto(
    uploadUrl: String,
    reportId: String,
    anonKey: String,
    contentType: String,
    file: File,
    imageIndex: Int,
    completedImageUrls: List<String>,
  ): HttpResponse {
    val connection = URL(uploadUrl).openConnection() as HttpURLConnection
    activeConnection = connection
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
              throw IOException("The report upload was interrupted.")
            }
            if (bytesRead > 0) {
              output.write(buffer, 0, bytesRead)
              lastWriteAt.set(System.currentTimeMillis())
              bytesWritten += bytesRead
              val progress = ((bytesWritten * 100) / file.length()).toInt().coerceAtMost(99)
              if (progress >= nextProgress) {
                setPhotoProgress(imageIndex, progress, imageUrls = completedImageUrls)
                nextProgress = (progress / 10 + 1) * 10
              }
            }
            bytesRead = input.read(buffer)
          }
          output.flush()
        }
      }
      readResponse(connection)
    } finally {
      writeWatchdog.cancel(false)
      connection.disconnect()
      if (activeConnection === connection) {
        activeConnection = null
      }
    }
  }

  private fun request(
    requestUrl: String,
    anonKey: String,
    contentType: String,
    body: ByteArray,
  ): HttpResponse {
    val connection = URL(requestUrl).openConnection() as HttpURLConnection
    activeConnection = connection
    return try {
      connection.requestMethod = "POST"
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.doOutput = true
      connection.setFixedLengthStreamingMode(body.size)
      connection.setRequestProperty("apikey", anonKey)
      connection.setRequestProperty("Authorization", "Bearer $anonKey")
      connection.setRequestProperty("Content-Type", contentType)
      connection.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal")
      connection.outputStream.use { it.write(body) }
      readResponse(connection)
    } finally {
      connection.disconnect()
      if (activeConnection === connection) {
        activeConnection = null
      }
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

  private fun setPhotoProgress(
    index: Int,
    progress: Int,
    imageUrl: String? = null,
    imageUrls: List<String>,
  ) {
    val data = Data.Builder()
      .putInt(KEY_IMAGE_INDEX, index)
      .putInt(KEY_PROGRESS, progress)
      .putString(KEY_IMAGE_URLS, JSONArray(imageUrls).toString())
    if (imageUrl != null) {
      data.putString(KEY_IMAGE_URL, imageUrl)
    }
    setProgressAsync(data.build()).get()
  }

  private fun retry(message: String): Result {
    setProgressAsync(
      Data.Builder()
        .putInt(KEY_STATUS_CODE, 0)
        .putString(KEY_MESSAGE, message)
        .build(),
    ).get()
    return Result.retry()
  }

  private fun httpFailure(statusCode: Int, message: String): Result {
    if (statusCode == 408 || statusCode == 425 || statusCode == 429 || statusCode >= 500) {
      setProgressAsync(
        Data.Builder()
          .putInt(KEY_STATUS_CODE, statusCode)
          .putString(KEY_MESSAGE, message)
          .build(),
      ).get()
      return Result.retry()
    }
    return failure(statusCode, message)
  }

  private fun failure(statusCode: Int, message: String): Result =
    Result.failure(
      Data.Builder()
        .putBoolean(KEY_SUCCESSFUL, false)
        .putInt(KEY_STATUS_CODE, statusCode)
        .putString(KEY_MESSAGE, message)
        .build(),
    )

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
      .setContentText("A saved report and its photos are being transferred.")
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

  private fun fileExtension(mimeType: String): String = when (mimeType) {
    "image/png" -> "png"
    "image/webp" -> "webp"
    "image/heic" -> "heic"
    "image/heif" -> "heif"
    else -> "jpg"
  }

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

  private data class HttpResponse(val statusCode: Int, val body: String)

  private class UploadAborted(val result: Result) : RuntimeException()

  companion object {
    const val KEY_REPORT_ID = "report_id"
    const val KEY_DESCRIPTION = "description"
    const val KEY_CREATED_AT = "created_at"
    const val KEY_SUPABASE_URL = "supabase_url"
    const val KEY_ANON_KEY = "anon_key"
    const val KEY_IMAGES = "images"
    const val KEY_IMAGE_INDEX = "image_index"
    const val KEY_IMAGE_URL = "image_url"
    const val KEY_IMAGE_URLS = "image_urls"
    const val KEY_PROGRESS = "progress"
    const val KEY_SUCCESSFUL = "successful"
    const val KEY_STATUS_CODE = "status_code"
    const val KEY_MESSAGE = "message"
    private const val MAX_IMAGES = 5
    private const val MAX_DESCRIPTION_LENGTH = 500
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
