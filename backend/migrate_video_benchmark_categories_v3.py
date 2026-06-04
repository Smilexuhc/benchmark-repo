"""Map legacy benchmark question categories to V3 categories.

Default mode is a dry run. Use --apply to write category_l1/category_l2/
category_l3/category_definition. Legacy shot_type/task_type/question_type and
manual_tag are never modified.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass


@dataclass(frozen=True)
class Category:
    code: str
    l1: str
    l2: str
    l3: str
    definition: str

    @property
    def path(self) -> str:
        return f"{self.code} {self.l1} / {self.l2} / {self.l3}"


def cat(code: str, l1: str, l2: str, l3: str, definition: str) -> Category:
    return Category(code, l1, l2, l3, definition)


CATEGORIES: dict[str, Category] = {
    "1.1.1": cat("1.1.1", "单镜头", "提示词遵循/参考绑定", "核心文本指令遵循", "检查文本指令中的主体、动作、场景、情绪和基础要求是否被正确执行"),
    "1.1.3": cat("1.1.3", "单镜头", "提示词遵循/参考绑定", "声音与音色参考遵循", "检查声音、音色、说话人、配乐或音效参考是否按要求正确使用"),
    "1.1.6": cat("1.1.6", "单镜头", "提示词遵循/参考绑定", "否定约束遵循", "检查不要字幕、不要说话、不要音乐、不要继承背景等禁止项是否被避开"),
    "1.1.7": cat("1.1.7", "单镜头", "提示词遵循/参考绑定", "多条件约束遵循", "检查多个主体、动作、风格、空间、声音和输出格式是否能同时满足"),
    "1.1.8": cat("1.1.8", "单镜头", "提示词遵循/参考绑定", "影视专业术语遵循", "检查 OTS、POV、OS、VO、低角度、浅景深等影视术语是否被正确执行"),
    "1.2.1": cat("1.2.1", "单镜头", "人物与角色", "人脸与身份稳定性", "检查主体在运动和表演过程中是否保持同一身份、五官和年龄感"),
    "1.2.2": cat("1.2.2", "单镜头", "人物与角色", "多族裔主体一致性", "检查人物体型、年龄感、肤色和身体比例是否可信稳定"),
    "1.2.3": cat("1.2.3", "单镜头", "人物与角色", "服饰、发型、配饰稳定性", "检查角色外观细节在单镜头内是否稳定、不漂移、不变形"),
    "1.2.4": cat("1.2.4", "单镜头", "人物与角色", "角色状态呈现", "检查疲惫、受伤、脏污、身份状态或职业状态是否明确可信"),
    "1.2.5": cat("1.2.5", "单镜头", "人物与角色", "动物与非人主体真实感", "检查动物、机器人或其他非人主体的结构、运动和质感是否可信"),
    "1.2.6": cat("1.2.6", "单镜头", "人物与角色", "多主体一致性", "检查多个角色是否身份清晰、特征不串、不融合、不丢失"),
    "1.3.2": cat("1.3.2", "单镜头", "场景与空间", "空间比例与透视", "检查人物、家具、建筑、道具之间的尺度关系和透视是否可信"),
    "1.3.3": cat("1.3.3", "单镜头", "场景与空间", "人物场景融合和交互", "检查人物与门窗、墙面、家具、桌面、通道等场景元素的融合、遮挡、接触和交互是否真实可信"),
    "1.3.5": cat("1.3.5", "单镜头", "场景与空间", "场景状态变化", "检查场景是否能基于提示词发生真实变化，如开关、破裂、雨水痕迹或整洁度变化"),
    "1.3.6": cat("1.3.6", "单镜头", "场景与空间", "物理与自然现象", "检查雨雪、烟雾、火焰、液体、风等物理或自然现象是否可信"),
    "1.4.1": cat("1.4.1", "单镜头", "表演与动作", "动作执行", "检查走路、转身、坐下、抬手、奔跑、舞蹈、打斗、追逐等动作是否按提示自然、连贯、可信地完成"),
    "1.4.2": cat("1.4.2", "单镜头", "表演与动作", "表情、眼神与情绪表演", "检查面部表情、眼神、微表情和情绪层次是否自然可信"),
    "1.4.4": cat("1.4.4", "单镜头", "表演与动作", "道具参与动作", "检查角色拿取、使用、传递、挥舞或操作道具时动作是否自然可信"),
    "1.5.1": cat("1.5.1", "单镜头", "调度与场面组织", "人物站位合理性", "检查人物在场景中的站位是否合理、清晰、符合关系"),
    "1.5.2": cat("1.5.2", "单镜头", "调度与场面组织", "人物距离与互动空间", "检查聊天、争吵、拥抱、跟随等关系中的人物距离是否合理"),
    "1.5.4": cat("1.5.4", "单镜头", "调度与场面组织", "主次关系与画面重心", "检查画面是否突出主要角色、关键动作或叙事重点"),
    "1.5.5": cat("1.5.5", "单镜头", "调度与场面组织", "出入画与运动动线", "检查角色进出画面和移动路线是否自然、可追踪"),
    "1.5.6": cat("1.5.6", "单镜头", "调度与场面组织", "多人物场面组织", "检查群像、队列、会议、宴会等多主体调度是否清楚不混乱"),
    "1.7.1": cat("1.7.1", "单镜头", "声音与画面关系", "对白", "检查对白内容、说话人归属、口型同步和语气情绪是否成立"),
    "1.7.5": cat("1.7.5", "单镜头", "声音与画面关系", "音乐", "检查配乐风格、进入时机、节奏和情绪功能是否符合画面"),
    "1.7.7": cat("1.7.7", "单镜头", "声音与画面关系", "画外音", "检查旁白、OS、VO、内心独白等画外声音是否归属清楚且不混乱"),
    "1.7.9": cat("1.7.9", "单镜头", "声音与画面关系", "多语种 & 方言 & 跨语种", "检查多语种、方言和跨语种说话关系是否成立"),
    "1.7.10": cat("1.7.10", "单镜头", "声音与画面关系", "语速", "检查说话长度和语速控制是否符合要求"),
    "1.8.5": cat("1.8.5", "单镜头", "画面&特效", "视觉特效与变形", "检查特效、变形、能量、粒子或风格化效果是否可信并融合画面"),
    "2.1.1": cat("2.1.1", "连续镜头", "角色连续性", "角色身份连续", "检查切镜后人脸、五官、年龄感和体态是否保持同一身份"),
    "2.1.3": cat("2.1.3", "连续镜头", "角色连续性", "角色状态连续", "检查伤势、脏污、疲惫、湿身、持物和姿态状态是否延续"),
    "2.1.4": cat("2.1.4", "连续镜头", "角色连续性", "角色情绪连续", "检查愤怒、恐惧、犹豫、悲伤等情绪是否承接上一镜头"),
    "2.3.4": cat("2.3.4", "连续镜头", "人物调度与动作连续性", "多人站位连续", "检查多人之间的相对位置、队形、左右关系和主次关系是否跨镜头保持"),
}


LEGACY_CATEGORY_TO_CODE: dict[str, str] = {
    "主体、动作、场景核心基础测试": "1.1.1",
    "大小比例与透视关系": "1.3.2",
    "人物距离与互动空间": "1.5.2",
    "人物状态延续": "2.1.3",
    "人脸及人物特征连续性": "2.1.1",
    "人物情绪延续性": "2.1.4",
    "人物情绪表达": "1.4.2",
    "表情、眼神与微表情": "1.4.2",
    "语速、语气与情绪表达": "1.7.10",
    "道具使用与物理接触": "1.4.4",
    "动作连续性与姿态稳定": "1.4.1",
    "人物身份与人脸稳定性": "1.2.1",
    "服饰、发型、配饰一致性": "1.2.3",
    "极简提示词理解": "1.1.1",
    "人物体态、年龄、肤色稳定性": "1.2.2",
    "复杂提示词与多条件约束遵循": "1.1.7",
    "抽象语义、情绪描述与隐喻理解": "1.4.2",
    "专业剧本术语与创作指令理解": "1.1.8",
    "动作顺序与因果关系遵循": "1.4.1",
    "否定约束遵循": "1.1.6",
    "多主体复杂稳定性": "1.2.6",
    "复杂动作执行": "1.4.1",
    "受力、碰撞与攻击反馈": "1.4.1",
    "人物站位合理性": "1.5.1",
    "简单动作执行": "1.4.1",
    "人物与场景融合度": "1.3.3",
    "人物与场景交互": "1.3.3",
    "出入画或运动动线": "1.5.5",
    "自然现象与物质模拟": "1.3.6",
    "复杂多人站位": "1.5.6",
    "台词文本遵循": "1.7.1",
    "台词、旁白与内心独白归属": "1.7.7",
    "场景布局合理性": "1.3.3",
    "口型与发声同步": "1.7.1",
    "人物音色与参考音频一致性": "1.1.3",
    "音乐风格与画面匹配": "1.7.5",
    "动物与非人主体真实感": "1.2.5",
    "主次关系与画面重心": "1.5.4",
}


# Item-level overrides are only for legacy buckets that are too broad or where
# the concrete prompt is better represented by a newer orthogonal category.
ITEM_OVERRIDES: dict[int, str] = {
    3: "2.3.4",   # old long-video item is a two-segment standing/path continuity test
    4: "1.2.5",   # user-confirmed: anthropomorphic animal + bun-stepping
    14: "2.1.4",  # user-confirmed temporary continuity placement
    15: "1.7.9",  # western character speaking Chinese: cross-language focus
    25: "1.3.5",  # weather/pedestrian/wetness state changes dominate the mixed behavior test
    44: "1.2.5",  # dog swimming/shaking/chasing: nonhuman movement and physical realism
    45: "1.4.1",  # yoga sequence with ordered full-body movement
    47: "1.8.5",  # 2D-to-real transformation and screen-breaking visual effect
}


def target_for(row: dict) -> Category | None:
    code = ITEM_OVERRIDES.get(row["id"])
    if code is None:
        code = LEGACY_CATEGORY_TO_CODE.get(row.get("question_type") or "")
    return CATEGORIES.get(code) if code else None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write V3 category fields")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="also update rows that already have category_l1/category_l2/category_l3",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    from db import close_pool, get_conn

    updated = 0
    skipped_existing = 0
    unmapped: list[dict] = []

    try:
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, shot_type, question_type, manual_tag,
                       category_l1, category_l2, category_l3
                  FROM video_benchmark_items
                 WHERE deleted_at IS NULL
                 ORDER BY id
                """
            ).fetchall()

            mode = "APPLY" if args.apply else "DRY-RUN"
            print(f"{mode}: {len(rows)} active rows")

            for row in rows:
                has_category = bool(row.get("category_l1") or row.get("category_l2") or row.get("category_l3"))
                if has_category and not args.overwrite:
                    skipped_existing += 1
                    continue

                category = target_for(row)
                if category is None:
                    unmapped.append(row)
                    print(
                        f"UNMAPPED #{row['id']}: "
                        f"{row.get('shot_type') or '-'} / {row.get('question_type') or '-'} / {row.get('manual_tag') or '-'}"
                    )
                    continue

                print(
                    f"#{row['id']}: {row.get('shot_type') or '-'} / {row.get('question_type') or '-'}"
                    f" -> {category.path}"
                )

                if args.apply:
                    conn.execute(
                        """
                        UPDATE video_benchmark_items
                           SET category_l1 = %s,
                               category_l2 = %s,
                               category_l3 = %s,
                               category_definition = %s
                         WHERE id = %s
                           AND deleted_at IS NULL
                        """,
                        (category.l1, category.l2, category.l3, category.definition, row["id"]),
                    )
                    updated += 1

            if args.apply:
                conn.commit()

        print(
            f"Summary: mapped={len(rows) - skipped_existing - len(unmapped)}, "
            f"updated={updated}, skipped_existing={skipped_existing}, unmapped={len(unmapped)}"
        )
    finally:
        close_pool()


if __name__ == "__main__":
    main()
