import { cn } from '@/lib/utils';
import { forwardRef, useId } from 'react';

export type AutoCompleteProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'list'
> & {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
};

export const AutoComplete = forwardRef<HTMLInputElement, AutoCompleteProps>(
  ({ className, value, onChange, options, id, ...props }, ref) => {
    const reactId = useId();
    const inputId = id ?? reactId;
    const listId = `${inputId}-options`;
    return (
      <>
        <input
          ref={ref}
          id={inputId}
          list={listId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </>
    );
  },
);
AutoComplete.displayName = 'AutoComplete';
