-- Contract B migration: tiktok_post.created_at => TIMESTAMPTZ (UTC canonical)
-- Safe strategy:
-- 1) Add shadow column created_at_tz
-- 2) Backfill from old UTC-naive timestamp
-- 3) Verify epoch parity
-- 4) Swap columns while retaining backup created_at_utc_naive_backup

DO $$
DECLARE
  current_type TEXT;
  mismatch_count BIGINT;
BEGIN
  SELECT data_type
    INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'tiktok_post'
    AND column_name = 'created_at';

  IF current_type IS NULL THEN
    RAISE EXCEPTION 'Column public.tiktok_post.created_at not found';
  END IF;

  IF current_type = 'timestamp with time zone' THEN
    RAISE NOTICE 'public.tiktok_post.created_at already TIMESTAMPTZ. Migration skipped.';
    RETURN;
  END IF;

  IF current_type <> 'timestamp without time zone' THEN
    RAISE EXCEPTION 'Unsupported created_at type: %', current_type;
  END IF;

  ALTER TABLE public.tiktok_post
    ADD COLUMN IF NOT EXISTS created_at_tz TIMESTAMPTZ;

  UPDATE public.tiktok_post
  SET created_at_tz = created_at AT TIME ZONE 'UTC'
  WHERE created_at IS NOT NULL
    AND created_at_tz IS NULL;

  SELECT COUNT(*)
    INTO mismatch_count
  FROM public.tiktok_post
  WHERE created_at IS NOT NULL
    AND created_at_tz IS NOT NULL
    AND EXTRACT(EPOCH FROM created_at_tz) <> EXTRACT(EPOCH FROM (created_at AT TIME ZONE 'UTC'));

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'Backfill verification failed. Mismatch rows: %', mismatch_count;
  END IF;

  ALTER TABLE public.tiktok_post
    ALTER COLUMN created_at_tz SET DEFAULT NOW();

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tiktok_post'
      AND column_name = 'created_at_utc_naive_backup'
  ) THEN
    ALTER TABLE public.tiktok_post DROP COLUMN created_at_utc_naive_backup;
  END IF;

  ALTER TABLE public.tiktok_post RENAME COLUMN created_at TO created_at_utc_naive_backup;
  ALTER TABLE public.tiktok_post RENAME COLUMN created_at_tz TO created_at;

  ALTER TABLE public.tiktok_post
    ALTER COLUMN created_at SET DEFAULT NOW();
END $$;

-- Post-migration checks (run manually and archive output):
-- SELECT pg_typeof(created_at) AS created_at_type FROM public.tiktok_post LIMIT 1;
-- SELECT COUNT(*) AS null_created_at FROM public.tiktok_post WHERE created_at IS NULL;
-- SELECT COUNT(*) AS shifted_rows
-- FROM public.tiktok_post
-- WHERE created_at_utc_naive_backup IS NOT NULL
--   AND EXTRACT(EPOCH FROM created_at) <> EXTRACT(EPOCH FROM (created_at_utc_naive_backup AT TIME ZONE 'UTC'));
