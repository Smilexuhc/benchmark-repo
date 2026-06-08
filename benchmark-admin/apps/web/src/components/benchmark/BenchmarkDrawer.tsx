import { Button } from '@/components/ui/button';
import { Cascader } from '@/components/ui/cascader';
import { buildCascaderOptionsWithCounts } from '@/components/ui/cascader.helpers';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { type RouterOutputs, trpc } from '@/lib/trpc';
import { Popover } from '@base-ui/react/popover';
import { CATEGORY_TREE, definitionFor } from '@benchmark-admin/shared/benchmark/categoryTree';
import {
  QUESTION_TYPES,
  SHOT_TYPES,
  TASK_TYPES,
} from '@benchmark-admin/shared/constants/question-types';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type SubmitHandler, useForm } from 'react-hook-form';
import { z } from 'zod';

type MediaLink = RouterOutputs['benchmark']['get']['media']['character_image'][number];
import { Field } from '@/components/drawers/shared/Field';
import { MediaPicker } from './MediaPicker';

const SCENE_OPTIONS = ['电影 / 预告片', '短剧 / 剧情片段', '动画 / 风格化内容'] as const;
const SCREEN_SIZE_OPTIONS = ['16:9', '9:16', '2.39:1'] as const;
const SCORE_OPTIONS = [null, 0, 1, 2, 3, 4, 5] as const;
const DIFFICULTY_OPTIONS = ['', '易', '中', '难'] as const;

// Legacy parity: BenchmarkItemDrawer.tsx:129-145 — three rich blocks that
// describe what 易/中/难 mean, opened by clicking the info icon next to the
// difficulty Select. Replaces the prior plain `title` HTML tooltip, which lost
// the styled definition panel from legacy.
const DIFFICULTY_DEFINITIONS: { value: '易' | '中' | '难'; title: string; body: string }[] = [
  {
    value: '易',
    title: '简单',
    body: '单一清晰主体，常规或静态表现，没有额外扰动。模型在理想条件下本应稳定完成，是用来确认「基本功在不在」的基准线。',
  },
  {
    value: '中',
    title: '中等',
    body: '在简单的基础上，只引入一项复杂度：要么主体变多，要么表现变剧烈，要么叠加一层扰动，但其余两项保持简单，焦点依然单一。模型需要多处理一件事。',
  },
  {
    value: '难',
    title: '困难',
    body: '多项复杂度交叉，逼近或越过模型能力边界；或者本身就是行业已知容易崩的场景。典型失效模式包括高相似度多主体、换脸/人皮面具、受伤或剧烈状态变化、幻想生物、多主体复杂交互、叠加场景切换。',
  },
];

