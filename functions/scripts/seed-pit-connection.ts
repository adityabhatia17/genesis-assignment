// Usage (emulators running, after signing up in the local app to get a uid from the Emulator UI → Authentication):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=test-3ff4c \
//   HL_PIT=pit-… HL_LOCATION_ID=… FIREBASE_UID=… TOKEN_ENCRYPTION_KEY=… npx tsx scripts/seed-pit-connection.ts
import { DEFAULT_HL_SCOPES } from '../src/config/params.js';
import { FirestoreConnectionRepo } from '../src/modules/highlevel/connection/connection.repo.js';
import { createTokenCipher } from '../src/modules/highlevel/connection/token-cipher.js';
import { createLocationLookup } from '../src/modules/highlevel/oauth/location-lookup.js';
import { firestore } from '../src/shared/firebase-admin.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
if (!process.env['FIRESTORE_EMULATOR_HOST']) {
  throw new Error('Refusing to run without FIRESTORE_EMULATOR_HOST (emulator only).');
}

const uid = env('FIREBASE_UID');
const pit = env('HL_PIT');
const locationId = env('HL_LOCATION_ID');
const cipher = createTokenCipher(env('TOKEN_ENCRYPTION_KEY'));
const location = await createLocationLookup({
  baseUrl: 'https://services.leadconnectorhq.com',
}).getLocation(pit, locationId);
const now = Date.now();

await new FirestoreConnectionRepo(firestore()).saveNewConnection({
  uid,
  source: 'pit',
  locationId,
  companyId: null,
  hlUserId: null,
  scopes: DEFAULT_HL_SCOPES.split(' '),
  accessToken: cipher.encrypt(pit, uid, 'access'),
  refreshToken: null,
  expiresAtMs: now + 10 * 365 * 24 * 3_600_000,
  locationName: location?.name ?? null,
  timezone: location?.timezone ?? null,
  nowMs: now,
});
console.log(`Seeded PIT connection for uid=${uid} location=${location?.name ?? locationId}`);
