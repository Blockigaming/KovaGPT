-- Root-reviewed READONLY metadata audit: no bodies, node values, DDL, object
-- names, customer rows, credentials or private field-like strings are returned.
-- Node TAGs are unescaped structural tokens. Field-like tokens are restricted
-- to public PG17.6 header names: this scan is deliberately not claimed to parse
-- fields exactly (a cstring value can itself start with a colon). Unknown keys
-- are counted only. Catalog layout/FK names are PostgreSQL public metadata.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
WITH RECURSIVE
  extension_owned(extension,classid,objid,objsubid) AS (
    SELECT e.extname::text,d.classid,d.objid,d.objsubid
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_extension e ON d.refclassid='pg_catalog.pg_extension'::regclass
      AND d.refobjid=e.oid AND d.deptype='e'
    UNION
    SELECT o.extension,d.classid,d.objid,d.objsubid
    FROM pg_catalog.pg_depend d
    JOIN extension_owned o ON d.refclassid=o.classid AND d.refobjid=o.objid
      AND d.refobjsubid=o.objsubid
    WHERE d.deptype='i'
  ),
  relation_scope(extension,relid) AS (
    SELECT extension,objid FROM extension_owned WHERE classid='pg_catalog.pg_class'::regclass
    UNION
    SELECT o.extension,i.indexrelid FROM extension_owned o
    JOIN pg_catalog.pg_index i ON o.classid='pg_catalog.pg_class'::regclass AND i.indrelid=o.objid
  ),
  -- A new column/default/constraint/index/policy/trigger/rule on a member is a
  -- change to that member's surface, even if it is not itself an extension
  -- member. Ordinary application objects merely depending on members are not
  -- pulled into scope by a blanket reverse normal-dependency traversal.
  associated(extension,classid,objid,objsubid) AS (
    SELECT r.extension,'pg_catalog.pg_class'::regclass,r.relid,a.attnum::integer
      FROM relation_scope r JOIN pg_catalog.pg_attribute a ON a.attrelid=r.relid
      WHERE a.attnum>0 AND NOT a.attisdropped
    UNION SELECT r.extension,'pg_catalog.pg_class'::regclass,r.relid,0 FROM relation_scope r
    UNION SELECT r.extension,'pg_catalog.pg_attrdef'::regclass,a.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_attrdef a ON a.adrelid=r.relid
    UNION SELECT r.extension,'pg_catalog.pg_constraint'::regclass,c.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_constraint c ON c.conrelid=r.relid
    UNION SELECT o.extension,'pg_catalog.pg_constraint'::regclass,c.oid,0
      FROM extension_owned o JOIN pg_catalog.pg_constraint c
        ON o.classid='pg_catalog.pg_type'::regclass AND c.contypid=o.objid
    UNION SELECT r.extension,'pg_catalog.pg_trigger'::regclass,t.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_trigger t ON t.tgrelid=r.relid
    UNION SELECT r.extension,'pg_catalog.pg_policy'::regclass,p.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_policy p ON p.polrelid=r.relid
    UNION SELECT r.extension,'pg_catalog.pg_rewrite'::regclass,w.oid,0
      FROM relation_scope r JOIN pg_catalog.pg_rewrite w ON w.ev_class=r.relid
  ),
  scope AS (SELECT * FROM extension_owned UNION SELECT * FROM associated),
  trees(field,body) AS (
    SELECT 'pg_proc.proargdefaults',p.proargdefaults::text FROM scope s JOIN pg_catalog.pg_proc p ON s.classid='pg_catalog.pg_proc'::regclass AND p.oid=s.objid WHERE p.proargdefaults IS NOT NULL
    UNION ALL SELECT 'pg_proc.prosqlbody',p.prosqlbody::text FROM scope s JOIN pg_catalog.pg_proc p ON s.classid='pg_catalog.pg_proc'::regclass AND p.oid=s.objid WHERE p.prosqlbody IS NOT NULL
    UNION ALL SELECT 'pg_type.typdefaultbin',t.typdefaultbin::text FROM scope s JOIN pg_catalog.pg_type t ON s.classid='pg_catalog.pg_type'::regclass AND t.oid=s.objid WHERE t.typdefaultbin IS NOT NULL
    UNION ALL SELECT 'pg_class.relpartbound',c.relpartbound::text FROM relation_scope r JOIN pg_catalog.pg_class c ON c.oid=r.relid WHERE c.relpartbound IS NOT NULL
    UNION ALL SELECT 'pg_attrdef.adbin',a.adbin::text FROM scope s JOIN pg_catalog.pg_attrdef a ON s.classid='pg_catalog.pg_attrdef'::regclass AND a.oid=s.objid WHERE a.adbin IS NOT NULL
    UNION ALL SELECT 'pg_constraint.conbin',c.conbin::text FROM scope s JOIN pg_catalog.pg_constraint c ON s.classid='pg_catalog.pg_constraint'::regclass AND c.oid=s.objid WHERE c.conbin IS NOT NULL
    UNION ALL SELECT 'pg_policy.polqual',p.polqual::text FROM scope s JOIN pg_catalog.pg_policy p ON s.classid='pg_catalog.pg_policy'::regclass AND p.oid=s.objid WHERE p.polqual IS NOT NULL
    UNION ALL SELECT 'pg_policy.polwithcheck',p.polwithcheck::text FROM scope s JOIN pg_catalog.pg_policy p ON s.classid='pg_catalog.pg_policy'::regclass AND p.oid=s.objid WHERE p.polwithcheck IS NOT NULL
    UNION ALL SELECT 'pg_trigger.tgqual',t.tgqual::text FROM scope s JOIN pg_catalog.pg_trigger t ON s.classid='pg_catalog.pg_trigger'::regclass AND t.oid=s.objid WHERE t.tgqual IS NOT NULL
    UNION ALL SELECT 'pg_rewrite.ev_action',w.ev_action::text FROM scope s JOIN pg_catalog.pg_rewrite w ON s.classid='pg_catalog.pg_rewrite'::regclass AND w.oid=s.objid WHERE w.ev_action IS NOT NULL
    UNION ALL SELECT 'pg_rewrite.ev_qual',w.ev_qual::text FROM scope s JOIN pg_catalog.pg_rewrite w ON s.classid='pg_catalog.pg_rewrite'::regclass AND w.oid=s.objid WHERE w.ev_qual IS NOT NULL
    UNION ALL SELECT 'pg_index.indexprs',i.indexprs::text FROM relation_scope r JOIN pg_catalog.pg_index i ON i.indexrelid=r.relid WHERE i.indexprs IS NOT NULL
    UNION ALL SELECT 'pg_index.indpred',i.indpred::text FROM relation_scope r JOIN pg_catalog.pg_index i ON i.indexrelid=r.relid WHERE i.indpred IS NOT NULL
    UNION ALL SELECT 'pg_partitioned_table.partexprs',p.partexprs::text FROM relation_scope r JOIN pg_catalog.pg_partitioned_table p ON p.partrelid=r.relid WHERE p.partexprs IS NOT NULL
  ),
  public_field_keys AS (SELECT unnest(ARRAY['absent_on_null','accessMethod','access_method','action','actions','agg_distinct','agg_filter','agg_order','agg_star','agg_within_group','aggargtypes','aggcollid','aggdirectargs','aggdistinct','aggfilter','aggfnoid','aggkind','agglevelsup','aggno','aggorder','aggpresorted','aggsplit','aggstar','aggtransno','aggtranstype','aggtype','aggvariadic','alias','aliascolnames','aliases','aliasname','all','amname','amtype','arbiterElems','arbiterWhere','arg','argType','arg_names','argisrow','argnumber','args','args_unspecified','argtypes','arrayBounds','array_collid','array_typeid','atomic','attlist','authrole','base','behavior','boolop','booltesttype','boolval','bound','bsval','btype','canSetTag','cascaded','casecollid','casetype','catalogname','cfgname','chain','checkAsUser','child','class_args','cmd_name','cmds','coalescecollid','coalescetype','coerce','coerceformat','coercion','coercionformat','colCollations','colMax','colMin','colNames','colTypes','colTypmods','colcollations','coldefexpr','coldefexprs','coldeflist','colexpr','colexprs','collClause','collOid','collation','collname','colname','colnames','colno','cols','coltype','coltypes','coltypmods','column_name','columns','colvalexprs','commandType','comment','compression','concurrent','condition','conditionname','conname','conninfo','constbyval','constcollid','constisnull','constlen','constraint','constraintDeps','constraints','constrrel','constructor','consttype','consttypmod','constvalue','content','context','context_item','contype','conversion_name','convertformat','cooked_default','cooked_expr','copiedOrder','cteList','ctecolcollations','ctecolnames','ctecoltypes','ctecoltypmods','ctelevelsup','ctematerialized','ctename','ctequery','cterecursive','cterefcount','ctes','cursor_name','cursor_param','cvarno','cycle_clause','cycle_col_list','cycle_mark_collation','cycle_mark_column','cycle_mark_default','cycle_mark_neop','cycle_mark_type','cycle_mark_typmod','cycle_mark_value','cycle_path_column','database','datatype','dbname','def','defaction','deferrable','deferred','defexpr','definition','defname','defnames','defnamespace','defresult','dictname','dicts','direction','distinctClause','docexpr','domainname','element_typeid','elements','elemexpr','encoding','endInRangeFunc','endOffset','enrname','enrtuples','eqop','eref','errorOnError','event','eventname','events','exclRelIndex','exclRelTlist','excludeOpNames','exclusions','expr','exprs','extname','fdwname','fdwoptions','fieldnum','fieldnums','fields','filename','firstColCollation','firstColType','firstColTypmod','fk_attrs','fk_del_action','fk_del_set_cols','fk_matchtype','fk_upd_action','for_all_tables','for_encoding_name','for_identity','for_ordinality','format','format_type','formatted_expr','frameOptions','fromClause','fromlist','fromsql','func','func_name','func_options','func_variadic','funccall','funccolcollations','funccolcount','funccollid','funccolnames','funccoltypes','funccoltypmods','funcexpr','funcformat','funcid','funcname','funcordinality','funcparams','funcresulttype','funcretset','functions','functype','funcvariadic','fval','generated','generated_when','gid','grant_option','granted_roles','grantee_roles','grantees','grantor','groupClause','groupClauses','groupDistinct','groupingSets','handler_name','hasAggs','hasDistinctOn','hasForUpdate','hasModifyingCTE','hasRecursive','hasRowSecurity','hasSubLinks','hasTargetSRFs','hasWindowFuncs','has_version','hashable','hashfuncid','havingClause','havingQual','howMany','identity','identitySequence','identity_type','idxcomment','idxname','if_not_exists','inFromCl','inRangeAsc','inRangeColl','inRangeNullsFirst','including','indent','indexElems','indexIncludingParams','indexOid','indexParams','indexcolname','indexname','indexspace','indirection','infer','infercollid','inferopclass','inh','inhRelations','inhcount','initdeferred','initially_valid','inout','inputcollid','inputcollids','insertedCols','instead','into','intoClause','isDefault','isDrop','isNatural','isNew','isReset','isReturn','isTable','is_default','is_from','is_from_type','is_grant','is_local','is_no_inherit','is_not_null','is_procedure','is_program','is_rowsfrom','is_select_into','is_slice','is_vacuumcmd','isall','isconstraint','ismove','isnull','item_type','items','itemtype','ival','joinCondition','join_using_alias','joinaliasvars','joinleftcols','joinmergedcols','joinrightcols','jointree','jointype','key','keys','kind','label','lang','langIsTrusted','langOid','larg','largs','lateral','lexpr','lidx','limitCount','limitOffset','limitOption','list_type','listdatums','local_schema','location','lockedRels','lockingClause','lowerdatums','lplan','matchKind','mergeActionList','mergeJoinCondition','mergeTargetRelation','mergeWhenClauses','method','minmaxcollid','minmaxtype','missing_ok','mode','modulus','msfcollid','msftype','multidims','name','name_location','named_args','names','namespaces','ncolumns','negfuncid','newVal','newValIsAfter','newValNeighbor','new_tablespacename','newname','newowner','newrole','newschema','newvals','nnames','node','notnulls','nowait','ns_names','ns_uris','nulls_first','nulls_not_distinct','nulls_ordering','nulltesttype','num','number','objargs','object','objectType','objects','objfuncargs','objname','objtype','ofTypename','oid','oldCreateSubid','oldFirstRelfilelocatorSubid','oldNumber','oldVal','old_conpfeqop','old_pktable_oid','oldstyle','omit_quotes','onCommit','onConflict','onConflictClause','onConflictSet','onConflictWhere','on_empty','on_error','oncommit','op','opclass','opclassname','opclassopts','opcollid','operName','opername','opfamilies','opfamilyname','opfuncid','opno','opnos','opresulttype','opretset','opt','options','orderClause','order_family','ordering','ordinality','ordinalitycol','orig_tablespacename','outargs','output','over','override','owner','ownerId','parParam','parallel_safe','paramIds','paramcollid','parameters','paramid','paramkind','params','paramtype','paramtypmod','partParams','partbound','partitionClause','partspec','passing','passing_names','passing_values','passingvalexprs','path','path_spec','pathspec','payload','pct_type','per_call_cost','perminfoindex','permissive','pk_attrs','pktable','plan','plan_id','plan_name','plhandler','plinline','plname','pltrusted','plvalidator','policy_name','polname','portalname','primary','priv_name','privileges','provider','publication','pubname','pubobjects','pubobjtype','pubtable','pushedDown','qual','quals','query','queryId','querySource','quotes','rarg','rargs','raw_default','raw_expr','rctype','recurse','recursive','refassgnexpr','refcollid','refcontainertype','refelemtype','refexpr','reflowerindexpr','refname','refrestype','refs','reftypmod','refupperindexpr','rel','relabelformat','relation','relationOid','relationType','relations','relid','relkind','rellockmode','relname','relpersistence','rels','remainder','remote_schema','remove','removeType','renameType','repeatable','replace','requiredPerms','reset_default_tblspc','resjunk','resname','resno','resorigcol','resorigtbl','ressortgroupref','restart_seqs','result','resultRelation','resultcollid','resulttype','resulttypmod','returnType','returning','returningList','returnval','rexpr','role','rolename','roles','roletype','row','rowMarks','row_format','row_typeid','rowexpr','rplan','rtable','rtekind','rteperminfos','rti','rtindex','rulename','runCondition','savepoint_name','schemaElts','schemaname','search_breadth_first','search_clause','search_col_list','search_seq_column','securityQuals','security_barrier','selectStmt','selectedCols','self_reference','seqid','sequence','server_name','servername','servertype','setOperations','setParam','setof','setstmt','skipData','skipIfNewValExists','skip_validation','sortClause','sortby_dir','sortby_nulls','sortop','source','sourceRelation','source_text','sourcetype','sql_body','startInRangeFunc','startOffset','startup_cost','stat_types','stmt','stmt_len','stmt_location','stmt_type','storage','storage_name','storedtype','strategy','strength','string','stxcomment','stxstattarget','subLinkId','subLinkType','subname','subplans','subquery','subselect','subtype','sval','table','tableElts','tableSpace','tableSpaceName','table_list','tablefunc','tablesample','tablespacename','target','targetList','targettype','targtype','testexpr','tgenabled','timing','tleSortGroupRef','to_encoding_name','tokentype','tosql','transformed','transitionRels','trigname','tsmhandler','type','typeId','typeMod','typeName','typeOid','type_name','typemod','typevar','typid','typmod','typmods','uidx','unique','unique_keys','unknownEqFalse','updateColnos','updatedCols','upperdatums','useHashTable','useOp','useOr','use_io_coercion','use_json_coercion','user','usingClause','utilityStmt','va_cols','val','vals','value','values','valuesLists','values_lists','varattno','varattnosyn','varcollid','varlevelsup','varno','varnosyn','varnullingrels','vartype','vartypmod','version','view','viewQuery','waitPolicy','wfunc_left','whenClause','whenclause','whereClause','where_clause','winagg','wincollid','windowClause','winfnoid','winref','winstar','wintype','withCheckOption','withCheckOptions','withClause','with_check','wrapper','xmloption','xpr']::text[]) AS key),
  public_node_tags AS (SELECT unnest(ARRAY['ACCESSPRIV','AGGREF','ALIAS','ALTERCOLLATIONSTMT','ALTERDATABASEREFRESHCOLLSTMT','ALTERDATABASESETSTMT','ALTERDATABASESTMT','ALTERDEFAULTPRIVILEGESSTMT','ALTERDOMAINSTMT','ALTERENUMSTMT','ALTEREVENTTRIGSTMT','ALTEREXTENSIONCONTENTSSTMT','ALTEREXTENSIONSTMT','ALTERFDWSTMT','ALTERFOREIGNSERVERSTMT','ALTERFUNCTIONSTMT','ALTERNATIVESUBPLAN','ALTEROBJECTDEPENDSSTMT','ALTEROBJECTSCHEMASTMT','ALTEROPERATORSTMT','ALTEROPFAMILYSTMT','ALTEROWNERSTMT','ALTERPOLICYSTMT','ALTERPUBLICATIONSTMT','ALTERROLESETSTMT','ALTERROLESTMT','ALTERSEQSTMT','ALTERSTATSSTMT','ALTERSUBSCRIPTIONSTMT','ALTERSYSTEMSTMT','ALTERTABLECMD','ALTERTABLEMOVEALLSTMT','ALTERTABLESPACEOPTIONSSTMT','ALTERTABLESTMT','ALTERTSCONFIGURATIONSTMT','ALTERTSDICTIONARYSTMT','ALTERTYPESTMT','ALTERUSERMAPPINGSTMT','ARRAYCOERCEEXPR','ARRAYEXPR','A_ARRAYEXPR','A_CONST','A_EXPR','A_INDICES','A_INDIRECTION','A_STAR','BOOLEANTEST','BOOLEXPR','CALLCONTEXT','CALLSTMT','CASEEXPR','CASETESTEXPR','CASEWHEN','CHECKPOINTSTMT','CLOSEPORTALSTMT','CLUSTERSTMT','COALESCEEXPR','COERCETODOMAIN','COERCETODOMAINVALUE','COERCEVIAIO','COLLATECLAUSE','COLLATEEXPR','COLUMNDEF','COLUMNREF','COMMENTSTMT','COMMONTABLEEXPR','COMPOSITETYPESTMT','CONST','CONSTRAINT','CONSTRAINTSSETSTMT','CONVERTROWTYPEEXPR','COPYSTMT','CREATEAMSTMT','CREATECASTSTMT','CREATECONVERSIONSTMT','CREATEDBSTMT','CREATEDOMAINSTMT','CREATEENUMSTMT','CREATEEVENTTRIGSTMT','CREATEEXTENSIONSTMT','CREATEFDWSTMT','CREATEFOREIGNSERVERSTMT','CREATEFOREIGNTABLESTMT','CREATEFUNCTIONSTMT','CREATEOPCLASSITEM','CREATEOPCLASSSTMT','CREATEOPFAMILYSTMT','CREATEPLANGSTMT','CREATEPOLICYSTMT','CREATEPUBLICATIONSTMT','CREATERANGESTMT','CREATEROLESTMT','CREATESCHEMASTMT','CREATESEQSTMT','CREATESTATSSTMT','CREATESTMT','CREATESUBSCRIPTIONSTMT','CREATETABLEASSTMT','CREATETABLESPACESTMT','CREATETRANSFORMSTMT','CREATETRIGSTMT','CREATEUSERMAPPINGSTMT','CTECYCLECLAUSE','CTESEARCHCLAUSE','CURRENTOFEXPR','DEALLOCATESTMT','DECLARECURSORSTMT','DEFELEM','DEFINESTMT','DELETESTMT','DISCARDSTMT','DOSTMT','DROPDBSTMT','DROPOWNEDSTMT','DROPROLESTMT','DROPSTMT','DROPSUBSCRIPTIONSTMT','DROPTABLESPACESTMT','DROPUSERMAPPINGSTMT','EXECUTESTMT','EXPLAINSTMT','EXPR','FETCHSTMT','FIELDSELECT','FIELDSTORE','FROMEXPR','FUNCCALL','FUNCEXPR','FUNCTIONPARAMETER','GRANTROLESTMT','GRANTSTMT','GROUPINGFUNC','GROUPINGSET','IMPORTFOREIGNSCHEMASTMT','INDEXELEM','INDEXSTMT','INFERCLAUSE','INFERENCEELEM','INLINECODEBLOCK','INSERTSTMT','INTOCLAUSE','JOINEXPR','JSONAGGCONSTRUCTOR','JSONARGUMENT','JSONARRAYAGG','JSONARRAYCONSTRUCTOR','JSONARRAYQUERYCONSTRUCTOR','JSONBEHAVIOR','JSONCONSTRUCTOREXPR','JSONEXPR','JSONFORMAT','JSONFUNCEXPR','JSONISPREDICATE','JSONKEYVALUE','JSONOBJECTAGG','JSONOBJECTCONSTRUCTOR','JSONOUTPUT','JSONPARSEEXPR','JSONRETURNING','JSONSCALAREXPR','JSONSERIALIZEEXPR','JSONTABLE','JSONTABLECOLUMN','JSONTABLEPATH','JSONTABLEPATHSCAN','JSONTABLEPATHSPEC','JSONTABLEPLAN','JSONTABLESIBLINGJOIN','JSONVALUEEXPR','LISTENSTMT','LOADSTMT','LOCKINGCLAUSE','LOCKSTMT','MERGEACTION','MERGESTMT','MERGESUPPORTFUNC','MERGEWHENCLAUSE','MINMAXEXPR','MULTIASSIGNREF','NAMEDARGEXPR','NEXTVALUEEXPR','NOTIFYSTMT','NULLTEST','OBJECTWITHARGS','ONCONFLICTCLAUSE','ONCONFLICTEXPR','OPEXPR','PARAM','PARAMREF','PARTITIONCMD','PARTITIONELEM','PARTITIONRANGEDATUM','PARTITIONSPEC','PLASSIGNSTMT','PREPARESTMT','PUBLICATIONOBJSPEC','PUBLICATIONTABLE','QUERY','RANGEFUNCTION','RANGESUBSELECT','RANGETABLEFUNC','RANGETABLEFUNCCOL','RANGETABLESAMPLE','RANGETBLENTRY','RANGETBLFUNCTION','RANGETBLREF','RANGEVAR','RAWSTMT','REASSIGNOWNEDSTMT','REFRESHMATVIEWSTMT','REINDEXSTMT','RELABELTYPE','RENAMESTMT','REPLICAIDENTITYSTMT','RESTARGET','RETURNSTMT','ROLESPEC','ROWCOMPAREEXPR','ROWEXPR','ROWMARKCLAUSE','RTEPERMISSIONINFO','RULESTMT','SCALARARRAYOPEXPR','SECLABELSTMT','SELECTSTMT','SETOPERATIONSTMT','SETTODEFAULT','SINGLEPARTITIONSPEC','SORTBY','SORTGROUPCLAUSE','SQLVALUEFUNCTION','STATSELEM','SUBLINK','SUBPLAN','SUBSCRIPTINGREF','TABLEFUNC','TABLELIKECLAUSE','TABLESAMPLECLAUSE','TARGETENTRY','TRANSACTIONSTMT','TRIGGERTRANSITION','TRUNCATESTMT','TYPECAST','TYPENAME','UNLISTENSTMT','UPDATESTMT','VACUUMRELATION','VACUUMSTMT','VAR','VARIABLESETSTMT','VARIABLESHOWSTMT','VIEWSTMT','WINDOWCLAUSE','WINDOWDEF','WINDOWFUNC','WINDOWFUNCRUNCONDITION','WITHCHECKOPTION','WITHCLAUSE','XMLEXPR','XMLSERIALIZE']::text[]) AS tag),
  node_tags AS (
    SELECT t.field,m[1] AS tag,count(*) AS count FROM trees t,
      LATERAL regexp_matches(t.body,'(?:^|[^\\])\{([A-Z][A-Z0-9_]*)','g') m
    GROUP BY t.field,m[1]
  ),
  field_tokens AS (
    SELECT t.field,m[1] AS key,count(*) AS count FROM trees t,
      LATERAL regexp_matches(t.body,'(?:^|[[:space:]]):([A-Za-z][A-Za-z0-9_]*)[[:space:]]','g') m
    GROUP BY t.field,m[1]
  ),
  catalogs AS (
    SELECT DISTINCT classid AS oid FROM scope
    UNION SELECT unnest(ARRAY['pg_catalog.pg_attribute'::regclass,'pg_catalog.pg_index'::regclass,
      'pg_catalog.pg_aggregate'::regclass,'pg_catalog.pg_enum'::regclass,'pg_catalog.pg_range'::regclass,
      'pg_catalog.pg_sequence'::regclass,'pg_catalog.pg_ts_config_map'::regclass,
      'pg_catalog.pg_init_privs'::regclass,'pg_catalog.pg_depend'::regclass,'pg_catalog.pg_shdepend'::regclass,
      'pg_catalog.pg_description'::regclass,'pg_catalog.pg_seclabel'::regclass]::oid[])
  ),
  columns AS (
    SELECT c.relname AS catalog,a.attname AS column_name,t.typname AS type,a.attnotnull AS not_null,a.attndims AS dimensions
    FROM catalogs wanted JOIN pg_catalog.pg_class c ON c.oid=wanted.oid
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
  ),
  foreign_keys AS (
    SELECT c.relname AS catalog,f.fkcols AS column_names,p.relname AS referenced_catalog,
      f.pkcols AS referenced_columns,f.is_array,f.is_opt
    FROM pg_catalog.pg_get_catalog_foreign_keys() f
    JOIN catalogs wanted ON wanted.oid=f.fktable
    JOIN pg_catalog.pg_class c ON c.oid=f.fktable JOIN pg_catalog.pg_class p ON p.oid=f.pktable
  )
SELECT jsonb_build_object(
  'operation','extension-node-and-catalog-public-shape-audit','format',1,
  'serverVersionNum',current_setting('server_version_num')::integer,
  'customerRowsRead',false,'rawNodeValuesReturned',false,'rawDdlReturned',false,
  'productionMutated',false,'qualificationReady',false,
  'nodeTagCounts',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY field,tag),'[]'::jsonb) FROM node_tags n WHERE tag IN (SELECT tag FROM public_node_tags)),
  'unknownNodeTagCount',(SELECT coalesce(sum(count),0) FROM node_tags WHERE tag NOT IN (SELECT tag FROM public_node_tags)),
  'publicFieldTokenCounts',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY field,key),'[]'::jsonb) FROM field_tokens f WHERE key IN (SELECT key FROM public_field_keys)),
  'fieldTokenScanIsExactParser',false,
  'unknownFieldLikeTokenCount',(SELECT coalesce(sum(count),0) FROM field_tokens WHERE key NOT IN (SELECT key FROM public_field_keys)),
  'catalogColumns',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY catalog,column_name),'[]'::jsonb) FROM columns c),
  'catalogForeignKeys',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY catalog,column_names),'[]'::jsonb) FROM foreign_keys f)
)::text;

COMMIT;
