import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TREE,
  type CategoryOption,
  definitionFor,
  labelsForPath,
  leafByPath,
} from '../categoryTree.js';

function leaves(tree: CategoryOption[]): CategoryOption[] {
  const out: CategoryOption[] = [];
  const walk = (nodes: CategoryOption[]) => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) walk(n.children);
      else out.push(n);
    }
  };
  walk(tree);
  return out;
}

describe('categoryTree', () => {
  it('every node carries code + value; every leaf has a non-empty definition', () => {
    const walk = (nodes: CategoryOption[]) => {
      for (const n of nodes) {
        expect(n.code).toBeTruthy();
        expect(n.value).toBeTruthy();
        if (n.children && n.children.length > 0) {
          walk(n.children);
        } else {
          expect(n.definition).toBeTruthy();
        }
      }
    };
    walk(CATEGORY_TREE);
  });

  it('l1 set matches legacy', () => {
    expect(CATEGORY_TREE.map((n) => n.value)).toEqual(['单镜头', '连续镜头', '长镜头']);
  });

  it('leaf count matches the current taxonomy (guards against a partial port)', () => {
    expect(leaves(CATEGORY_TREE).length).toBe(82);
  });

  it('definitionFor returns the exact leaf definition for a known path', () => {
    expect(definitionFor('单镜头', '提示词遵循/参考绑定', '核心文本指令遵循')).toBe(
      '检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行',
    );
  });

  it('definitionFor returns "" for an unknown/incomplete path', () => {
    expect(definitionFor('单镜头', '提示词遵循/参考绑定', '不存在的叶子')).toBe('');
    expect(definitionFor('不存在', '', '')).toBe('');
    expect(definitionFor('单镜头', '', '')).toBe('');
  });

  it('leafByPath resolves a known leaf and rejects an unknown one', () => {
    expect(leafByPath('长镜头', '综合应用题', '短剧')?.code).toBe('3.1.1');
    expect(leafByPath('长镜头', '综合应用题', '不存在')).toBeUndefined();
  });

  it('resolves merged leaves and rejects removed labels', () => {
    expect(leafByPath('单镜头', '场景与空间', '人物场景融合和交互')?.code).toBe('1.3.3');
    expect(leafByPath('单镜头', '场景与空间', '人物场景融合、交互')).toBeUndefined();
    expect(leafByPath('单镜头', '场景与空间', '场景可行动性')).toBeUndefined();

    expect(leafByPath('单镜头', '表演与动作', '动作执行')?.code).toBe('1.4.1');
    expect(leafByPath('单镜头', '表演与动作', '简单动作执行')).toBeUndefined();
    expect(leafByPath('单镜头', '表演与动作', '复杂动作执行')).toBeUndefined();
    expect(leafByPath('单镜头', '表演与动作', '物理反馈、受力')).toBeUndefined();
  });

  it('keeps only the merged 1.5 scheduling leaves with contiguous codes', () => {
    const scheduling = CATEGORY_TREE.find((n) => n.value === '单镜头')?.children?.find(
      (n) => n.value === '调度与场面组织',
    );
    expect(scheduling?.children?.map((n) => [n.code, n.value])).toEqual([
      ['1.5.1', '人物站位合理性'],
      ['1.5.2', '人物距离与互动空间'],
      ['1.5.3', '出入画与运动动线'],
    ]);

    expect(leafByPath('单镜头', '调度与场面组织', '视线组织')).toBeUndefined();
    expect(leafByPath('单镜头', '调度与场面组织', '主次关系与画面重心')).toBeUndefined();
    expect(leafByPath('单镜头', '调度与场面组织', '多人物场面组织')).toBeUndefined();
  });

  it('labelsForPath returns code-prefixed labels for a full path', () => {
    expect(labelsForPath('单镜头', '提示词遵循/参考绑定', '核心文本指令遵循')).toEqual([
      '1 单镜头',
      '1.1 提示词遵循/参考绑定',
      '1.1.1 核心文本指令遵循',
    ]);
    expect(labelsForPath('单镜头', '提示词遵循/参考绑定', '不存在')).toBeUndefined();
  });
});
