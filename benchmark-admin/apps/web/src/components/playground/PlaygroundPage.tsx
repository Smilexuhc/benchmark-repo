import { toast } from '@/components/feedback/toast';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';
import { RefImageList } from './RefImageList';
import { type PlaygroundResult, ResultPanel } from './ResultPanel';
import {
  ASPECT_LABELS,
  ASPECT_RATIOS,
  type AspectRatio,
  type ImageModel,
  MAX_REF_IMAGES,
  MODELS,
  type RefImage,
} from './types';

const FormSchema = z.object({
  prompt: z.string(),
  aspectRatio: z.enum(ASPECT_RATIOS),
  model: z.enum(MODELS),
});
type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  prompt: '',
  aspectRatio: '16:9',
  model: 'openai/gpt-5.4-image-2',
};

// Standalone image-gen workbench.
//
// Single-turn form (not multi-turn chat). Each Generate click is an
// independent ai.generateStandalone mutation. Continuous editing is supported
// via the result panel's "作为参考图继续修改" action which moves the result
// back into the ref-image list for the next click — see ResultPanel.
//
// Form state (prompt / aspectRatio / model) lives in react-hook-form for parity
// with the asset drawers. The reference-image list is a parallel useState
// because each item carries upload status (uploading / uploaded / failed) that
// would be awkward to thread through useFieldArray.
export function PlaygroundPage() {
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [result, setResult] = useState<PlaygroundResult | null>(null);

  const getUploadUrl = trpc.mediaAssets.getUploadUrl.useMutation();
  const createStandalone = trpc.mediaAssets.createStandalone.useMutation();
  const generate = trpc.ai.generateStandalone.useMutation();

  const uploadedRefs = refs.filter((r) => r.status === 'uploaded');
  const uploading = refs.some((r) => r.status === 'uploading');
  const promptEmpty = form.watch('prompt').trim().length === 0;
  const generateDisabled = promptEmpty || uploading || generate.isPending;

  async function handleAddRef(file: File) {
    if (refs.length >= MAX_REF_IMAGES) {
      toast.warning(`最多 ${MAX_REF_IMAGES} 张参考图`);
      return;
    }
    const localId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previewUrl = URL.createObjectURL(file);
    setRefs((prev) => [...prev, { localId, status: 'uploading', previewUrl }]);

    try {
      const { uploadUrl, objectKey } = await getUploadUrl.mutateAsync({
        mediaType: 'image',
        filename: file.name,
      });
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!putRes.ok) throw new Error(`上传失败：${putRes.status}`);
      const created = await createStandalone.mutateAsync({
        objectKey,
        mediaType: 'image',
        filename: file.name,
      });
      setRefs((prev) =>
        prev.map((r) =>
          r.localId === localId
            ? {
                ...r,
                status: 'uploaded',
                mediaId: created.id,
                previewUrl: created.url || r.previewUrl,
              }
            : r,
        ),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : '上传失败';
      setRefs((prev) =>
        prev.map((r) => (r.localId === localId ? { ...r, status: 'failed', error: message } : r)),
      );
      toast.error(message);
    }
  }

  function handleRemoveRef(localId: string) {
    setRefs((prev) => {
      const target = prev.find((r) => r.localId === localId);
      // Release the object URL we minted in handleAddRef so we don't leak.
      if (target?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((r) => r.localId !== localId);
    });
  }

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    const refImages = uploadedRefs.map((r) => r.mediaId as number);
    try {
      const res = await generate.mutateAsync({
        prompt: values.prompt.trim(),
        aspectRatio: values.aspectRatio,
        model: values.model,
        // Send undefined (not []) when no refs — server-side schema is optional
        // and the no-refs path uses plain-text content to OpenRouter.
        ...(refImages.length > 0 ? { refImages } : {}),
      });
      setResult({ mediaId: res.id, url: res.url });
    } catch (e) {
      const message = e instanceof Error ? e.message : '生成失败';
      toast.error(message);
    }
  };

  function handleUseResultAsRef() {
    if (!result) return;
    if (refs.length >= MAX_REF_IMAGES) {
      toast.warning(`最多 ${MAX_REF_IMAGES} 张参考图`);
      return;
    }
    // The result row already lives in `media`, so we can reuse its id directly
    // — no second upload, no createStandalone call.
    const localId = `result-${result.mediaId}-${Date.now()}`;
    setRefs((prev) => [
      ...prev,
      {
        localId,
        status: 'uploaded',
        previewUrl: result.url,
        mediaId: result.mediaId,
      },
    ]);
    setResult(null);
  }

  return (
    <section className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto px-5 py-6">
      <RefImageList value={refs} onAdd={handleAddRef} onRemove={handleRemoveRef} />

      <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldRow label="模型选项" htmlFor="playground-model">
          <Select id="playground-model" {...form.register('model')}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </FieldRow>

        <FieldRow label="尺寸选项" htmlFor="playground-aspect">
          <Select id="playground-aspect" {...form.register('aspectRatio')}>
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {ASPECT_LABELS[r as AspectRatio]}
              </option>
            ))}
          </Select>
        </FieldRow>

        <Textarea
          rows={8}
          placeholder="输入指令以生成新图像（中英文均可）"
          aria-label="提示词"
          {...form.register('prompt')}
        />

        <Button type="submit" disabled={generateDisabled} className="w-full">
          {generate.isPending ? '生成中…' : '生成图像'}
        </Button>
      </form>

      {result ? <ResultPanel result={result} onUseAsRef={handleUseResultAsRef} /> : null}
    </section>
  );
}

function FieldRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
        {label}
      </label>
      {children}
    </div>
  );
}
