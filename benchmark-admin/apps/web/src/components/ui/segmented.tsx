import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { cn } from '@/lib/utils';

export type SegmentedItem<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedProps<T extends string> = {
  value: T;
  items: readonly SegmentedItem<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
};

export function Segmented<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next as T);
      }}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-md bg-[hsl(var(--muted))] p-1 text-[hsl(var(--muted-foreground))]',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Radio.Root
            key={item.value}
            value={item.value}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-7 cursor-pointer items-center justify-center rounded px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
              active
                ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
                : 'hover:text-[hsl(var(--foreground))]',
            )}
          >
            {item.label}
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
