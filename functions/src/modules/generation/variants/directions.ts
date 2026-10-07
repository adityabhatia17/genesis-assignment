import type { Checklist } from '../../../contracts/variants.js';

export interface DesignDirection {
  readonly id: string;
  readonly label: string;
  readonly instruction: string;
}

const LIST: readonly DesignDirection[] = [
  {
    id: 'table',
    label: 'Table',
    instruction:
      'Show the records in a single table. One row per record, columns for the fields the owner asked about, a header row, and room for a long list.',
  },
  {
    id: 'agenda',
    label: 'Agenda',
    instruction:
      'Show the records as a vertical agenda grouped by day. Each row is a compact line: time, title, and status. No cards.',
  },
  {
    id: 'cards',
    label: 'Cards',
    instruction:
      'Show each record as its own card in a wrapping grid. The most important field is the card title. Do not use a table.',
  },
  {
    id: 'split',
    label: 'Split view',
    instruction:
      'A narrow list on the left and the selected record’s details on the right. The first record starts selected.',
  },
];

const DETAIL: readonly DesignDirection[] = [
  {
    id: 'table',
    label: 'Definition list',
    instruction: 'Show the record as a two-column definition list: field name, then value.',
  },
  {
    id: 'agenda',
    label: 'Stacked facts',
    instruction: 'Stack each field as a full-width row, label above the value.',
  },
  {
    id: 'cards',
    label: 'Summary card',
    instruction: 'One large card. The record’s name is the heading; the other fields sit underneath.',
  },
  {
    id: 'split',
    label: 'Split view',
    instruction: 'A short list of related records on the left, the chosen record on the right.',
  },
];

const SUMMARY: readonly DesignDirection[] = [
  {
    id: 'table',
    label: 'Stat row',
    instruction: 'A single row of number tiles, then a short table of the underlying records.',
  },
  {
    id: 'agenda',
    label: 'Numbered list',
    instruction: 'Each figure is a line: a big number, then a one-line label. No tiles.',
  },
  {
    id: 'cards',
    label: 'Tiles',
    instruction: 'One tile per figure, in a wrapping grid. No table.',
  },
  {
    id: 'split',
    label: 'Split view',
    instruction: 'Tiles on the left, a breakdown of the selected figure on the right.',
  },
];

const BY_TYPE: Record<Checklist['appType'], readonly DesignDirection[]> = {
  list: LIST,
  detail: DETAIL,
  summary: SUMMARY,
  mixed: LIST,
};

/** Same four ids for every app type, so ranking can tell two designs apart. */
export function directionsFor(appType: Checklist['appType']): readonly DesignDirection[] {
  return BY_TYPE[appType];
}
