# FieldSync — Field Report App

FieldSync is a React Native CLI app for creating field reports with a required description and one to five photos. Reports are saved to a local queue first, then uploaded to Supabase. The local queue and server history are shown separately so a locally saved report is not represented as server-delivered.

The app has an Android WorkManager upload workflow. It is not an equivalent iOS background uploader. The Android worker is scheduled **after** photo preparation; compression itself still runs in the React Native JavaScript workflow.

## Features

- Take photos with the camera or select them from the photo library.
- Validate the description and one-to-five-photo limit.
- Save reports locally before preparing or sending photos.
- Compress photos to JPEG and enforce the 5,000,000-byte per-photo limit.
- Upload photos and then the report row to Supabase.
- Display local queue status, per-photo progress, offline state, server history, and retryable/permanent failures.
- Retry failed reports and resume queue work when connectivity returns or the app is opened or foregrounded.
- Clear local reports and compressed photo copies without deleting server rows or Storage objects.

## Requirements

- Node.js `>=22.11.0` (see `package.json`).
- Android Studio/Android SDK and the Java version required by this repository's Gradle/React Native toolchain.
- A physical Android device or emulator for running and background-behavior testing.
- A Supabase project and its project URL and publishable/anon key.

## Run the app

Install dependencies:

```powershell
npm install
```

Create `.env` from `.env.example` and set the project URL and **publishable/anon key**:

```powershell
Copy-Item .env.example .env
```

Never put a Supabase secret or service-role key in the mobile app or `.env`.

Start Metro in one terminal:

```powershell
npm start
```

With an Android device/emulator connected, build and launch in another terminal:

```powershell
npm run android
```

Alternatively, build the debug APK from the `android` directory:

```powershell
Set-Location android
.\gradlew.bat :app:assembleDebug
```

## Supabase setup

1. Create a Supabase project.
2. Create a **public** Storage bucket named `field-reports`.
3. Create the reports table and test policies below.
4. Put the project URL and publishable/anon key in `.env`, then rebuild the app.

The app expects this table shape:

```sql
create table public.reports (
  id text primary key,
  description text not null,
  image_urls text[] not null,
  created_at timestamptz not null
);

alter table public.reports enable row level security;
grant select, insert, update on public.reports to anon;

create policy "field reports can be read by the test app"
  on public.reports for select to anon using (true);
create policy "field reports can be created by the test app"
  on public.reports for insert to anon with check (true);
create policy "field reports can be retried idempotently by the test app"
  on public.reports for update to anon using (true) with check (true);

create policy "field report photos can be uploaded by the test app"
  on storage.objects for insert to anon
  with check (bucket_id = 'field-reports');
create policy "field report photos can be replaced on retry"
  on storage.objects for update to anon
  using (bucket_id = 'field-reports')
  with check (bucket_id = 'field-reports');
create policy "field report photos can be checked for idempotent upload"
  on storage.objects for select to anon
  using (bucket_id = 'field-reports');
```

These permissive policies and a public bucket are for a technical test only, not a production authorization design. A production app should authenticate users and restrict report rows, object paths, and upload rates. Only the publishable/anon key belongs in the client.

## End-to-end upload flow

1. The user submits the description and selected photo URIs. The queue validates the description and photo count and persists the report locally.
2. While the app's JavaScript workflow is running, `QueueManager` compresses each image. `ImageCompressor` tries JPEG quality/dimension settings, checks the resulting size, and copies accepted images to the app documents directory. The report's prepared image paths and sizes are saved in the local queue.
3. **After all photos are prepared**, `BackgroundUploadAdapter` gives the report metadata and durable compressed-file paths to the Android native bridge. The bridge enqueues one uniquely named WorkManager request per report.
4. The native worker uploads that report's photos sequentially to deterministic paths under `field-reports/reports/<report-id>/<photo-index>.<extension>`. It uses replace-on-retry semantics and reports the active photo and progress through WorkManager.
5. Only after every photo receives a successful HTTP response does the worker upsert the report row in Supabase. Work is reported successful only when that request also receives a successful HTTP response.
6. If JavaScript remains available, it polls native progress for the UI. When the app is opened or returns to the foreground, the queue reads WorkManager status and reconciles completed photos, report URLs, and final status into local storage.

The native requests use the configured publishable/anon key in the `apikey` header and `Authorization: Bearer <publishable/anon key>`. No service-role key is embedded or logged.

 

## Queue, retries, and duplicate handling

