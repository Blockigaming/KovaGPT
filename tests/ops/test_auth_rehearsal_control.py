import importlib.util,pathlib,unittest
p=pathlib.Path(__file__).parents[2]/'scripts/azure/auth-rehearsal-control.py'
s=importlib.util.spec_from_file_location('control',p);c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
class ControlTests(unittest.TestCase):
 def test_only_digest_pinned_rehearsal_repository_is_allowed(self):
  self.assertEqual(c.image(c.BASE_IMAGE),c.BASE_IMAGE)
  for value in [c.REPO+':latest',c.BASE_IMAGE.replace('auth-rehearsal','prod'),c.REPO+'@sha256:'+'x'*64]:
   with self.assertRaises(ValueError):c.image(value)
 def test_browser_mode_cannot_be_forged_by_runtime_override(self):
  before={'revisionSuffix':'old','containers':[{'image':c.BASE_IMAGE,'env':[{'name':'KOVA_AUTH_MODE','value':'dual'},
    {'name':'KOVA_COMPILED_AUTH_MODE','value':'dual'},{'name':'KEEP','secretRef':'existing-secret'}]}]}
  after=c.template_for(before,c.REPO+'@sha256:'+'a'*64,'kova')
  self.assertNotIn('revisionSuffix',after)
  self.assertEqual(after['containers'][0]['env'],[{'name':'KEEP','secretRef':'existing-secret'},{'name':'KOVA_AUTH_MODE','value':'kova'}])
  self.assertEqual(before['containers'][0]['image'],c.BASE_IMAGE)
 def test_unsupported_mode_and_multiple_containers_refused(self):
  with self.assertRaises(AssertionError):c.template_for({'containers':[{},{}]},c.BASE_IMAGE,'kova')
  with self.assertRaises(AssertionError):c.template_for({'containers':[{}]},c.BASE_IMAGE,'supabase')
if __name__=='__main__':unittest.main()
