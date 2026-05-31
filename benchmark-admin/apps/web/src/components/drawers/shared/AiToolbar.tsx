import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export type AiToolbarProps = {
  hasAsset: boolean;
  busy?: { prompt?: boolean; extract?: boolean; image?: boolean } | null;
  error?: string | null;
  onGeneratePrompt: () => void | Promise<void>;
  onExtractFields: (description: string) => void | Promise<void>;
  onGenerateImage: () => void | Promise<void>;
};

export function AiToolbar({
  hasAsset,
  busy,
  error,
  onGeneratePrompt,
  onExtractFields,
  onGenerateImage,
}: AiToolbarProps) {
  const [draft, setDraft] = useState('');
  const promptBusy = busy?.prompt ?? false;
  const extractBusy = busy?.extract ?? false;
  const imageBusy = busy?.image ?? false;

  return (
    <section
      aria-label="AI 工具"
      className="space-y-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={promptBusy}
          onClick={() => onGeneratePrompt()}
        >
          {promptBusy ? '生成中…' : '生成提示词'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={imageBusy || !hasAsset}
          onClick={() => onGenerateImage()}
          title={hasAsset ? undefined : '需要先保存以生成图像'}
        >
          {imageBusy ? '生成中…' : '生成图像'}
        </Button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ai-extract-input" className="text-xs font-medium">
          从描述提取字段
        </label>
        <Textarea
          id="ai-extract-input"
          placeholder="粘贴一段自由文本描述…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={extractBusy || !draft.trim()}
          onClick={() => onExtractFields(draft)}
        >
          {extractBusy ? '解析中…' : '提取字段'}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
