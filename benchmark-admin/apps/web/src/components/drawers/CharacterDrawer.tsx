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

const CharacterFormSchema = z.object({
  name: z.string().min(1, '必填'),
  era: z.string().optional(),
  genre: z.string().optional(),
  type: z.string().optional(),
  gender: z.string().optional(),
  age: z.string().optional(),
  persona: z.string().optional(),
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
  onCreated: () => void;
}) {
  const ctx = useAssetDrawer('character', id);
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
    name: values.name,
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
      await ctx.create.mutateAsync({ kind: 'character', ...payload });
      await ctx.refresh();
      onCreated();
    } else {
      await ctx.update.mutateAsync({ kind: 'character', id, ...payload });
      await ctx.refresh();
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

  async function handleExtract(text: string) {
    ctx.setAiError(null);
    try {
      const result = await ctx.extractFields.mutateAsync({ kind: 'character', description: text });
      if (result.kind === 'character') {
        const d = result.data;
        const current = form.getValues();
        form.reset(
          { ...current, ...mapCharacter(d, current) },
          { keepDirty: true },
        );
      }
    } catch (e) {
      ctx.setAiError(e instanceof Error ? e.message : '提取失败');
    }
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

  const images = ctx.asset && 'images' in ctx.asset ? ctx.asset.images : [];

  return (
    <Drawer open onClose={onClose} title={ctx.isNew ? '新建角色' : '编辑角色'} widthClassName="w-[640px] max-w-full">
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
          <Field label="类型">
            <Input {...form.register('type')} />
          </Field>
          <Field label="性别">
            <Input {...form.register('gender')} />
          </Field>
          <Field label="年龄">
            <Input {...form.register('age')} />
          </Field>
        </div>
        <Field label="人设">
          <Textarea rows={2} {...form.register('persona')} />
        </Field>
        <Field label="体型">
          <Input {...form.register('body')} />
        </Field>
        <Field label="特征">
          <Textarea rows={2} {...form.register('features')} />
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
              setCoverBusyId={ctx.setCover.isPending ? ctx.setCover.variables?.imageId ?? null : null}
              deleteBusyId={ctx.deleteImage.isPending ? ctx.deleteImage.variables?.imageId ?? null : null}
            />
          </section>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? '保存中…' : '保存'}
          </Button>
        </footer>
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
