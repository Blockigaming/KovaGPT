import importlib.util,pathlib,unittest,copy,json,tempfile,time,datetime
from unittest.mock import patch
from types import SimpleNamespace
p=pathlib.Path(__file__).parents[2]/'scripts/azure/auth-rehearsal-control.py'
s=importlib.util.spec_from_file_location('control',p);c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
class ControlTests(unittest.TestCase):
 def test_credentials_are_read_only_from_pinned_staging_store_without_output(self):
  values=['fixture.apps.googleusercontent.com','fixture-secret-value-123']
  with patch.object(c.subprocess,'run',side_effect=[SimpleNamespace(returncode=0,stdout=v+'\n') for v in values]) as run:
   self.assertEqual(c.staging_google_credentials(),tuple(values))
  for call,name in zip(run.call_args_list,c.GOOGLE_VAULT_NAMES):
   argv=call.args[0]
   self.assertEqual(argv[argv.index('--vault-name')+1],'kv-kovagpt-staging')
   self.assertEqual(argv[argv.index('--name')+1],name)
   self.assertTrue(call.kwargs['capture_output'])
   self.assertNotIn(values[1],argv)
 def test_missing_and_invalid_credentials_fail_closed_without_echoing_provider_output(self):
  with patch.object(c.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='sensitive-output',stderr='sensitive-error')):
   with self.assertRaisesRegex(ValueError,'^staging_google_credential_unavailable$'):c.staging_google_credentials()
  with patch.object(c.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='invalid-sensitive-output')):
   with self.assertRaisesRegex(ValueError,'^staging_google_credential_invalid$'):c.staging_google_credentials()
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
 def test_readback_requires_exact_environment_secrets_and_running_revision(self):
  template={'containers':[{'image':c.BASE_IMAGE,'env':[{'name':'KOVA_AUTH_MODE','value':'dual'}]}]}
  props={'runningStatus':'Running','provisioningState':'Succeeded','latestRevisionName':'r','latestReadyRevisionName':'r',
    'template':copy.deepcopy(template),'configuration':{'secrets':[{'name':'existing'}]}}
  self.assertTrue(c.transition_matches(props,template,[{'name':'existing'}]))
  for change in ('mode','secret','state','revision'):
   bad=copy.deepcopy(props)
   if change=='mode':bad['template']['containers'][0]['env'][0]['value']='kova'
   if change=='secret':bad['configuration']['secrets'].append({'name':c.SECRET})
   if change=='state':bad['runningStatus']='Stopped'
   if change=='revision':bad['latestReadyRevisionName']='old'
   self.assertFalse(c.transition_matches(bad,template,[{'name':'existing'}]))
 def test_restore_has_a_reserved_bound_and_expired_tokens_never_authorize_changes(self):
  now=time.time();iso=lambda n:datetime.datetime.fromtimestamp(n,datetime.timezone.utc).isoformat()
  state={'target':c.TARGET,'status':'armed','selfTest':True,'pid':2,'launcherPid':1,
    'heartbeatAt':iso(now),'deadlineEpoch':now+300,'tokenExpires':iso(now+600)}
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'guard.json';p.write_text(json.dumps(state))
   self.assertEqual(c.gate(p,210),state['deadlineEpoch'])
   with self.assertRaises(AssertionError):c.gate(p)
   state['tokenExpires']=iso(now+301);p.write_text(json.dumps(state))
   with self.assertRaises(AssertionError):c.gate(p,210)
if __name__=='__main__':unittest.main()
