-- Add nullable first so existing rows aren't forced to the DEFAULT yet.
ALTER TABLE "lessons" ADD COLUMN "position" INTEGER;

-- Deterministic backfill: creation order (createdAt, then id) per course,
-- 1-based — mirrors the existing findAllForCourse ordering so the
-- migration doesn't change how anything already-published lists today.
UPDATE "lessons" AS l
SET "position" = ranked.rn
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "courseId"
           ORDER BY "createdAt" ASC, "id" ASC
         ) AS rn
  FROM "lessons"
) AS ranked
WHERE l."id" = ranked."id";

-- Now enforce NOT NULL + the default for future rows inserted without an
-- explicit position (e.g. raw prisma.lesson.create in tests/seeds).
ALTER TABLE "lessons" ALTER COLUMN "position" SET NOT NULL;
ALTER TABLE "lessons" ALTER COLUMN "position" SET DEFAULT 0;
