import { confirm } from '@/components/feedback/confirm';
import { toast } from '@/components/feedback/toast';
import { AutoComplete } from '@/components/ui/autocomplete';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerFooter } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';
import { SceneViewColumn } from './SceneViewColumn';
import { AiLink } from './shared/AiToolbar';
import { Field } from './shared/Field';
import { ImageGrid } from './shared/ImageGrid';
import { useAssetDrawer } from './shared/useAssetDrawer';

const SceneFormSchema = z.object({
  name: z.string().min(1, '必填'),
  era: z.string().optional(),
  genre: z.string().optional(),
  scene_type: z.string().optional(),
  mood: z.string().optional(),
  elements: z.string().optional(),
  prompt: z.string().optional(),
  description: z.string().optional(),
});
type SceneFormValues = z.infer<typeof SceneFormSchema>;

const EMPTY: SceneFormValues = {
  name: '',
  era: '',
  genre: '',
  scene_type: '',
  mood: '',
  elements: '',
  prompt: '',
  description: '',
};

export function SceneDrawer({
  id,
  onClose,
  onCreated,
}: {
  id: number;
  onClose: () => void;
  onCreated: (newId: number) => void;
}) {
  const ctx = useAssetDrawer('scene', id);
  const optionsQuery = trpc.assets.options.useQuery({ kind: 'scene', deletedOnly: false });
  const deleteAsset = trpc.assets.delete.useMutation();
  const restoreAsset = trpc.assets.restore.useMutation();
  const attachImage = trpc.assets.attachImage.useMutation();
  const getUploadUrl = trpc.mediaAssets.getUploadUrl.useMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<SceneFormValues>({
    resolver: zodResolver(SceneFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (ctx.asset && ctx.asset.kind === 'scene') {
      const a = ctx.asset;
      form.reset(
        {
          name: a.name,
          era: a.era ?? '',
          genre: a.genre ?? '',
          scene_type: a.data.scene_type ?? '',
          mood: a.data.mood ?? '',
          elements: a.data.elements?.join(', ') ?? '',
          prompt: a.data.prompt ?? '',
          description: a.data.description ?? '',
        },
        { keepDirtyValues: true },
      );
    }
  }, [ctx.asset, form]);

  function buildPayload(values: SceneFormValues) {
    const elements = values.elements
      ? values.elements
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return {
      name: values.name,
      era: values.era || null,
      genre: values.genre || null,
      data: {
        scene_type: values.scene_type || undefined,
        mood: values.mood || undefined,
        elements,
        prompt: values.prompt || undefined,
        description: values.description || undefined,
      },
    };
  }

  const onSubmit: SubmitHandler<SceneFormValues> = async (values) => {
    const payload = buildPayload(values);
    if (ctx.isNew) {
      const created = await ctx.create.mutateAsync({ kind: 'scene', ...payload });
      await ctx.refresh();
      toast.success('场景已创建');
      onCreated(created.id);
    } else {
      await ctx.update.mutateAsync({ kind: 'scene', id, ...payload });
      await ctx.refresh();
      toast.success('已保存');
    }
  };

  async function handleGeneratePrompt() {
    ctx.setAiError(null);
    try {
      const v = form.getValues();
      const data = buildPayload(v).data;
      const { prompt } = await ctx.generatePrompt.mutateAsync({ kind: 'scene', data });
      form.setValue('prompt', prompt, { shouldDirty: true });
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '生成失败');
    }
  }

  async function handleExtract() {
    ctx.setAiError(null);
    const text = (form.getValues('description') ?? '').trim();
    if (!text) {
      ctx.setAiError('请先填写描述');
      return;
    }
    try {
      const result = await ctx.extractFields.mutateAsync({ kind: 'scene', description: text });
      if (result.kind === 'scene') {
        const d = result.data;
        const current = form.getValues();
        form.reset(
          {
            ...current,
            scene_type: d.scene_type ?? current.scene_type,
            mood: d.mood ?? current.mood,
            elements: d.elements?.join(', ') ?? current.elements,
            prompt: d.prompt ?? current.prompt,
            description: d.description ?? current.description,
          },
          { keepDirty: true },
        );
        toast.success('已填入字段');
      }
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '提取失败');
    }
  }

  async function handleCopyPrompt() {
    const prompt = form.getValues('prompt');
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    toast.success('已复制');
  }

  async function handleGenerateImage() {
    ctx.setAiError(null);
    if (ctx.isNew) {
      ctx.setAiError('请先保存场景再生成图像');
      return;
    }
    try {
      const prompt = form.getValues('prompt');
      if (!prompt) {
        ctx.setAiError('请先填写或生成提示词');
        return;
      }
      await ctx.generateImage.mutateAsync({ kind: 'scene', id, prompt });
      await ctx.refresh();
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '生成图像失败');
    }
  }

  async function handleUploadClick() {
    if (ctx.isNew) {
      ctx.setAiError('请先保存场景再上传图像');
      return;
    }
    fileInputRef.current?.click();
  }

  async function handleFileChosen(file: File) {
    ctx.setAiError(null);
    try {
      const { uploadUrl, objectKey } = await getUploadUrl.mutateAsync({
        mediaType: 'image',
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
      });
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!putRes.ok) throw new Error(`上传失败：${putRes.status}`);
      await attachImage.mutateAsync({ id, objectKey, source: 'uploaded' });
      await ctx.refresh();
      toast.success('已上传');
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '上传失败');
    }
  }

  async function handleDelete() {
    if (ctx.isNew) return;
    const ok = await confirm({
      title: '删除该场景？',
      body: '删除后可在“已删除”视图恢复。',
      danger: true,
      confirmText: '删除',
    });
    if (!ok) return;
    await deleteAsset.mutateAsync({ id });
    await ctx.refresh();
    toast.success('已删除');
    onClose();
  }

  async function handleRestore() {
    if (ctx.isNew) return;
    await restoreAsset.mutateAsync({ id });
    await ctx.refresh();
    toast.success('已恢复');
  }

  const images = ctx.asset && 'images' in ctx.asset ? ctx.asset.images : [];
  const isDeleted = ctx.asset?.deletedAt != null;
  const options = optionsQuery.data?.kind === 'scene' ? optionsQuery.data : undefined;

  const editTitle = ctx.asset?.name?.trim() || '编辑场景';

  return (
    <Drawer open onClose={onClose} title={ctx.isNew ? '新建场景' : editTitle}>
      <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Field
          label="自由描述（用一段话描述场景）"
          trailing={
            <AiLink busy={ctx.extractFields.isPending} busyLabel="解析中…" onClick={handleExtract}>
              AI 填入字段
            </AiLink>
          }
        >
          <Textarea
            rows={4}
            placeholder="例：一个仙气古风庭院，青石台面、朦胧纱幔……写完点「AI 填入字段」自动填下方各项"
            {...form.register('description')}
          />
        </Field>

        {/* Order mirrors legacy SceneDrawer SELECT_FIELDS exactly:
            时代 / 场景类型 / 常见题材 / 氛围时段, then 场景名称, 关键元素. */}
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="时代">
              <AutoComplete
                value={form.watch('era') ?? ''}
                onChange={(v) => form.setValue('era', v, { shouldDirty: true })}
                options={options?.era ?? []}
                aria-label="时代"
                placeholder="选择或输入时代"
              />
            </Field>
            <Field label="场景类型">
              <AutoComplete
                value={form.watch('scene_type') ?? ''}
                onChange={(v) => form.setValue('scene_type', v, { shouldDirty: true })}
                options={options?.scene_type ?? []}
                aria-label="场景类型"
                placeholder="选择或输入场景类型"
              />
            </Field>
            <Field label="常见题材">
              <AutoComplete
                value={form.watch('genre') ?? ''}
                onChange={(v) => form.setValue('genre', v, { shouldDirty: true })}
                options={options?.genre ?? []}
                aria-label="常见题材"
                placeholder="选择或输入常见题材"
              />
            </Field>
            <Field label="氛围时段">
              <AutoComplete
                value={form.watch('mood') ?? ''}
                onChange={(v) => form.setValue('mood', v, { shouldDirty: true })}
                options={options?.mood ?? []}
                aria-label="氛围时段"
                placeholder="选择或输入氛围时段"
              />
            </Field>
          </div>

          <Field label="场景名称" required error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} placeholder="输入场景名称" />
          </Field>
          <Field label="关键元素">
            <Input {...form.register('elements')} placeholder="输入关键元素" />
          </Field>
        </section>

        <Field
          label="英文生成提示词"
          trailing={
            <span className="flex items-center gap-3">
              <AiLink
                busy={ctx.generatePrompt.isPending}
                busyLabel="生成中…"
                onClick={handleGeneratePrompt}
              >
                AI 生成提示词
              </AiLink>
              <AiLink onClick={handleCopyPrompt} disabled={!form.watch('prompt')}>
                复制
              </AiLink>
            </span>
          }
        >
          <Textarea
            rows={3}
            placeholder="可手动填写，或点「AI 生成提示词」。有自由描述时按描述生成，否则按上方字段生成。"
            className="font-mono text-xs"
            {...form.register('prompt')}
          />
        </Field>

        {ctx.aiError ? (
          <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
            {ctx.aiError}
          </p>
        ) : null}

        <section aria-label="图集" className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">图集</h3>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ctx.isNew || ctx.generateImage.isPending}
                onClick={handleGenerateImage}
              >
                {ctx.generateImage.isPending ? '生成中…' : '生成图片'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ctx.isNew || getUploadUrl.isPending || attachImage.isPending}
                onClick={handleUploadClick}
              >
                {getUploadUrl.isPending || attachImage.isPending ? '上传中…' : '上传图片'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileChosen(file);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          {ctx.isNew ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              保存场景后即可生成 / 上传图片。
            </p>
          ) : (
            <ImageGrid
              images={images}
              coverImageId={ctx.asset?.coverImageId ?? null}
              onSetCover={async (imageId) => {
                await ctx.setCover.mutateAsync({ id, imageId });
                await ctx.refresh();
              }}
              onDelete={async (imageId) => {
                await ctx.deleteImage.mutateAsync({ imageId });
                await ctx.refresh();
              }}
            />
          )}
        </section>
        {!ctx.isNew ? (
          <SceneViewColumn sceneId={id} images={images} onAfter={() => ctx.refresh()} />
        ) : null}

        <DrawerFooter
          left={
            !ctx.isNew ? (
              isDeleted ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={restoreAsset.isPending}
                  onClick={handleRestore}
                >
                  恢复
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deleteAsset.isPending}
                  onClick={handleDelete}
                >
                  删除
                </Button>
              )
            ) : null
          }
          right={
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? '保存中…' : ctx.isNew ? '创建' : '保存'}
              </Button>
            </>
          }
        />
      </form>
    </Drawer>
  );
}
