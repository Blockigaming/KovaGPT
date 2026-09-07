-- These indexes are exact duplicates of older canonical indexes. The guards
-- fail closed if a same-named index ever differs, so this migration cannot
-- silently drop a constraint-backed or differently shaped index.
DO $migration$
BEGIN
  IF to_regclass('public.daily_usage_user_date_uidx') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index duplicate_index
      JOIN pg_index canonical_index
        ON canonical_index.indexrelid = to_regclass('public.daily_usage_pkey')
      WHERE duplicate_index.indexrelid = to_regclass('public.daily_usage_user_date_uidx')
        AND duplicate_index.indrelid = canonical_index.indrelid
        AND duplicate_index.indisunique = canonical_index.indisunique
        AND NOT duplicate_index.indisprimary
        AND duplicate_index.indisvalid
        AND canonical_index.indisvalid
        AND duplicate_index.indkey = canonical_index.indkey
        AND duplicate_index.indcollation = canonical_index.indcollation
        AND duplicate_index.indclass = canonical_index.indclass
        AND duplicate_index.indoption = canonical_index.indoption
        AND duplicate_index.indpred IS NULL
        AND canonical_index.indpred IS NULL
        AND duplicate_index.indexprs IS NULL
        AND canonical_index.indexprs IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conindid = duplicate_index.indexrelid
        )
    ) THEN
      RAISE EXCEPTION 'daily_usage_user_date_uidx is not the expected duplicate';
    END IF;
    EXECUTE 'DROP INDEX public.daily_usage_user_date_uidx';
  END IF;

  IF to_regclass('public.idx_user_library_items_user_created') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index duplicate_index
      JOIN pg_index canonical_index
        ON canonical_index.indexrelid = to_regclass('public.user_library_items_user_id_created_idx')
      WHERE duplicate_index.indexrelid = to_regclass('public.idx_user_library_items_user_created')
        AND duplicate_index.indrelid = canonical_index.indrelid
        AND duplicate_index.indisunique = canonical_index.indisunique
        AND NOT duplicate_index.indisprimary
        AND duplicate_index.indisvalid
        AND canonical_index.indisvalid
        AND duplicate_index.indkey = canonical_index.indkey
        AND duplicate_index.indcollation = canonical_index.indcollation
        AND duplicate_index.indclass = canonical_index.indclass
        AND duplicate_index.indoption = canonical_index.indoption
        AND duplicate_index.indpred IS NULL
        AND canonical_index.indpred IS NULL
        AND duplicate_index.indexprs IS NULL
        AND canonical_index.indexprs IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conindid = duplicate_index.indexrelid
        )
    ) THEN
      RAISE EXCEPTION 'idx_user_library_items_user_created is not the expected duplicate';
    END IF;
    EXECUTE 'DROP INDEX public.idx_user_library_items_user_created';
  END IF;

  IF to_regclass('public.writing_document_versions_doc_idx') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index duplicate_index
      JOIN pg_index canonical_index
        ON canonical_index.indexrelid = to_regclass('public.writing_versions_document_latest_idx')
      WHERE duplicate_index.indexrelid = to_regclass('public.writing_document_versions_doc_idx')
        AND duplicate_index.indrelid = canonical_index.indrelid
        AND duplicate_index.indisunique = canonical_index.indisunique
        AND NOT duplicate_index.indisprimary
        AND duplicate_index.indisvalid
        AND canonical_index.indisvalid
        AND duplicate_index.indkey = canonical_index.indkey
        AND duplicate_index.indcollation = canonical_index.indcollation
        AND duplicate_index.indclass = canonical_index.indclass
        AND duplicate_index.indoption = canonical_index.indoption
        AND duplicate_index.indpred IS NULL
        AND canonical_index.indpred IS NULL
        AND duplicate_index.indexprs IS NULL
        AND canonical_index.indexprs IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conindid = duplicate_index.indexrelid
        )
    ) THEN
      RAISE EXCEPTION 'writing_document_versions_doc_idx is not the expected duplicate';
    END IF;
    EXECUTE 'DROP INDEX public.writing_document_versions_doc_idx';
  END IF;
END
$migration$;
