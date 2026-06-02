import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  QUESTION_TYPES,
  SHOT_TYPES,
  TASK_TYPES,
} from '@benchmark-admin/shared/constants/question-types';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type RouterOutputs, trpc } from '@/lib/trpc';

type MediaLink = RouterOutputs['benchmark']['get']['media']['character_image'][number];
import { Field } from '@/components/drawers/shared/Field';
import { BenchmarkComments } from './BenchmarkComments';
import { MediaPicker } from './MediaPicker';

const SCENE_OPTIONS = ['电影 / 预告片', '短剧 / 剧情片段', '动画 / 风格化内容'] as const;
const SCREEN_SIZE_OPTIONS = ['16:9', '9:16', '2.39:1'] as const;
const SCORE_OPTIONS = [null, 0, 1, 2, 3, 4, 5] as const;
const DIFFICULTY_OPTIONS = ['', '易', '中', '难'] as const;

// Legacy auto-prefixes the manual tag with the difficulty marker, e.g. 【难】.
// Strip any existing 【易/中/难】 prefix before re-applying the current one, so
// changing difficulty replaces the marker rather than stacking them.
const DIFFICULTY_PREFIX_RE = /^【([易中难])】\s*/;
function applyDifficultyPrefix(manualTag: string, difficulty: string): string {
  const base = manualTag.replace(DIFFICULTY_PREFIX_RE, '').trim();
  return difficulty ? `【${difficulty}】${base ? ` ${base}` : ''}` : base;
}

