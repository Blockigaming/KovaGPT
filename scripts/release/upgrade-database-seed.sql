-- Synthetic fixtures only. Inserted after the captured structural baseline in
-- the disposable local database. There is no production data in this file.
insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.user_library_items(id,user_id,title,item_type,content_text) values (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'Synthetic upgrade document','document','Synthetic private content'
);
insert into public.chat_branches(
  id,owner_id,chat_id,conversation_id,message_ids,label,branch_from_parent_message_id,active
) values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  repeat('x',200),'synthetic-conversation',array['synthetic-message'],'','',true
);
insert into public.chat_message_versions(
  id,owner_id,chat_id,message_id,branch_id,version,source,instruction,
  content,original_content,selection_start,selection_end,accepted
) values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',repeat('x',200),'synthetic-message',
  '33333333-3333-4333-8333-333333333333',1,'retry','Keep this instruction',
  'Replacement','😀',0,2,true
);
insert into public.chat_pinned_files(id,owner_id,chat_id,source_type,source_id,status) values (
  '66666666-6666-4666-8666-666666666666',
  '11111111-1111-4111-8111-111111111111',repeat('x',200),'library',
  '55555555-5555-4555-8555-555555555555','active'
);
