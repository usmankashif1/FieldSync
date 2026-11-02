# FieldSync - Field Report Technical Test

FieldSync is a React Native CLI app for field workers who need to submit reports from unreliable networks. A report contains a short description and one to five photos. The app saves the report on the device, prepares images under the 5MB limit, uploads them to Supabase, and shows local queue state separately from records fetched from the server.

The required background-transfer implementation is Android-only. The iOS background uploader is a documented gap; the app must not be presented as having Android-equivalent iOS upload behavior.

## What the app does

- Compose a report with a required description and one to five photos, using the camera or photo library.
- Save a report to the local queue before preparing or sending its photos.
- Compress selected photos and verify each final file is no larger than 5,000,000 bytes.
- Upload photos and the report row to Supabase.
- Show local save/upload progress, per-photo status, and actionable failures.
- Fetch server history from Supabase separately from the local queue.
- Retry failed reports and resume eligible work when connectivity returns or the app is opened again.
- Clear local report history and local compressed copies without deleting server records.


## Technical-test acceptance scenario

The brief's primary scenario is to enable airplane mode, save three reports (including one report with five camera photos), force-quit and reopen the app, restore a throttled connection, interrupt it twice during upload, and verify that the server eventually contains all three reports and their photos.

 

## Supabase setup

1. Create a Supabase project.
2. Create a **public** Storage bucket named `field-reports`.
3. Create the reports table and test policies below.
4. Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the project URL and publishable/anon key.
5. Rebuild the app.

The table used by the app:

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

These permissive policies and a public bucket are for this technical test only. They are not a production authorization design. A production app should authenticate users and restrict report rows, object paths, and upload rates. Never put a Supabase secret or service-role key in the mobile app; use only the publishable/anon key.

## How to make failures happen

The brief asks that failure be testable on demand. Use a test project, not production data.

### Offline and interrupted connection

- Turn on airplane mode, save one or more reports, and confirm they appear in **On this device** without claiming they have uploaded.
- Restore Wifi and observe the upload status.
- While a photo is transferring, disable the active connection and then restore it.

 

## Architecture and implementation decisions

### Ownership boundaries

- `QueueManager` is a screen-independent TypeScript class. It owns report validation, local queue lifecycle, image-preparation orchestration, state transitions, retry classification, and retry timing.
- `StorageAdapter` persists queue records through AsyncStorage. Compressed image files are stored in the app documents directory and are removed when local history is cleared.
- `ImageCompressor` is a TypeScript adapter around `react-native-compressor`. It applies a JPEG quality/dimension policy, checks the actual file size, and persists the accepted result through `react-native-fs`.
- `NetworkMonitor` wraps NetInfo. A network transition to online asks the queue manager to resume work.
- `UploadAdapter` isolates network upload from the queue manager and UI. The manager can be tested using fake storage, compressor, network, and uploader adapters without rendering React components.
- The screen renders queue records from local storage and server history from a separate Supabase query. A local “saved” state and a server “uploaded” state are deliberately distinct.

### Image preparation

The app accepts large originals as input. For each photo, TypeScript asks the compressor to produce JPEG output, starting at up to 2048 pixels and trying decreasing quality values. If needed, it reduces the dimension and tries again down to 512 pixels. It verifies the produced file and its durable copy against the hard limit of 5,000,000 bytes before allowing upload.

The compression library uses platform image APIs internally, but the queue and compression policy are orchestrated in TypeScript. Android's WorkManager worker does not compress, resize, or make image-quality decisions. Compression can take time and may use device resources; the queue record is saved before compression begins.

### Android background file transfer

`BackgroundUploadAdapter` is the only queue component that calls the Android native transfer bridge. The bridge schedules one uniquely named WorkManager task per report/photo. A worker receives a local compressed-file path, upload URL, report ID, content type, and publishable key; it transfers that file and exposes progress and the HTTP result through WorkManager.


Native code does **not** own the report queue, compression, retry count/backoff policy, duplicate detection, or report-row submission. TypeScript submits the report row after its photos succeed.

### Retry and duplicate behavior

- Network/transport failures, timeouts, HTTP 408, 425, 429, and HTTP 5xx are retryable.
- Other HTTP failures are surfaced as permanent until the user chooses **Try again**.
- Each photo uses a deterministic Storage object path based on report ID and photo index, with replace enabled. A retry may transfer the same photo again, but it replaces the same object rather than creating a second path.
- Each report has a stable client-generated ID in the table primary key. The report row is upserted on that ID, so a retry after an uncertain response updates the same row.

This prevents duplicate logical report rows and duplicate object paths when the configured backend honors upsert/replace semantics. It is not a claim that the network can never send the same bytes more than once.

### Local history and reset semantics

The **On this device** list represents local queue records. **Received by server** is fetched from Supabase and is not inferred from the local queue. **Clear** cancels report transfers and removes local queue data and compressed copies; it does not delete already-uploaded server rows or Storage objects. The confirmation text explains that pending local work will be discarded.

 
 
## Verification

1. Queue three reports in airplane mode, including a report with five large camera photos.
2. Force-stop and reopen the app; restore a throttled connection and confirm which already-scheduled work resumes.
3. Drop the connection twice during upload.
4. Confirm every stored photo is at most 5,000,000 bytes and visually usable, and verify one report row per report ID in Supabase.
5. Deny camera/photo permissions, grant them later in Settings, and retry without restarting.
6. Try an empty description, zero photos, and a sixth photo.
7. Test a permanent authorization failure, a transient server error, and a hanging request. Confirm only retryable errors are automatically retried.
8. Clear local history and verify that the documented local-only reset behavior matches the backend.

Automated tests and a successful Android build do not prove real carrier connectivity, force-stop behavior across Android versions, or backend policy correctness.

## Decisions, trade-offs, and next steps

- **Why Supabase:** it provides a real Storage upload and report-table round trip without spending the limited test time building a custom server. The open test policies are intentionally not presented as production-ready.
- **Why an adapter-based TypeScript queue:** it keeps report decisions testable without mounting screens and keeps queue logic independent of WorkManager APIs.
- **Why WorkManager:** the Android brief calls for durable background file transfer. A native scheduler can run eligible work outside the foreground React Native UI; JavaScript alone cannot guarantee that work continues after its runtime is stopped.
- **Why keep native code small:** Android is responsible for a single file transfer and WorkManager status only. Validation, compression policy, queue decisions, retries, and report persistence belong to TypeScript.
- **With another day:** implement and test the iOS background `URLSession` bridge; add deterministic integration tests against a controllable backend; improve process-death recovery and observability; run throttled-network and carrier tests on multiple Android versions/devices; and record the requested two-to-three-minute airplane-mode-to-server demo.
- **Known omissions:** no iOS background uploader, no built-in fault-injection server/proxy, and no production authentication or restrictive per-user backend policies. The JavaScript-owned retry/sequencing model also requires the app runtime to resume after a native task finishes or fails.

## Submission checklist

- Source repository with meaningful commit history.
- This README with setup steps, backend setup/failure testing, design reasoning, and documented gaps.
- A two-to-three-minute screen recording. A useful walkthrough is: save reports offline; show they are locally saved rather than uploaded; reopen/restore a throttled connection; show progress and the separate server list updating; interrupt and recover a transfer; then show the final rows/photos in Supabase.
