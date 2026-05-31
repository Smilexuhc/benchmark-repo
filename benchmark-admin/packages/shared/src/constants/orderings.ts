// Ordering constants derived from legacy backend/db.py for consistent list sorting

export const TYPE_ORDER: Record<string, number> = {
  人类: 1,
  动物: 2,
  怪兽: 3,
  拟人: 4,
};

export const GENRE_ORDER: Record<string, number> = {
  古代: 1,
  现代: 2,
  未来: 3,
  奇幻: 4,
  科幻: 5,
};

export const AGE_ORDER: Record<string, number> = {
  老年: 1,
  中年: 2,
  青年: 3,
  少年: 4,
  儿童: 5,
  婴幼儿: 6,
};