const FormSchema = z.object({
  shotType: z.string(),
  taskType: z.string(),
  questionType: z.string(),
  manualTag: z.string(),
  scene: z.string(),
  screenSize: z.string(),
  difficulty: z.enum(['', '易', '中', '难']),
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
  difficulty: '',
  textPrompt: '',
  judgingCriteria: '',
  score: null,
  needsRevision: false,
};

type Media = {
  characterImageIds: number[];
  sceneImageIds: number[];
  propImageIds: number[];
  audioInputIds: number[];
  videoInputIds: number[];
  videoOutputIds: number[];
};

const EMPTY_MEDIA: Media = {
  characterImageIds: [],
  sceneImageIds: [],
  propImageIds: [],
  audioInputIds: [],
  videoInputIds: [],
  videoOutputIds: [],
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
  const deleteMutation = trpc.benchmark.delete.useMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: EMPTY,
  });
  const [media, setMedia] = useState<Media>(EMPTY_MEDIA);
  // `media` is React state outside react-hook-form, so it has no keepDirtyValues
  // protection. Seed it from the server exactly ONCE per opened item id; a later
  // background refetch (post-save / post-AI) must not clobber in-progress media
  // edits. Switching to a different item id re-seeds correctly.
  const seededMediaForId = useRef<number | null>(null);

  useEffect(() => {
    if (!isNew && get.data) {
      // keepDirtyValues so a post-save / post-AI refetch doesn't overwrite
      // fields the user has edited but not yet submitted.
      form.reset(
        {
          shotType: get.data.shotType,
          taskType: get.data.taskType,
          questionType: get.data.questionType,
          manualTag: get.data.manualTag,
          scene: get.data.scene,
          screenSize: get.data.screenSize,
          difficulty: get.data.difficulty as FormValues['difficulty'],
          textPrompt: get.data.textPrompt,
          judgingCriteria: get.data.judgingCriteria,
          score: get.data.score,
          needsRevision: get.data.needsRevision,
        },
        { keepDirtyValues: true },
      );
      if (seededMediaForId.current !== id) {
        seededMediaForId.current = id;
        setMedia({
          characterImageIds: get.data.media.character_image.map((l: MediaLink) => l.mediaId),
          sceneImageIds: get.data.media.scene_image.map((l: MediaLink) => l.mediaId),
          propImageIds: get.data.media.prop_image.map((l: MediaLink) => l.mediaId),
          audioInputIds: get.data.media.audio_input.map((l: MediaLink) => l.mediaId),
          videoInputIds: get.data.media.video_input.map((l: MediaLink) => l.mediaId),
          videoOutputIds: get.data.media.video_output.map((l: MediaLink) => l.mediaId),
        });
      }
    }
  }, [isNew, id, get.data, form]);

  const shotType = form.watch('shotType');
  const scoreValue = form.watch('score');

  // Non-blocking completeness feedback: the product wants curated items, but an
  // unscored / incomplete item is a valid in-progress state, so we surface an
  // advisory notice instead of hard zod `.min(1)` errors that would block save.
  const textPrompt = form.watch('textPrompt');
  const judgingCriteria = form.watch('judgingCriteria');
  const hasAnyMedia =
    media.characterImageIds.length > 0 ||
    media.sceneImageIds.length > 0 ||
    media.propImageIds.length > 0 ||
    media.audioInputIds.length > 0 ||
    media.videoInputIds.length > 0 ||
    media.videoOutputIds.length > 0;
  const missing: string[] = [];
  if (!textPrompt.trim()) missing.push('文字提示词');
  if (!judgingCriteria.trim()) missing.push('评判标准');
  if (!hasAnyMedia) missing.push('媒体');

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    // Stamp the difficulty marker onto the manual tag (legacy parity).
    const payload = {
      ...values,
      manualTag: applyDifficultyPrefix(values.manualTag, values.difficulty),
    };
    if (isNew) {
      await create.mutateAsync({ ...payload, media });
    } else {
      await update.mutateAsync({ id, ...payload, media });
    }
    await Promise.all([
      utils.benchmark.list.invalidate(),
      utils.benchmark.stats.invalidate(),
      isNew ? Promise.resolve() : utils.benchmark.get.invalidate({ id }),
    ]);
    onSaved();
  };

  async function handleDelete() {
    await deleteMutation.mutateAsync({ id });
    await Promise.all([utils.benchmark.list.invalidate(), utils.benchmark.stats.invalidate()]);
    onClose();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? '新建题目' : `编辑题目 #${id}`}
      widthClassName="w-[720px] max-w-full"
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {missing.length > 0 ? (
          <output className="block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            缺少: {missing.join(' / ')}（可继续保存为草稿）
          </output>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
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
          <Field label="题目类型">
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
          <Field label="测试点人工标注">
            <Input {...form.register('manualTag')} />
          </Field>
          <Field label="屏幕尺寸">
            <Select {...form.register('screenSize')}>
              <option value="">—</option>
              {SCREEN_SIZE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="场景">
            <Select {...form.register('scene')}>
              <option value="">—</option>
              {SCENE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="难度">
            <Select {...form.register('difficulty')}>
              {DIFFICULTY_OPTIONS.map((v) => (
                <option key={v || 'none'} value={v}>
                  {v || '—'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="文字提示词">
          <Textarea rows={3} {...form.register('textPrompt')} />
        </Field>
        <Field label="评判标准">
          <Textarea rows={2} {...form.register('judgingCriteria')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="评分（0–5）">
            <div className="flex gap-1">
              {SCORE_OPTIONS.map((v) => (
                <button
                  key={v ?? 'null'}
                  type="button"
                  onClick={() =>
                    form.setValue('score', v as FormValues['score'], { shouldDirty: true })
                  }
                  className={`flex-1 rounded border px-1 py-1 text-xs font-medium transition-colors ${
                    scoreValue === v
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  {v === null ? '—' : v}
                </button>
              ))}
            </div>
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" {...form.register('needsRevision')} />
            待修改
          </label>
        </div>

        <section
          aria-label="媒体"
          className="space-y-3 rounded-md border border-[hsl(var(--border))] p-3"
        >
          <h3 className="text-sm font-semibold">媒体绑定</h3>
          <MediaPicker
            label="人物图片素材"
            mediaType="image"
            assetKind="character"
            multi
            selectedIds={media.characterImageIds}
            onChange={(ids) => setMedia((m) => ({ ...m, characterImageIds: ids }))}
          />
          <MediaPicker
            label="场景图片素材"
            mediaType="image"
            assetKind="scene"
            multi
            selectedIds={media.sceneImageIds}
            onChange={(ids) => setMedia((m) => ({ ...m, sceneImageIds: ids }))}
          />
          <MediaPicker
            label="道具图片素材"
            mediaType="image"
            assetKind="prop"
            multi
            selectedIds={media.propImageIds}
            onChange={(ids) => setMedia((m) => ({ ...m, propImageIds: ids }))}
          />
          <MediaPicker
            label="音频输入"
            mediaType="audio"
            multi
            selectedIds={media.audioInputIds}
            onChange={(ids) => setMedia((m) => ({ ...m, audioInputIds: ids }))}
          />
          <MediaPicker
            label="视频输入"
            mediaType="video"
            multi
            selectedIds={media.videoInputIds}
            onChange={(ids) => setMedia((m) => ({ ...m, videoInputIds: ids }))}
          />
          <MediaPicker
            label="视频输出"
            mediaType="video"
            multi
            selectedIds={media.videoOutputIds}
            onChange={(ids) => setMedia((m) => ({ ...m, videoOutputIds: ids }))}
          />
        </section>

        {!isNew ? <BenchmarkComments itemId={id} /> : null}

        <footer className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
          {!isNew ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[hsl(var(--destructive))]">确认删除题目？</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={deleteMutation.isPending}
                  onClick={handleDelete}
                >
                  {deleteMutation.isPending ? '删除中…' : '确认删除'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive-foreground))]"
                onClick={() => setConfirmDelete(true)}
              >
                删除题目
              </Button>
            )
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? '保存中…' : isNew ? '创建' : '保存'}
            </Button>
          </div>
        </footer>
      </form>
    </Drawer>
  );
}
