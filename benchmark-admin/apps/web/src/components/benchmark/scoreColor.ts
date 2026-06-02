// Legacy parity: ≥4 → green, ≥2 → blue, <2 → orange, null → gray.
// Single source of truth for the score color rule; the drawer's own inline
// helper keeps its tailwind-class form for the segmented score buttons.

export type ScoreTier = 'green' | 'blue' | 'orange' | 'gray';

export function scoreTier(score: number | null | undefined): ScoreTier {
  if (score === null || score === undefined) return 'gray';
  if (score >= 4) return 'green';
  if (score >= 2) return 'blue';
  return 'orange';
}

// Background tint + text color used for the score block under the output video.
// Kept as tailwind utility strings so the same tokens drive light/dark mode.
export function scoreColorClasses(score: number | null | undefined): string {
  switch (scoreTier(score)) {
    case 'green':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'blue':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'orange':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    default:
      return 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
  }
}
