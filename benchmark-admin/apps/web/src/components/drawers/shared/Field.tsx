export type FieldProps = {
  label: string;
  required?: boolean;
  error?: string | undefined;
  trailing?: React.ReactNode;
  children: React.ReactNode;
};

export function Field({ label, required, error, trailing, children }: FieldProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps an Input child component which biome can't detect
    <label className="block space-y-1.5 text-sm">
      <span className="flex items-center justify-between gap-2 font-medium">
        <span>
          {label}
          {required ? <span aria-hidden> *</span> : null}
        </span>
        {trailing ? <span className="font-normal">{trailing}</span> : null}
      </span>
      {children}
      {error ? <span className="text-xs text-[hsl(var(--destructive))]">{error}</span> : null}
    </label>
  );
}
