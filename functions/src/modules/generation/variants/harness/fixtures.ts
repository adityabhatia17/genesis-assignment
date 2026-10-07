/** Scoring data. Never the owner's records. Two sets so a hard-coded answer fails one of them. */

export const ANCHOR_ISO = '2026-01-05T09:00:00.000Z';

export const XSS_NAME = '<img src=x onerror=alert(1)>';

export interface FixtureSet {
  readonly id: 'A' | 'B';
  readonly locationName: string;
  readonly contacts: { id: string; name: string; email: string }[];
  readonly events: { id: string; title: string; status: string; startTime: string }[];
  readonly conversations: { id: string; contactName: string }[];
}

const at = (hour: number) => `2026-01-0${hour < 24 ? 5 : 6}T${String(hour % 24).padStart(2, '0')}:00:00.000Z`;

export const FIXTURE_A: FixtureSet = {
  id: 'A',
  locationName: 'North Desk',
  contacts: [
    { id: 'c_ada', name: 'Ada North', email: 'ada.north@example.com' },
    { id: 'c_ben', name: 'Ben North', email: 'ben.north@example.com' },
  ],
  events: [
    { id: 'e_am', title: 'Morning visit', status: 'confirmed', startTime: at(9) },
    { id: 'e_pm', title: 'Afternoon visit', status: 'cancelled', startTime: at(15) },
  ],
  conversations: [{ id: 'cv_ada', contactName: 'Ada North' }],
};

export const FIXTURE_B: FixtureSet = {
  id: 'B',
  locationName: 'South Desk',
  contacts: [
    { id: 'c_bea', name: 'Bea South', email: 'bea.south@example.com' },
    { id: 'c_cam', name: 'Cam South', email: 'cam.south@example.com' },
  ],
  events: [
    { id: 'e_eve', title: 'Evening visit', status: 'confirmed', startTime: at(18) },
    { id: 'e_late', title: 'Late visit', status: 'new', startTime: at(20) },
  ],
  conversations: [{ id: 'cv_bea', contactName: 'Bea South' }],
};

export const rows = (count: number): FixtureSet['contacts'] =>
  Array.from({ length: count }, (_, i) => ({
    id: `c_${i}`,
    name: `Person ${i + 1}`,
    email: `person${i + 1}@example.com`,
  }));
