export function optionToggleLabel(rank: number, total: number): string {
  return `Option ${rank} · ${total}`;
}

export function defaultOptionId(
  options: readonly { candidateId: string; topPick: boolean }[],
): string | null {
  return options.find((option) => option.topPick)?.candidateId ?? options[0]?.candidateId ?? null;
}
