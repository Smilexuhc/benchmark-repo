import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AssetFilters, FilterField } from './useFilters';

export type { FilterField };

export type FilterPanelProps = {
  fields: FilterField[];
  filters: AssetFilters;
  search: string;
  deletedOnly: boolean;
  onFilterChange: <K extends keyof AssetFilters>(key: K, value: string[]) => void;
  onSearchChange: (value: string) => void;
  onDeletedOnlyChange: (value: boolean) => void;
  onReset: () => void;
};

function toggle(values: string[], v: string): string[] {
  return values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
}

export function FilterPanel({
  fields,
  filters,
  search,
  deletedOnly,
  onFilterChange,
  onSearchChange,
  onDeletedOnlyChange,
  onReset,
}: FilterPanelProps) {
  return (
    <aside aria-label="筛选" className="space-y-4">
      <div className="space-y-2">
        <label
          htmlFor="asset-search"
          className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]"
        >
          搜索
        </label>
        <Input
          id="asset-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="名称或描述…"
        />
      </div>

      {fields.map((field) => (
        <div key={field.key} className="space-y-2">
          <div className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">
            {field.label}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((opt) => {
              const active = filters[field.key].includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onFilterChange(field.key, toggle(filters[field.key], opt))}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    active
                      ? 'border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]',
                  )}
                  aria-pressed={active}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={deletedOnly}
          onChange={(e) => onDeletedOnlyChange(e.target.checked)}
          className="h-4 w-4 rounded border-[hsl(var(--border))]"
        />
        只看已删除
      </label>

      <Button variant="outline" size="sm" onClick={onReset}>
        重置筛选
      </Button>
    </aside>
  );
}
