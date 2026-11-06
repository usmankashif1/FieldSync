package com.fieldsync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SequentialReportUploadTest {
  @Test
  fun uploadsPhotosInOrderBeforeSubmittingTheReport() {
    val events = mutableListOf<String>()
    val sequence = SequentialReportUpload(
      uploadPhoto = { index, completed ->
        assertEquals(index, completed.size)
        events.add("photo-$index")
        "url-$index"
      },
      submitReport = { urls ->
        assertEquals(listOf("url-0", "url-1", "url-2"), urls)
        events.add("report")
      },
    )

    sequence.execute(3)

    assertEquals(
      listOf("photo-0", "photo-1", "photo-2", "report"),
      events,
    )
  }

  @Test
  fun doesNotSubmitTheReportWhenAnyPhotoUploadFails() {
    val events = mutableListOf<String>()
    val sequence = SequentialReportUpload(
      uploadPhoto = { index, _ ->
        events.add("photo-$index")
        if (index == 1) {
          throw IllegalStateException("Photo upload failed.")
        }
        "url-$index"
      },
      submitReport = {
        events.add("report")
      },
    )

    assertThrows(IllegalStateException::class.java) {
      sequence.execute(3)
    }

    assertEquals(listOf("photo-0", "photo-1"), events)
  }
}
