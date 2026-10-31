This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Environment configuration

1. Copy `.env.example` to `.env` in the project root.
2. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to your Supabase project URL and publishable/anon key.
3. Keep `.env` local; it is ignored by Git. Never put a Supabase secret or service-role key in the mobile app because app values can be extracted from a build.
4. Rebuild the native app after changing environment values. Metro reload alone does not update native configuration.

Android reads `.env` through `react-native-config`. On iOS, install native dependencies with `cd ios && pod install` on macOS before building. For another environment file, set `ENVFILE` when building (for example, `ENVFILE=.env.staging`).

## Field reports

The field-report upload pipeline in this technical test is Android-native. Android is the required platform in the brief; the iOS app does not yet have an equivalent background-upload implementation.

### Supabase setup

Create a public Storage bucket named `field-reports`, then create the reports table:

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

The app uses an anon/publishable key and no login, as allowed by the brief. These open policies are for the technical test only; a production app must identify users and restrict rows, storage paths, and upload rates to those users. Never put a Supabase secret or service-role key in the app.

### Upload and recovery behavior

- A report must have a non-blank description and 1-5 photos.
- Before a report is shown as saved, Android copies each photo into private app storage, corrects its orientation, resizes/compresses it, and checks the resulting file is no larger than 5,000,000 bytes.
- The report queue is written atomically to app-private storage. Android WorkManager uploads it with a network requirement and a visible background-work notification. WorkManager persists scheduled work over normal process death and device reboot.
- Photos use a stable path per report/photo and are uploaded with replace enabled. Each new report gets a UUID string in the table's unique `id` column; PostgREST upsert means retrying after a lost response does not create another report.
- Network failures, timeouts, HTTP 408/425/429, and server 5xx responses are retried with exponential backoff. Other HTTP failures are surfaced for the user to review; the user can explicitly try again after fixing the cause.
- The home screen separates the device queue from reports fetched from Supabase. Clearing local history deletes local reports and photo copies only; it does not delete server records or objects.

Android prevents background work after the user explicitly force-stops an app. In that case the saved queue remains intact and resumes when the user opens the app again. A normal process kill or device reboot is different: WorkManager can restart eligible work when Android permits it.

### Verification checklist

1. Save a report in airplane mode, force-stop the app, reopen it, restore a connection, and verify it reaches Supabase without another tap.
2. Queue multiple reports, including five large camera photos; confirm each stored image is at most 5 MB and remains viewable.
3. Background the app during upload and reboot with queued work; verify Android resumes the queue when network is available.
4. Interrupt the connection during upload, restore it, and confirm the same report ID and deterministic photo paths are reused.
5. Remove an anon insert/upload policy to simulate a permanent authorization failure; the report should show an actionable failure rather than retrying endlessly. Restore the policy and use **Try again**.
6. Try an empty description, zero photos, and a sixth photo; the composer must not save an invalid report.
7. Deny camera/photo access, grant it later in Settings, and retry without restarting the app.

To exercise transient server errors or a hanging endpoint on demand, use a controllable network proxy or a test backend in the Android emulator. A normal internet disconnect tests the connection-loss path, but does not simulate a server returning an HTTP error.

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
