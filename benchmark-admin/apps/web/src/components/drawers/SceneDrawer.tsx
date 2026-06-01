import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SceneViewColumn } from './SceneViewColumn';
import { AiToolbar } from './shared/AiToolbar';
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
  onCreated: () => void;
}) {
  const ctx = useAssetDrawer('scene', id);
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
      ? values.elements.split(',').map((s) => s.trim()).filter(Boolean)
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
      await ctx.create.mutateAsync({ kind: 'scene', ...payload });
      await ctx.refresh();
      onCreated();
    } else {
      await ctx.update.mutateAsync({ kind: 'scene', id, ...payload });
      await ctx.refresh();
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

  async function handleExtract(text: string) {
    ctx.setAiError(null);
    try {
      const result = await ctx.extractFields.mutateAsync({ kind: 'scene', description: text });
      if (result.kind === 'scene') {
        const d = result.data;
        const current = form.getValues();
        form.reset({
          ...current,
          scene_type: d.scene_type ?? current.scene_type,
          mood: d.mood ?? current.mood,
          elements: d.elements?.join(', ') ?? current.elements,
          prompt: d.prompt ?? current.prompt,
          description: d.description ?? current.description,
        }, { keepDirty: true });
      }
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '提取失败');
    }
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

  const images = ctx.asset && 'images' in ctx.asset ? ctx.asset.images : [];

  return (
    <Drawer open onClose={onClose} title={ctx.isNew ? '新建场景' : '编辑场景'} widthClassName="w-[640px] max-w-full">
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <Field label="名称" error={form.formState.errors.name?.message} required>
          <Input {...form.register('name')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="时代">
            <Input {...form.register('era')} />
          </Field>
          <Field label="题材">
            <Input {...form.register('genre')} />
          </Field>
          <Field label="场景类型">
            <Input {...form.register('scene_type')} />
          </Field>
          <Field label="氛围">
            <Input {...form.register('mood')} />
          </Field>
        </div>
        <Field label="元素（逗号分隔）">
          <Input {...form.register('elements')} />
        </Field>
        <Field label="描述">
          <Textarea rows={3} {...form.register('description')} />
        </Field>
        <Field label="提示词">
          <Textarea rows={3} {...form.register('prompt')} />
        </Field>

        <AiToolbar
          hasAsset={!ctx.isNew}
          busy={{
            prompt: ctx.generatePrompt.isPending,
            extract: ctx.extractFields.isPending,
            image: ctx.generateImage.isPending,
          }}
          error={ctx.aiError}
          onGeneratePrompt={handleGeneratePrompt}
          onExtractFields={handleExtract}
          onGenerateImage={handleGenerateImage}
        />

        {!ctx.isNew ? (
          <>
            <section aria-label="图像" className="space-y-2">
              <h3 className="text-sm font-medium">图像</h3>
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
            </section>
            <SceneViewColumn sceneId={id} images={images} onAfter={() => ctx.refresh()} />
          </>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? '保存中…' : '保存'}
          </Button>
        </footer>
      </form>
    </Drawer>
  );
}

