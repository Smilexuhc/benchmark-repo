import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AiToolbar } from './shared/AiToolbar';
import { Field } from './shared/Field';
import { ImageGrid } from './shared/ImageGrid';
import { useAssetDrawer } from './shared/useAssetDrawer';

const PropFormSchema = z.object({
  name: z.string().min(1, '必填'),
  era: z.string().optional(),
  genre: z.string().optional(),
  category: z.string().optional(),
  prompt: z.string().optional(),
  description: z.string().optional(),
});
type PropFormValues = z.infer<typeof PropFormSchema>;

const EMPTY: PropFormValues = {
  name: '',
  era: '',
  genre: '',
  category: '',
  prompt: '',
  description: '',
};

export function PropDrawer({
  id,
  onClose,
  onCreated,
}: {
  id: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const ctx = useAssetDrawer('prop', id);
  const form = useForm<PropFormValues>({
    resolver: zodResolver(PropFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (ctx.asset && ctx.asset.kind === 'prop') {
      const a = ctx.asset;
      form.reset(
        {
          name: a.name,
          era: a.era ?? '',
          genre: a.genre ?? '',
          category: a.data.category ?? '',
          prompt: a.data.prompt ?? '',
          description: a.data.description ?? '',
        },
        { keepDirtyValues: true },
      );
    }
  }, [ctx.asset, form]);

  function buildPayload(values: PropFormValues) {
    return {
      name: values.name,
      era: values.era || null,
      genre: values.genre || null,
      data: {
        category: values.category || undefined,
        prompt: values.prompt || undefined,
        description: values.description || undefined,
      },
    };
  }

  const onSubmit: SubmitHandler<PropFormValues> = async (values) => {
    const payload = buildPayload(values);
    if (ctx.isNew) {
      await ctx.create.mutateAsync({ kind: 'prop', ...payload });
      await ctx.refresh();
      onCreated();
    } else {
      await ctx.update.mutateAsync({ kind: 'prop', id, ...payload });
      await ctx.refresh();
    }
  };

  async function handleGeneratePrompt() {
    ctx.setAiError(null);
    try {
      const v = form.getValues();
      const data = buildPayload(v).data;
      const { prompt } = await ctx.generatePrompt.mutateAsync({ kind: 'prop', data });
      form.setValue('prompt', prompt, { shouldDirty: true });
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '生成失败');
    }
  }

  async function handleExtract(text: string) {
    ctx.setAiError(null);
    try {
      const result = await ctx.extractFields.mutateAsync({ kind: 'prop', description: text });
      if (result.kind === 'prop') {
        const d = result.data;
        const current = form.getValues();
        form.reset({
          ...current,
          category: d.category ?? current.category,
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
      ctx.setAiError('请先保存道具再生成图像');
      return;
    }
    try {
      const prompt = form.getValues('prompt');
      if (!prompt) {
        ctx.setAiError('请先填写或生成提示词');
        return;
      }
      await ctx.generateImage.mutateAsync({ kind: 'prop', id, prompt });
      await ctx.refresh();
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '生成图像失败');
    }
  }

  const images = ctx.asset && 'images' in ctx.asset ? ctx.asset.images : [];

  return (
    <Drawer open onClose={onClose} title={ctx.isNew ? '新建道具' : '编辑道具'} widthClassName="w-[640px] max-w-full">
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
          <Field label="分类">
            <Input {...form.register('category')} />
          </Field>
        </div>
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

