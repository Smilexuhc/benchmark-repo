import type { RouterOutputs } from '@/lib/trpc';
import { OutputColumn } from './OutputColumn';
import { QuestionColumn } from './QuestionColumn';

type BenchmarkItem = RouterOutputs['benchmark']['list']['items'][number];

export type BenchmarkCardProps = {
  item: BenchmarkItem;
  onEdit: () => void;
  onOpenComments: () => void;
};

// Legacy parity card: left 60% problem / asset column, right 40% Seedance
// output + inline score editor. The wrapper itself is just the flex layout +
// borders so each column owns its own padding and click stopPropagation.
export function BenchmarkCard({ item, onEdit, onOpenComments }: BenchmarkCardProps) {
  return (
    <div
      className="flex w-full overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
      data-benchmark-card-id={item.id}
    >
      <QuestionColumn
        className="flex-[0_0_60%] border-r border-[hsl(var(--border))]"
        item={item}
        onEdit={onEdit}
        onOpenComments={onOpenComments}
      />
      <OutputColumn className="flex-[0_0_40%]" item={item} />
    </div>
  );
}
