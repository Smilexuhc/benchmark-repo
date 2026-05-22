"""SQLite 连接与建表。单文件数据库，随项目目录走。"""
import os
import sqlite3
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.getenv("BENCHMARK_ASSET_DATA_DIR", os.path.join(BASE_DIR, "data"))
DB_PATH = os.path.join(DATA_DIR, "app.db")
IMAGES_DIR = os.path.join(DATA_DIR, "images")

# 角色的结构化字段（与 CSV 列、前端筛选一一对应）
CHARACTER_FIELDS = [
    "era",       # 时代
    "type",      # 类型
    "gender",    # 性别
    "age",       # 年龄段
    "persona",   # 人设（服装造型风格）
    "body",      # 身材
    "features",  # 特征
    "genre",     # 常见题材
    "prompt",    # 人物生成提示词
    "description",  # 自由描述（给 AI 写提示词用）
]

# 可作为筛选维度的字段
FILTER_FIELDS = ["era", "type", "gender", "age", "genre"]

# 场景的结构化字段
SCENE_FIELDS = [
    "name",        # 场景名称
    "era",         # 时代
    "scene_type",  # 场景类型（室内/室外）
    "genre",       # 题材风格
    "mood",        # 氛围时段
    "elements",    # 关键元素
    "prompt",      # 场景生成提示词
    "description", # 自由描述
]

# 场景可筛选维度
SCENE_FILTER_FIELDS = ["era", "scene_type", "genre", "mood"]

# 列表中题材的排序：现代 -> 古代 -> 玄幻 -> 科幻/未来
GENRE_ORDER = [
    "现代-职场", "现代-校园", "现代-都市", "军事战争",
    "中国古代", "欧洲中世纪", "近代/民国",
    "中国玄幻", "西方玄幻",
    "科幻-星际", "科幻-赛博朋克", "末世废土",
]


def genre_rank(genre: str) -> int:
    """题材在列表中的排序权重；未知题材排最后。"""
    try:
        return GENRE_ORDER.index(genre or "")
    except ValueError:
        return len(GENRE_ORDER)


# 类型筛选展示顺序：人类 -> 动物 -> 非人
TYPE_ORDER = [
    "亚洲人", "欧洲人", "非洲人", "拉美人", "混血",
    "动物/宠物", "动物拟人",
    "机器人", "神话生物",
]

# 年龄段筛选展示顺序：从小到老
AGE_ORDER = ["婴儿", "儿童", "青少年", "青年", "成年", "中年", "老年", "N/A"]

# 各筛选字段的展示顺序（未列出的值排末尾）
_FIELD_ORDER = {"type": TYPE_ORDER, "genre": GENRE_ORDER, "age": AGE_ORDER}


def order_filter_values(field: str, values: list) -> list:
    """把筛选选项按预定义顺序排列；无预定义顺序则按字面排序。"""
    order = _FIELD_ORDER.get(field)
    if not order:
        return sorted(values)
    rank = {v: i for i, v in enumerate(order)}
    return sorted(values, key=lambda v: (rank.get(v, len(order)), v))


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def get_conn() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            era TEXT DEFAULT '',
            type TEXT DEFAULT '',
            gender TEXT DEFAULT '',
            age TEXT DEFAULT '',
            persona TEXT DEFAULT '',
            body TEXT DEFAULT '',
            features TEXT DEFAULT '',
            genre TEXT DEFAULT '',
            prompt TEXT DEFAULT '',
            description TEXT DEFAULT '',
            cover_image_id INTEGER,
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            character_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            source TEXT DEFAULT 'generated',
            created_at TEXT,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS scenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT DEFAULT '',
            era TEXT DEFAULT '',
            scene_type TEXT DEFAULT '',
            genre TEXT DEFAULT '',
            mood TEXT DEFAULT '',
            elements TEXT DEFAULT '',
            prompt TEXT DEFAULT '',
            description TEXT DEFAULT '',
            cover_image_id INTEGER,
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS scene_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            source TEXT DEFAULT 'generated',
            created_at TEXT,
            FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()
    conn.close()
