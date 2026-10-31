package com.fieldsync

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.nio.charset.StandardCharsets

internal object ReportQueueStore {
  private const val QUEUE_FILE_NAME = "field-report-queue.json"
  private val lock = Any()

  fun getReports(context: Context): JSONArray = synchronized(lock) {
    readReports(context)
  }

  fun addReport(context: Context, report: JSONObject) = synchronized(lock) {
    val reports = readReports(context)
    reports.put(report)
    writeReports(context, reports)
  }

  fun updateReport(context: Context, updatedReport: JSONObject) = synchronized(lock) {
    val reports = readReports(context)
    val reportId = updatedReport.getString("id")
    val index = (0 until reports.length()).firstOrNull { reports.getJSONObject(it).optString("id") == reportId }
      ?: throw IllegalStateException("Report $reportId is missing from local storage.")
    reports.put(index, updatedReport)
    writeReports(context, reports)
  }

  fun replaceReports(context: Context, reports: JSONArray) = synchronized(lock) {
    writeReports(context, reports)
  }

  fun clear(context: Context) = synchronized(lock) {
    getAtomicFile(context).delete()
    ReportMediaStore.deleteAllReportMedia(context)
  }

  private fun readReports(context: Context): JSONArray {
    val atomicFile = getAtomicFile(context)
    return try {
      atomicFile.openRead().bufferedReader(StandardCharsets.UTF_8).use { reader ->
        JSONArray(reader.readText())
      }
    } catch (_: FileNotFoundException) {
      JSONArray()
    }
  }

  private fun writeReports(context: Context, reports: JSONArray) {
    val atomicFile = getAtomicFile(context)
    var output = atomicFile.startWrite()
    try {
      output.write(reports.toString().toByteArray(StandardCharsets.UTF_8))
      output.fd.sync()
      atomicFile.finishWrite(output)
    } catch (error: Exception) {
      atomicFile.failWrite(output)
      throw error
    }
  }

  private fun getAtomicFile(context: Context): AtomicFile =
    AtomicFile(File(context.filesDir, QUEUE_FILE_NAME))
}
