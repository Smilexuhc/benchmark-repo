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
import { AiLink } from './shared/AiToolbar';
import { Field } from './shared/Field';
import { ImageGrid } from './shared/ImageGrid';
import { useAssetDrawer } from './shared/useAssetDrawer';

const CharacterFormSchema = z.object({
  name: z.string().optional(),
  era: z.string().optional(),
  genre: z.string().optional(),
  type: z.string().optional(),
  gender: z.string().optional(),
  age: z.string().optional(),
  persona: z.string().min(1, '必填'),
  body: z.string().optional(),
  features: z.string().optional(),
  prompt: z.string().optional(),
  description: z.string().optional(),
});
type CharacterFormValues = z.infer<typeof CharacterFormSchema>;

const EMPTY: CharacterFormValues = {
  name: '',
  era: '',
  genre: '',
  type: '',
  gender: '',
  age: '',
  persona: '',
  body: '',
  features: '',
  prompt: '',
  description: '',
};

export function CharacterDrawer({
  id,
  onClose,
  onCreated,
}: {
  id: number;
  onClose: () => void;
  onCreated: (newId: number) => void;
}) {
  const ctx = useAssetDrawer('character', id);
  const optionsQuery = trpc.assets.options.useQuery({ kind: 'character', deletedOnly: false });
  const deleteAsset = trpc.assets.delete.useMutation();
  const restoreAsset = trpc.assets.restore.useMutation();
  const attachImage = trpc.assets.attachImage.useMutation();
  const getUploadUrl = trpc.mediaAssets.getUploadUrl.useMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CharacterFormValues>({
    resolver: zodResolver(CharacterFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (ctx.asset && ctx.asset.kind === 'character') {
      const a = ctx.asset;
      // keepDirtyValues preserves any fields the user (or AI extract) has
      // already touched, so a post-AI ctx.refresh() can't clobber the unsaved
      // patch with stale server data.
      form.reset(
        {
          name: a.name,
          era: a.era ?? '',
          genre: a.genre ?? '',
          type: a.data.type ?? '',
          gender: a.data.gender ?? '',
          age: a.data.age ?? '',
          persona: a.data.persona ?? '',
          body: a.data.body ?? '',
          features: a.data.features ?? '',
          prompt: a.data.prompt ?? '',
          description: a.data.description ?? '',
        },
        { keepDirtyValues: true },
      );
    }
  }, [ctx.asset, form]);

  const buildPayload = (values: CharacterFormValues) => ({
    // `name` falls back to `persona` so the DB NOT NULL column always has a
    // value while the UI surfaces persona as the required identity field.
    name: values.name?.trim() || values.persona.trim(),
    era: values.era || null,
    genre: values.genre || null,
    data: {
      type: values.type || undefined,
      gender: values.gender || undefined,
      age: values.age || undefined,
      persona: values.persona || undefined,
      body: values.body || undefined,
      features: values.features || undefined,
      prompt: values.prompt || undefined,
      description: values.description || undefined,
    },
  });

  const onSubmit: SubmitHandler<CharacterFormValues> = async (values) => {
    const payload = buildPayload(values);
    if (ctx.isNew) {
      const created = await ctx.create.mutateAsync({ kind: 'character', ...payload });
      await ctx.refresh();
      toast.success('角色已创建');
      // Switch the drawer into edit mode for the new asset; do not close.
      onCreated(created.id);
    } else {
      await ctx.update.mutateAsync({ kind: 'character', id, ...payload });
      await ctx.refresh();
      toast.success('已保存');
    }
  };

  async function handleGeneratePrompt() {
    ctx.setAiError(null);
    try {
      const v = form.getValues();
      const data = buildPayload(v).data;
      const { prompt } = await ctx.generatePrompt.mutateAsync({ kind: 'character', data });
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
      const result = await ctx.extractFields.mutateAsync({
        kind: 'character',
        description: text,
      });
      if (result.kind === 'character') {
        const d = result.data;
        const current = form.getValues();
        form.reset({ ...current, ...mapCharacter(d, current) }, { keepDirty: true });
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
      ctx.setAiError('请先保存角色再生成图像');
      return;
    }
    try {
      const prompt = form.getValues('prompt');
      if (!prompt) {
        ctx.setAiError('请先填写或生成提示词');
        return;
      }
      await ctx.generateImage.mutateAsync({ kind: 'character', id, prompt });
      await ctx.refresh();
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '生成图像失败');
    }
  }

  async function handleUploadClick() {
    if (ctx.isNew) {
      ctx.setAiError('请先保存角色再上传图像');
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
      title: '删除该角色？',
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
  const options = optionsQuery.data?.kind === 'character' ? optionsQuery.data : undefined;

  // Legacy uses the asset's persona as the drawer title for edits (e.g. "草原雄狮"),
  // not a generic 编辑角色. Falls back to "编辑角色" if persona is empty.
  const editTitle =
    (ctx.asset && 'data' in ctx.asset && (ctx.asset.data?.persona as string | undefined))?.trim() ||
    ctx.asset?.name?.trim() ||
    '编辑角色';

  return (
    <Drawer open onClose={onClose} title={ctx.isNew ? '新建角色' : editTitle}>
      <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {/* Section 1 — free description + AI extract */}
        <Field
          label="自由描述（用一段话描述角色）"
          trailing={
            <AiLink busy={ctx.extractFields.isPending} busyLabel="解析中…" onClick={handleExtract}>
              AI 填入字段
            </AiLink>
          }
        >
          <Textarea
            rows={4}
            placeholder="例：一个高冷的禁欲系霸总，西装、冷脸……写完点「AI 填入字段」自动填下方各项"
            {...form.register('description')}
          />
        </Field>

        {/* Section 2 — structured fields. Order mirrors legacy CharacterDrawer
            SELECT_FIELDS exactly: 时代 / 类型 / 性别 / 年龄段 / 常见题材.
            The DB `name` column auto-fills from `persona` in buildPayload, so
            we don't surface a separate 名称 input — legacy doesn't either. */}
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
            <Field label="类型">
              <AutoComplete
                value={form.watch('type') ?? ''}
                onChange={(v) => form.setValue('type', v, { shouldDirty: true })}
                options={options?.type ?? []}
                aria-label="类型"
                placeholder="选择或输入类型"
              />
            </Field>
            <Field label="性别">
              <AutoComplete
                value={form.watch('gender') ?? ''}
                onChange={(v) => form.setValue('gender', v, { shouldDirty: true })}
                options={options?.gender ?? []}
                aria-label="性别"
                placeholder="选择或输入性别"
              />
            </Field>
            <Field label="年龄段">
              <AutoComplete
                value={form.watch('age') ?? ''}
                onChange={(v) => form.setValue('age', v, { shouldDirty: true })}
                options={options?.age ?? []}
                aria-label="年龄段"
                placeholder="选择或输入年龄段"
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
          </div>

          <Field label="人设/服装造型" required error={form.formState.errors.persona?.message}>
            <Textarea rows={2} {...form.register('persona')} placeholder="输入人设/服装造型" />
          </Field>
          <Field label="身材">
            <Input {...form.register('body')} placeholder="输入身材" />
          </Field>
          <Field label="特征">
            <Textarea rows={2} {...form.register('features')} placeholder="输入特征" />
          </Field>
        </section>

        {/* Section 3 — prompt + AI generate / copy */}
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

        {/* Section 4 — image grid. Always rendered so the new and edit forms
            share the same shape; in new mode the buttons disable and a hint
            tells the user to save first. Matches legacy CharacterDrawer.tsx. */}
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
              保存角色后即可生成 / 上传图片。
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
              setCoverBusyId={
                ctx.setCover.isPending ? (ctx.setCover.variables?.imageId ?? null) : null
              }
              deleteBusyId={
                ctx.deleteImage.isPending ? (ctx.deleteImage.variables?.imageId ?? null) : null
              }
            />
          )}
        </section>

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

function mapCharacter(
  data: Partial<CharacterFormValues>,
  current: CharacterFormValues,
): Partial<CharacterFormValues> {
  return {
    type: data.type ?? current.type,
    gender: data.gender ?? current.gender,
    age: data.age ?? current.age,
    persona: data.persona ?? current.persona,
    body: data.body ?? current.body,
    features: data.features ?? current.features,
    prompt: data.prompt ?? current.prompt,
    description: data.description ?? current.description,
  };
}
