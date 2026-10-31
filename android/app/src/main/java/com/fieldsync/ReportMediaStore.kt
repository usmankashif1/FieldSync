package com.fieldsync

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.roundToInt

internal object ReportMediaStore {
  const val MAX_IMAGE_BYTES = 5_000_000
  private const val MAX_DIMENSION = 2048
  private const val MIN_DIMENSION = 512

  fun prepareImage(context: Context, source: String, reportId: String, index: Int): JSONObject {
    val sourceUri = Uri.parse(source)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    openInputStream(context, sourceUri).use { stream ->
      BitmapFactory.decodeStream(stream, null, bounds)
    }

    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw IllegalArgumentException("The selected photo could not be decoded.")
    }

    val sampleSize = calculateSampleSize(bounds.outWidth, bounds.outHeight)
    val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
    val decoded = openInputStream(context, sourceUri).use { stream ->
      BitmapFactory.decodeStream(stream, null, options)
    } ?: throw IllegalArgumentException("The selected photo could not be opened.")

    val oriented = applyExifOrientation(context, sourceUri, decoded)
    val imageBytes = compressUnderLimit(oriented)
    val directory = File(context.filesDir, "field-reports/$reportId")
    if (!directory.exists() && !directory.mkdirs()) {
      throw IllegalStateException("Could not create secure local photo storage.")
    }

    val destination = File(directory, "$index.jpg")
    val temporary = File(directory, "$index.jpg.tmp")
    FileOutputStream(temporary).use { output ->
      output.write(imageBytes)
      output.fd.sync()
    }
    if (!temporary.renameTo(destination)) {
      temporary.delete()
      throw IllegalStateException("Could not save the selected photo for upload.")
    }

    return JSONObject()
      .put("uri", Uri.fromFile(destination).toString())
      .put("status", "pending")
      .put("size", imageBytes.size)
  }

  fun deleteReportMedia(context: Context, reportId: String) {
    File(context.filesDir, "field-reports/$reportId").deleteRecursively()
  }

  fun deleteAllReportMedia(context: Context) {
    File(context.filesDir, "field-reports").deleteRecursively()
  }

  private fun openInputStream(context: Context, uri: Uri): InputStream {
    if (uri.scheme == "file") {
      val path = uri.path ?: throw IllegalArgumentException("The selected photo path is invalid.")
      return FileInputStream(path)
    }
    if (uri.scheme == null) {
      return FileInputStream(uri.toString())
    }
    return context.contentResolver.openInputStream(uri)
      ?: throw IllegalArgumentException("The selected photo is no longer available.")
  }

  private fun calculateSampleSize(width: Int, height: Int): Int {
    var sampleSize = 1
    while (max(width, height) / sampleSize > MAX_DIMENSION) {
      sampleSize *= 2
    }
    return sampleSize
  }

  private fun applyExifOrientation(context: Context, uri: Uri, bitmap: Bitmap): Bitmap {
    val orientation = openInputStream(context, uri).use { stream ->
      ExifInterface(stream).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
      )
    }

    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
        matrix.postRotate(180f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.postRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.postRotate(270f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
    }

    if (matrix.isIdentity) {
      return bitmap
    }

    val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (oriented !== bitmap) {
      bitmap.recycle()
    }
    return oriented
  }

  private fun compressUnderLimit(initialBitmap: Bitmap): ByteArray {
    var bitmap = initialBitmap
    var quality = 88

    while (true) {
      val output = ByteArrayOutputStream()
      if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
        bitmap.recycle()
        throw IllegalStateException("The selected photo could not be compressed.")
      }

      val bytes = output.toByteArray()
      if (bytes.size <= MAX_IMAGE_BYTES) {
        bitmap.recycle()
        return bytes
      }

      if (quality > 40) {
        quality = (quality - 8).coerceAtLeast(40)
        continue
      }

      val nextDimension = (max(bitmap.width, bitmap.height) * 0.85f).roundToInt()
      if (nextDimension < MIN_DIMENSION) {
        bitmap.recycle()
        throw IllegalArgumentException("This photo could not be reduced below the 5 MB upload limit.")
      }

      val scale = nextDimension.toFloat() / max(bitmap.width, bitmap.height)
      val resized = Bitmap.createScaledBitmap(
        bitmap,
        (bitmap.width * scale).roundToInt().coerceAtLeast(1),
        (bitmap.height * scale).roundToInt().coerceAtLeast(1),
        true,
      )
      bitmap.recycle()
      bitmap = resized
      quality = 88
    }
  }
}
