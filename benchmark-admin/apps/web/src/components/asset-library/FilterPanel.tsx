import { Checkbox } from '@base-ui/react/checkbox';
import { cn } from '@/lib/utils';
import type { AssetFilters } from './useFilters';

export type FilterField = {
  key: keyof AssetFilters;
  label: string;
  options: readonly string[];
};

export type FilterPanelProps = {
  fields: FilterField[];
  filters: AssetFilters;
  deletedOnly: boolean;
  hitCount: number;
  activeFilterCount: number;
  onFilterChange: <K extends keyof AssetFilters>(key: K, value: string[]) => void;
  onDeletedOnlyChange: (value: boolean) => void;
  onReset: () => void;
};

function toggle(values: string[], v: string): string[] {
  return values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
}

export function FilterPanel({
  fields,
  filters,
  deletedOnly,
  hitCount,
  activeFilterCount,
  onFilterChange,
  onDeletedOnlyChange,
  onReset,
}: FilterPanelProps) {
  const resetDisabled = activeFilterCount === 0;
  return (
    <aside aria-label="筛选" className="space-y-1">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">筛选</h2>
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className={cn(
            'text-xs text-[hsl(var(--primary))] transition-opacity',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 rounded',
            resetDisabled
              ? 'pointer-events-none opacity-40'
              : 'hover:underline',
          )}
        >
          重置 ({activeFilterCount})
        </button>
      </div>
      <div className="text-xs text-[hsl(var(--muted-foreground))]">
        命中 {hitCount} 个
      </div>

      {fields.map((field) => (
        <div key={field.key} className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">
            {field.label}
          </div>
          <div className="flex flex-col gap-1.5">
            {field.options.map((opt) => {
              const checked = filters[field.key].includes(opt);
              const inputId = `filter-${String(field.key)}-${opt}`;
              const labelId = `${inputId}-label`;
              return (
                <label
                  key={opt}
                  htmlFor={inputId}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox.Root
                    id={inputId}
                    checked={checked}
                    aria-labelledby={labelId}
                    onCheckedChange={() =>
                      onFilterChange(field.key, toggle(filters[field.key], opt))
                    }
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
                      checked
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                        : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]',
                    )}
                  >
                    <Checkbox.Indicator>
                      <svg
                        viewBox="0 0 12 12"
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                      </svg>
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  <span id={labelId}>{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
        <label
          htmlFor="filter-deleted-only"
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <Checkbox.Root
            id="filter-deleted-only"
            checked={deletedOnly}
            aria-labelledby="filter-deleted-only-label"
            onCheckedChange={(next) => onDeletedOnlyChange(Boolean(next))}
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded border transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
              deletedOnly
                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]',
            )}
          >
            <Checkbox.Indicator>
              <svg
                viewBox="0 0 12 12"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M2.5 6.5l2.5 2.5 4.5-5" />
              </svg>
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span id="filter-deleted-only-label">显示已删除</span>
        </label>
      </div>
    </aside>
  );
}
