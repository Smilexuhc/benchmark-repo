import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  QUESTION_TYPES,
  SHOT_TYPES,
  TASK_TYPES,
} from '@benchmark-admin/shared/constants/question-types';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { type RouterOutputs, trpc } from '@/lib/trpc';

type MediaLink = RouterOutputs['benchmark']['get']['media']['character_image'][number];
import { BenchmarkComments } from './BenchmarkComments';
import { MediaPicker } from './MediaPicker';

const FormSchema = z.object({
  shotType: z.string(),
  taskType: z.string(),
  questionType: z.string(),
  manualTag: z.string(),
  scene: z.string(),
  screenSize: z.string(),
  textPrompt: z.string(),
  judgingCriteria: z.string(),
  score: z
    .union([z.coerce.number().int().min(0).max(5), z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .pipe(z.number().int().min(0).max(5).nullable()),
  needsRevision: z.boolean(),
});
type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  shotType: '',
  taskType: '',
  questionType: '',
  manualTag: '',
  scene: '',
  screenSize: '',
  textPrompt: '',
  judgingCriteria: '',
  score: null,
  needsRevision: false,
};

type Media = {
  characterImageIds: number[];
  sceneImageIds: number[];
  propImageIds: number[];
  audioInputId: number | null;
  videoInputId: number | null;
  videoOutputId: number | null;
};

const EMPTY_MEDIA: Media = {
  characterImageIds: [],
  sceneImageIds: [],
  propImageIds: [],
  audioInputId: null,
  videoInputId: null,
  videoOutputId: null,
};

export type BenchmarkDrawerProps = {
  id: number; // 0 = new
  onClose: () => void;
  onSaved: () => void;
};

export function BenchmarkDrawer({ id, onClose, onSaved }: BenchmarkDrawerProps) {
  const isNew = id === 0;
  const utils = trpc.useUtils();
  const get = trpc.benchmark.get.useQuery({ id }, { enabled: !isNew });
  const create = trpc.benchmark.create.useMutation();
  const update = trpc.benchmark.update.useMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });
  const [media, setMedia] = useState<Media>(EMPTY_MEDIA);

  useEffect(() => {
    if (!isNew && get.data) {
      form.reset({
        shotType: get.data.shotType,
        taskType: get.data.taskType,
        questionType: get.data.questionType,
        manualTag: get.data.manualTag,
        scene: get.data.scene,
        screenSize: get.data.screenSize,
        textPrompt: get.data.textPrompt,
        judgingCriteria: get.data.judgingCriteria,
        score: get.data.score,
        needsRevision: get.data.needsRevision,
      });
      setMedia({
        characterImageIds: get.data.media.character_image.map((l: MediaLink) => l.mediaId),
        sceneImageIds: get.data.media.scene_image.map((l: MediaLink) => l.mediaId),
        propImageIds: get.data.media.prop_image.map((l: MediaLink) => l.mediaId),
        audioInputId: get.data.media.audio_input?.mediaId ?? null,
        videoInputId: get.data.media.video_input?.mediaId ?? null,
        videoOutputId: get.data.media.video_output?.mediaId ?? null,
      });
    }
  }, [isNew, get.data, form]);

  const shotType = form.watch('shotType');

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    if (isNew) {
      await create.mutateAsync({ ...values, media });
    } else {
      await update.mutateAsync({ id, ...values, media });
    }
    await Promise.all([
      utils.benchmark.list.invalidate(),
      utils.benchmark.stats.invalidate(),
      isNew ? Promise.resolve() : utils.benchmark.get.invalidate({ id }),
    ]);
    onSaved();
  };

  return (
    <Drawer open onClose={onClose} title={isNew ? '新建评测' : '编辑评测'} widthClassName="w-[720px] max-w-full">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="grid grid-cols-3 gap-3">
          <Field label="镜头类型">
            <Select {...form.register('shotType')}>
              <option value="">—</option>
              {SHOT_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="任务类型">
            <Select {...form.register('taskType')}>
              <option value="">—</option>
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="题型">
            <Select {...form.register('questionType')} disabled={!shotType}>
              <option value="">—</option>
              {QUESTION_TYPES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="手工标签">
            <Input {...form.register('manualTag')} />
          </Field>
          <Field label="屏幕尺寸">
            <Input {...form.register('screenSize')} />
          </Field>
        </div>
        <Field label="场景">
          <Input {...form.register('scene')} />
        </Field>
        <Field label="文本 Prompt">
          <Textarea rows={3} {...form.register('textPrompt')} />
        </Field>
        <Field label="评分标准">
          <Textarea rows={2} {...form.register('judgingCriteria')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="评分（0–5）">
            <Input type="number" min={0} max={5} {...form.register('score')} />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" {...form.register('needsRevision')} />
            需要返工
          </label>
        </div>

        <section aria-label="媒体" className="space-y-3 rounded-md border border-[hsl(var(--border))] p-3">
          <h3 className="text-sm font-semibold">媒体绑定</h3>
          <MediaPicker
            label="角色图"
            mediaType="image"
            assetKind="character"
            multi
            selectedIds={media.characterImageIds}
            onChange={(ids) => setMedia((m) => ({ ...m, characterImageIds: ids }))}
          />
          <MediaPicker
            label="场景图"
            mediaType="image"
            assetKind="scene"
            multi
            selectedIds={media.sceneImageIds}
            onChange={(ids) => setMedia((m) => ({ ...m, sceneImageIds: ids }))}
          />
          <MediaPicker
            label="道具图"
            mediaType="image"
            assetKind="prop"
            multi
            selectedIds={media.propImageIds}
            onChange={(ids) => setMedia((m) => ({ ...m, propImageIds: ids }))}
          />
          <MediaPicker
            label="音频输入"
            mediaType="audio"
            selectedIds={media.audioInputId !== null ? [media.audioInputId] : []}
            onChange={(ids) => setMedia((m) => ({ ...m, audioInputId: ids[0] ?? null }))}
          />
          <MediaPicker
            label="视频输入"
            mediaType="video"
            selectedIds={media.videoInputId !== null ? [media.videoInputId] : []}
            onChange={(ids) => setMedia((m) => ({ ...m, videoInputId: ids[0] ?? null }))}
          />
          <MediaPicker
            label="视频输出"
            mediaType="video"
            selectedIds={media.videoOutputId !== null ? [media.videoOutputId] : []}
            onChange={(ids) => setMedia((m) => ({ ...m, videoOutputId: ids[0] ?? null }))}
          />
        </section>

        {!isNew ? <BenchmarkComments itemId={id} /> : null}

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps an Input child component which biome can't detect
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