- Queue records are stored in AsyncStorage. Compressed copies are stored under the app documents directory.
- Offline reports remain local and are eligible for processing when connectivity returns.
- WorkManager waits for a connected network and retries transport failures and transient HTTP responses (408, 425, 429, and 5xx) with exponential backoff. Other HTTP failures are surfaced as permanent until the user retries.
- The TypeScript queue retains failed report details, provides retry behavior, and reconciles native work status on resume/reopen.
- Photo paths are deterministic per report ID and image index; the Storage request enables replacement. The report row is upserted using the stable report ID. A retry may send bytes again, but it targets the same object path and logical report row.
- A report row is never sent after a failed photo upload. If the report-row request fails after all photos succeeded, a retry can replace those same photo objects and upsert the same report ID.
- **Clear** cancels tagged native work and clears local records and compressed copies. It does not remove already-uploaded Storage objects or server rows.

These measures provide idempotent targets when the backend honors the configured upsert/replace policies; they do not guarantee that the network transmits bytes only once.

## Making failures testable

Use a disposable Supabase project, never production data.

- **Offline / connection interruption:** enable airplane mode before saving to test local queue behavior. Restore connectivity to trigger processing. During an upload, disable the connection and restore it to exercise network constraints and retry behavior.
- **Permanent authorization error:** temporarily revoke the relevant Storage or reports-table test policy, attempt an upload, and confirm the HTTP error is surfaced instead of silently marked successful. Restore the policy afterward.
- **Transient failure or hang:** use a controllable network proxy or test environment capable of returning a 5xx, delaying a response, or dropping a connection. There is no built-in fault-injection server/proxy in this repository.
- **Validation:** try a blank description, zero photos, and six photos. Also try a large original and verify the compressed file stays under 5,000,000 bytes.
- **Permissions:** deny camera/photo access, then grant it from Settings and try again without restarting.
- **Reset:** clear local history and confirm local records and compressed copies are removed while server records remain.

For emulator/device network shaping, use the Android Emulator's network controls or a device-compatible proxy. Exact controls differ by Android Studio/device version.

 
### Manual Android scenario

1. Use a test Supabase project and save several reports while offline, including one report with five camera photos.
2. Restore connectivity and observe the local per-photo progress and separate server history.
3. Minimize the app **after confirming preparation has finished and the report is uploading**. Reopen it and confirm the queue reconciles native progress and final status.
4. Interrupt and restore the connection during upload; verify retry behavior and confirm every row/photo is present in Supabase.
5. Test minimizing during preparation separately. This is a known gap: WorkManager has not yet been scheduled at that point.
6. Test Android force-stop separately from minimizing. Force-stop is an OS-enforced stopped state; WorkManager execution is not guaranteed until the user launches the app again. Behavior can also vary by Android version and device manufacturer.

Real-device background behavior, force-stop recovery, carrier/2G reliability, and backend policy correctness have not been verified by the automated test suite.

## Architecture and decisions

- **`QueueManager`** owns local report validation and lifecycle, compression orchestration, state transitions, retry classification, and TypeScript retry timing. It is testable without mounting a screen through injected storage, compressor, network, and uploader adapters.
- **`ReportStorageAdapter`** persists queue records through AsyncStorage and removes compressed local copies when reports are cleared.
- **`ImageCompressor`** wraps `react-native-compressor` and `react-native-fs`. It emits JPEG output, tries dimensions from up to 2048 downward while staying at or above 512 and quality steps from 0.88 down to 0.4, and enforces the 5,000,000-byte maximum.  
- **`BackgroundUploadAdapter`** prepares the bridge payload, schedules Android report work, reads progress/results, and exposes cancellation/reconciliation to the queue.
- **`BackgroundTransferModule` and `ReportUploadWorker`** own one durable Android job per report. The worker performs the sequential Storage requests and final Supabase REST upsert without requiring an active JavaScript runtime.
- **`NetInfoMonitor`** informs the queue of connectivity changes. Server history is fetched separately from the local queue.
- **UI and reset semantics:** “On this device” is local queue state; “Received by server” is fetched from Supabase. A local save is not proof of server delivery.
- **Why this boundary:** keeping queue state and image preparation in TypeScript is testable and preserves the existing compression behavior. Moving the complete upload sequence and final row request into WorkManager removes the JavaScript dependency after scheduling.  

## Known gaps and next steps

- Android force-stop and manufacturer-specific background restrictions can defer WorkManager execution; this has not been validated on a device.
- No equivalent iOS background upload implementation is included.
- The provided Supabase schema/policies are intentionally permissive test policies, not production authentication or authorization.
