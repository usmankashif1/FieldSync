package com.fieldsync

internal class SequentialReportUpload<T>(
  private val uploadPhoto: (Int, List<T>) -> T,
  private val submitReport: (List<T>) -> Unit,
) {
  fun execute(photoCount: Int): List<T> {
    require(photoCount > 0) { "A report must contain at least one photo." }
    val uploadedPhotos = ArrayList<T>(photoCount)
    for (index in 0 until photoCount) {
      uploadedPhotos.add(uploadPhoto(index, uploadedPhotos.toList()))
    }
    submitReport(uploadedPhotos)
    return uploadedPhotos
  }
}
