import { toast } from '@/components/feedback/toast';
import { Button } from '@/components/ui/button';

export type PlaygroundResult = {
  mediaId: number;
  url: string;
};

type Props = {
  result: PlaygroundResult;
  onUseAsRef: () => void;
};

// Renders the most recent generated image and the three action buttons from
// the spec: 下载 / 复制图片链接 / 作为参考图继续修改.
export function ResultPanel({ result, onUseAsRef }: Props) {
  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success('已复制图片链接');
    } catch {
      toast.error('复制失败');
    }
  }

  function handleDownload() {
    // Programmatic anchor click triggers a save dialog on the presigned URL.
    const a = document.createElement('a');
    a.href = result.url;
    a.download = '';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <section aria-label="生成结果" className="space-y-3">
      <div className="overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        <img src={result.url} alt="" className="block max-h-[60vh] w-full object-contain" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={handleDownload}>
          下载
        </Button>
        <Button type="button" variant="outline" onClick={handleCopyLink}>
          复制图片链接
        </Button>
        <Button type="button" onClick={onUseAsRef}>
          作为参考图继续修改
        </Button>
      </div>
    </section>
  );
}