// Legacy parity highlight: ≥4 green, ≥2 blue, <2 orange, null gray.
// Returned as a tailwind class string applied to the active score button.
function scoreColor(score: number | null): string {
  if (score === null) return 'border-gray-400 bg-gray-100 text-gray-700';
  if (score >= 4) return 'border-emerald-500 bg-emerald-500 text-white';
  if (score >= 2) return 'border-blue-500 bg-blue-500 text-white';
  return 'border-orange-500 bg-orange-500 text-white';
}

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
  categoryL1: z.string(),
  categoryL2: z.string(),
  categoryL3: z.string(),
  categoryDefinition: z.string(),
  difficulty: z.enum(['', '易', '中', '难']),
  textPrompt: z.string(),
  expectedVideoTimeInSec: z
    .union([z.coerce.number().int().min(0), z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .pipe(z.number().int().min(0).nullable()),
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
  categoryL1: '',
  categoryL2: '',
  categoryL3: '',
  categoryDefinition: '',
  difficulty: '',
  textPrompt: '',
  expectedVideoTimeInSec: null,
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
  // Drive the 新分类 Cascader's open state from here so we can force-close it
  // after a leaf commit. The Cascader's own setOpen(false) closes cleanly in
  // Chrome but not in some Edge configurations, so we belt-and-suspenders it.
  const [cascaderOpen, setCascaderOpen] = useState(false);

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
          categoryL1: get.data.categoryL1,
          categoryL2: get.data.categoryL2,
          categoryL3: get.data.categoryL3,
          categoryDefinition: get.data.categoryDefinition,
          difficulty: get.data.difficulty as FormValues['difficulty'],
          textPrompt: get.data.textPrompt,
          expectedVideoTimeInSec: get.data.expectedVideoTimeInSec,
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

  // V3 category cascade (l1 → l2 → l3). The shared Cascader handles narrowing;
  // we just feed it the tree (decorated with per-node item counts from
  // `benchmark.stats`) and write the full path on commit.
  const categoryL1 = form.watch('categoryL1');
  const categoryL2 = form.watch('categoryL2');
  const categoryL3 = form.watch('categoryL3');
  const categoryDefinition = form.watch('categoryDefinition');

  const stats = trpc.benchmark.stats.useQuery();
  const cascaderOptions = useMemo(
    () => buildCascaderOptionsWithCounts(CATEGORY_TREE, stats.data?.groups ?? []),
    [stats.data],
  );
  const cascaderValue = useMemo(
    () => [categoryL1, categoryL2, categoryL3].filter((v) => v !== ''),
    [categoryL1, categoryL2, categoryL3],
  );

  function selectCategoryPath(path: string[]) {
    const [l1 = '', l2 = '', l3 = ''] = path;
    form.setValue('categoryL1', l1, { shouldDirty: true });
    form.setValue('categoryL2', l2, { shouldDirty: true });
    form.setValue('categoryL3', l3, { shouldDirty: true });
    form.setValue('categoryDefinition', definitionFor(l1, l2, l3), { shouldDirty: true });
    setCascaderOpen(false);
  }

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
      widthClassName="w-[760px] max-w-full"
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {missing.length > 0 ? (
          <output className="block rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            缺少: {missing.join(' / ')}（可继续保存为草稿）
          </output>
        ) : null}
        {/* Order mirrors legacy frontend/src/components/BenchmarkItemDrawer.tsx:
            新分类 (Cascader, full width) → category_definition (readonly when set) →
            测试点人工标注 (with difficulty Select inline on the left) →
            场景 + 屏幕尺寸 → 文字提示词 → 媒体 → 评分 → 评判标准.
            Legacy doesn't surface 镜头类型 / 题目类型 in the drawer — those
            are list-filter fields backed by the same V3 category dimension. */}
        <Field label="新分类">
          <Cascader
            ariaLabel="新分类"
            placeholder="依次选择 一级分类 → 二级分类 → 三级分类"
            options={cascaderOptions}
            value={cascaderValue}
            onChange={(path) => selectCategoryPath(path)}
            open={cascaderOpen}
            onOpenChange={setCascaderOpen}
          />
        </Field>
        {categoryDefinition ? (
          <Field label="分类定义">
            <Textarea
              rows={2}
              value={categoryDefinition}
              readOnly
              className="bg-[hsl(var(--muted))]"
            />
          </Field>
        ) : null}

        <Field label="测试点人工标注">
          <div className="flex items-center gap-2">
            <Select
              value={form.watch('difficulty')}
              onChange={(e) =>
                form.setValue('difficulty', e.target.value as '' | '易' | '中' | '难', {
                  shouldDirty: true,
                })
              }
              aria-label="难度"
              className="w-[82px] shrink-0"
            >
              {DIFFICULTY_OPTIONS.map((v) => (
                <option key={v || 'none'} value={v}>
                  {v || '难度'}
                </option>
              ))}
            </Select>
            <DifficultyInfoPopover activeValue={form.watch('difficulty')} />
            <Input
              {...form.register('manualTag')}
              placeholder="对该题目的人工补充描述，例如：动作断层跳变（动作中途突然跳转，无过渡衔接，前后姿态割裂）"
              className="flex-1"
            />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="场景">
            <Select {...form.register('scene')}>
              <option value="">选择场景</option>
              {SCENE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="屏幕尺寸">
            <Select {...form.register('screenSize')}>
              <option value="">选择屏幕尺寸</option>
              {SCREEN_SIZE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="文字提示词">
          <Textarea
            rows={4}
            placeholder={
              categoryDefinition && !textPrompt
                ? categoryDefinition
                : '输入文字提示词，可填写 URL、object key、文件名或备注'
            }
            {...form.register('textPrompt')}
          />
        </Field>

        <Field label="视频时长">
          <Input
            type="number"
            min={0}
            step={1}
            placeholder="预期视频时长（秒）"
            {...form.register('expectedVideoTimeInSec')}
          />
        </Field>
        {/* Legacy order: text_prompt → MediaPickers (no section h3) → 评分 →
            评判标准. Comments are NOT in the edit drawer — they live in their
            own drawer triggered from the list card. */}
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

        <Field label="评分">
          <div className="flex gap-1.5">
            {SCORE_OPTIONS.map((v) => {
              const isActive = scoreValue === v;
              return (
                <button
                  key={v ?? 'null'}
                  type="button"
                  aria-pressed={isActive}
                  aria-label={v === null ? '未评分' : `评分 ${v}`}
                  onClick={() =>
                    form.setValue('score', v as FormValues['score'], { shouldDirty: true })
                  }
                  className={`flex-1 rounded border px-1 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? scoreColor(v)
                      : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  {v === null ? '未评分' : v}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="评判标准">
          <Textarea
            rows={4}
            placeholder="输入评判标准，可填写 URL、object key、文件名或备注"
            {...form.register('judgingCriteria')}
          />
        </Field>

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

// Renders an info icon next to the difficulty Select. Click opens a Popover with
// three rich blocks describing 易/中/难; the currently selected level gets a
// blue left border and title color (legacy BenchmarkItemDrawer.tsx:603-621).
function DifficultyInfoPopover({ activeValue }: { activeValue: '' | '易' | '中' | '难' }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={(props) => (
          <button
            type="button"
            aria-label="查看难度定义"
            title="查看难度定义"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            {...props}
          >
            <InfoCircleIcon />
          </button>
        )}
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup className="z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 shadow-lg outline-none">
            <div className="grid gap-2.5">
              {DIFFICULTY_DEFINITIONS.map((item) => {
                const active = activeValue === item.value;
                return (
                  <div
                    key={item.value}
                    className="border-l-[3px] pl-2.5"
                    style={{ borderLeftColor: active ? 'hsl(var(--primary))' : 'hsl(var(--border))' }}
                  >
                    <div
                      className="text-sm font-semibold"
                      style={{ color: active ? 'hsl(var(--primary))' : 'hsl(var(--foreground))' }}
                    >
                      {item.value} · {item.title}
                    </div>
                    <div className="mt-1 text-[13px] leading-5 text-[hsl(var(--muted-foreground))]">
                      {item.body}
                    </div>
                  </div>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function InfoCircleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.75" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}
