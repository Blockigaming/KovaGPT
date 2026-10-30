-- PostgreSQL 17 target-only metadata census. This does not qualify a target,
-- read table contents, modify objects, or infer that an extension version proves
-- its installed definitions. Bind this complete result and the independent
-- schema/catalog fingerprints to a reviewed, pinned-image baseline.
--
-- Enumerate catalogs directly: an object without a pg_depend row is retained.
-- Only direct EXTENSION membership and recursive INTERNAL dependencies are
-- annotated. AUTO/normal dependencies on an extension table never authorize a
-- custom policy, trigger, constraint, index, or routine.
--
-- Global catalogs include built-in entries as well as user entries. No OID
-- cutoff guesses which global objects are built in. Intrinsic relation fields
-- (including columns/index/partition metadata) are fingerprinted; a custom
-- column on an extension table cannot disappear from the pinned census.
-- Catalog values may contain SQL or connection options. Return their hashes,
-- never their values. All output belongs in the private recovery operator.
WITH RECURSIVE
  user_namespaces AS (
    SELECT n.* FROM pg_catalog.pg_namespace n
    WHERE n.nspname <> 'information_schema'
      AND n.nspname !~ '^pg_'
  ),
  catalog_namespaces AS (SELECT n.* FROM pg_catalog.pg_namespace n),
  extension_addresses(classid,objid,objsubid,extension) AS (
    SELECT d.classid,d.objid,d.objsubid,e.extname::text
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_extension e ON d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.refobjid=e.oid AND d.deptype='e'
    UNION
    SELECT d.classid,d.objid,d.objsubid,a.extension
    FROM pg_catalog.pg_depend d
    JOIN extension_addresses a ON d.refclassid=a.classid
      AND d.refobjid=a.objid AND d.refobjsubid=a.objsubid
    WHERE d.deptype='i'
  ),
  namespace_addresses(catalog,classid,objid,schema,details) AS (
    SELECT 'pg_class','pg_catalog.pg_class'::regclass,c.oid,n.nspname,
      jsonb_build_object(
        'row',to_jsonb(c),
        'columns',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.attnum),'[]'::jsonb)
          FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid),
        'index',(SELECT to_jsonb(i) FROM pg_catalog.pg_index i WHERE i.indexrelid=c.oid),
        'partition',(SELECT to_jsonb(p) FROM pg_catalog.pg_partitioned_table p WHERE p.partrelid=c.oid),
        'sequence',(SELECT to_jsonb(s) FROM pg_catalog.pg_sequence s WHERE s.seqrelid=c.oid))
    FROM pg_catalog.pg_class c JOIN catalog_namespaces n ON n.oid=c.relnamespace
    UNION ALL SELECT 'pg_proc','pg_catalog.pg_proc'::regclass,p.oid,n.nspname,
        jsonb_build_object('row',to_jsonb(p),'aggregate',(SELECT to_jsonb(a) FROM pg_catalog.pg_aggregate a WHERE a.aggfnoid=p.oid))
      FROM pg_catalog.pg_proc p JOIN catalog_namespaces n ON n.oid=p.pronamespace
    UNION ALL SELECT 'pg_type','pg_catalog.pg_type'::regclass,t.oid,n.nspname,
        jsonb_build_object('row',to_jsonb(t),'range',(SELECT to_jsonb(r) FROM pg_catalog.pg_range r WHERE r.rngtypid=t.oid),
          'enum',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.enumsortorder),'[]'::jsonb) FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid))
      FROM pg_catalog.pg_type t JOIN catalog_namespaces n ON n.oid=t.typnamespace
    UNION ALL SELECT 'pg_constraint','pg_catalog.pg_constraint'::regclass,c.oid,n.nspname,to_jsonb(c)
      FROM pg_catalog.pg_constraint c JOIN catalog_namespaces n ON n.oid=c.connamespace
    UNION ALL SELECT 'pg_trigger','pg_catalog.pg_trigger'::regclass,t.oid,n.nspname,to_jsonb(t)
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN catalog_namespaces n ON n.oid=c.relnamespace
    UNION ALL SELECT 'pg_policy','pg_catalog.pg_policy'::regclass,p.oid,n.nspname,to_jsonb(p)
      FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN catalog_namespaces n ON n.oid=c.relnamespace
    UNION ALL SELECT 'pg_rewrite','pg_catalog.pg_rewrite'::regclass,r.oid,n.nspname,to_jsonb(r)
      FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN catalog_namespaces n ON n.oid=c.relnamespace
    UNION ALL SELECT 'pg_attrdef','pg_catalog.pg_attrdef'::regclass,a.oid,n.nspname,to_jsonb(a)
      FROM pg_catalog.pg_attrdef a JOIN pg_catalog.pg_class c ON c.oid=a.adrelid JOIN catalog_namespaces n ON n.oid=c.relnamespace
    UNION ALL SELECT 'pg_collation','pg_catalog.pg_collation'::regclass,c.oid,n.nspname,to_jsonb(c)
      FROM pg_catalog.pg_collation c JOIN catalog_namespaces n ON n.oid=c.collnamespace
    UNION ALL SELECT 'pg_conversion','pg_catalog.pg_conversion'::regclass,c.oid,n.nspname,to_jsonb(c)
      FROM pg_catalog.pg_conversion c JOIN catalog_namespaces n ON n.oid=c.connamespace
    UNION ALL SELECT 'pg_operator','pg_catalog.pg_operator'::regclass,o.oid,n.nspname,to_jsonb(o)
      FROM pg_catalog.pg_operator o JOIN catalog_namespaces n ON n.oid=o.oprnamespace
    UNION ALL SELECT 'pg_opclass','pg_catalog.pg_opclass'::regclass,o.oid,n.nspname,to_jsonb(o)
      FROM pg_catalog.pg_opclass o JOIN catalog_namespaces n ON n.oid=o.opcnamespace
    UNION ALL SELECT 'pg_opfamily','pg_catalog.pg_opfamily'::regclass,o.oid,n.nspname,to_jsonb(o)
      FROM pg_catalog.pg_opfamily o JOIN catalog_namespaces n ON n.oid=o.opfnamespace
    UNION ALL SELECT 'pg_ts_config','pg_catalog.pg_ts_config'::regclass,t.oid,n.nspname,
        jsonb_build_object('row',to_jsonb(t),'mappings',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.maptokentype,m.mapseqno),'[]'::jsonb) FROM pg_catalog.pg_ts_config_map m WHERE m.mapcfg=t.oid))
      FROM pg_catalog.pg_ts_config t JOIN catalog_namespaces n ON n.oid=t.cfgnamespace
    UNION ALL SELECT 'pg_ts_dict','pg_catalog.pg_ts_dict'::regclass,t.oid,n.nspname,to_jsonb(t)
      FROM pg_catalog.pg_ts_dict t JOIN catalog_namespaces n ON n.oid=t.dictnamespace
    UNION ALL SELECT 'pg_ts_parser','pg_catalog.pg_ts_parser'::regclass,t.oid,n.nspname,to_jsonb(t)
      FROM pg_catalog.pg_ts_parser t JOIN catalog_namespaces n ON n.oid=t.prsnamespace
    UNION ALL SELECT 'pg_ts_template','pg_catalog.pg_ts_template'::regclass,t.oid,n.nspname,to_jsonb(t)
      FROM pg_catalog.pg_ts_template t JOIN catalog_namespaces n ON n.oid=t.tmplnamespace
    UNION ALL SELECT 'pg_statistic_ext','pg_catalog.pg_statistic_ext'::regclass,s.oid,n.nspname,to_jsonb(s)
      FROM pg_catalog.pg_statistic_ext s JOIN catalog_namespaces n ON n.oid=s.stxnamespace
  ),
  global_addresses(catalog,classid,objid,details) AS (
    SELECT 'pg_event_trigger','pg_catalog.pg_event_trigger'::regclass,e.oid,to_jsonb(e) FROM pg_catalog.pg_event_trigger e
    UNION ALL SELECT 'pg_publication','pg_catalog.pg_publication'::regclass,p.oid,to_jsonb(p) FROM pg_catalog.pg_publication p
    UNION ALL SELECT 'pg_subscription','pg_catalog.pg_subscription'::regclass,s.oid,to_jsonb(s) FROM pg_catalog.pg_subscription s
    UNION ALL SELECT 'pg_foreign_data_wrapper','pg_catalog.pg_foreign_data_wrapper'::regclass,f.oid,to_jsonb(f) FROM pg_catalog.pg_foreign_data_wrapper f
    UNION ALL SELECT 'pg_foreign_server','pg_catalog.pg_foreign_server'::regclass,s.oid,to_jsonb(s) FROM pg_catalog.pg_foreign_server s
    UNION ALL SELECT 'pg_user_mapping','pg_catalog.pg_user_mapping'::regclass,u.oid,to_jsonb(u) FROM pg_catalog.pg_user_mapping u
    UNION ALL SELECT 'pg_default_acl','pg_catalog.pg_default_acl'::regclass,d.oid,to_jsonb(d) FROM pg_catalog.pg_default_acl d
    UNION ALL SELECT 'pg_parameter_acl','pg_catalog.pg_parameter_acl'::regclass,p.oid,to_jsonb(p) FROM pg_catalog.pg_parameter_acl p
    UNION ALL SELECT 'pg_cast','pg_catalog.pg_cast'::regclass,c.oid,to_jsonb(c) FROM pg_catalog.pg_cast c
    UNION ALL SELECT 'pg_transform','pg_catalog.pg_transform'::regclass,t.oid,to_jsonb(t) FROM pg_catalog.pg_transform t
    UNION ALL SELECT 'pg_language','pg_catalog.pg_language'::regclass,l.oid,to_jsonb(l) FROM pg_catalog.pg_language l
    UNION ALL SELECT 'pg_am','pg_catalog.pg_am'::regclass,a.oid,to_jsonb(a) FROM pg_catalog.pg_am a
    UNION ALL SELECT 'pg_database','pg_catalog.pg_database'::regclass,d.oid,to_jsonb(d) FROM pg_catalog.pg_database d
    UNION ALL SELECT 'pg_tablespace','pg_catalog.pg_tablespace'::regclass,t.oid,to_jsonb(t) FROM pg_catalog.pg_tablespace t
  ),
  addresses AS (
    SELECT CASE WHEN schema <> 'information_schema' AND schema !~ '^pg_'
      THEN 'namespace' ELSE 'system' END AS scope,catalog,classid,objid,schema::text,details FROM namespace_addresses
    UNION ALL SELECT 'global',catalog,classid,objid,NULL::text,details FROM global_addresses
  ),
  classified AS (
    SELECT a.scope,a.catalog,a.schema,
      (pg_catalog.pg_identify_object(a.classid,a.objid,0)).identity AS identity,
      (SELECT e.extname FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
        WHERE d.classid=a.classid AND d.objid=a.objid AND d.objsubid=0
          AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e') AS "directExtension",
      (SELECT min(e.extension) FROM extension_addresses e
        WHERE e.classid=a.classid AND e.objid=a.objid AND e.objsubid=0) AS "internalExtension",
      jsonb_build_object('catalogRowSha256',encode(sha256(convert_to(a.details::text,'UTF8')),'hex')) AS details
    FROM addresses a
  ),
  table_list AS (
    SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,
      (SELECT e.extname FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.objsubid=0
          AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e') AS "directExtension",
      (SELECT min(e.extension) FROM extension_addresses e
        WHERE e.classid='pg_catalog.pg_class'::regclass AND e.objid=c.oid AND e.objsubid=0) AS "internalExtension"
    FROM pg_catalog.pg_class c JOIN user_namespaces n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p','m','f')
  )
SELECT jsonb_build_object(
  'format',1,
  'serverVersionNum',current_setting('server_version_num')::integer,
  'namespaces',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',n.nspacl,'comment',obj_description(n.oid,'pg_namespace')) ORDER BY n.nspname),'[]'::jsonb) FROM user_namespaces n),
  'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname),'[]'::jsonb) FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace),
  'namespaceObjects',(SELECT coalesce(jsonb_agg(to_jsonb(c)-'scope' ORDER BY c.schema,c.catalog,c.identity),'[]'::jsonb) FROM classified c WHERE c.scope='namespace'),
  'globalObjects',(SELECT coalesce(jsonb_agg(to_jsonb(c)-'scope'-'schema' ORDER BY c.catalog,c.identity),'[]'::jsonb) FROM classified c WHERE c.scope='global'),
  'tables',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.schema,t.name),'[]'::jsonb) FROM table_list t),
  'counts',jsonb_build_object(
    'namespaceObjects',(SELECT count(*) FROM classified WHERE scope='namespace'),
    'nonExtensionNamespaceObjects',(SELECT count(*) FROM classified WHERE scope='namespace' AND "directExtension" IS NULL),
    'unownedNamespaceObjects',(SELECT count(*) FROM classified WHERE scope='namespace' AND "directExtension" IS NULL AND "internalExtension" IS NULL),
    'globalObjects',(SELECT count(*) FROM classified WHERE scope='global'),
    'tables',(SELECT count(*) FROM table_list),
    'nonExtensionTables',(SELECT count(*) FROM table_list WHERE "directExtension" IS NULL AND "internalExtension" IS NULL)),
  'structuralCatalogs',jsonb_build_object(
    'systemNamespaceObjectsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.schema,c.catalog,c.identity),'[]'::jsonb)::text,'UTF8')),'hex') FROM classified c WHERE c.scope='system'),
    'inheritanceSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.inhrelid,i.inhseqno),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_inherits i),
    'publicationRelationsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_publication_rel p),
    'publicationNamespacesSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_publication_namespace p),
    'foreignTablesSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.ftrelid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_foreign_table f),
    'operatorFamilyOperatorsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.oid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_amop a),
    'operatorFamilyProceduresSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.oid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_amproc a),
    'objectDescriptionsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.classoid,d.objoid,d.objsubid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_description d),
    'sharedObjectDescriptionsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.classoid,d.objoid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_shdescription d),
    'securityLabelsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.classoid,s.objoid,s.objsubid,s.provider),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_seclabel s),
    'sharedSecurityLabelsSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.classoid,s.objoid,s.provider),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_shseclabel s),
    'initialPrivilegesSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.classoid,i.objoid,i.objsubid),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_init_privs i),
    'dependenciesSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_depend d),
    'sharedDependenciesSha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.dbid,d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.deptype),'[]'::jsonb)::text,'UTF8')),'hex') FROM pg_catalog.pg_shdepend d)),
  'completeness',jsonb_build_object('explicitPg17CatalogEnumeration',true,'extensionMembershipAloneQualified',false,'tableDataChecked',false)
)::text;
