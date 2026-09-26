// Emulator hosts are injected by `firebase emulators:exec`; fail fast if missing.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    'FIRESTORE_EMULATOR_HOST is not set — run via `npm run test:integration` from the repo root',
  );
}
process.env.GCLOUD_PROJECT ??= 'demo-genesis';
