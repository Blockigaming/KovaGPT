import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('guard',pathlib.Path(__file__).parents[2]/'scripts/azure/auth-rehearsal-watchdog.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)

class WatchdogTests(unittest.TestCase):
    def run_case(self, responses, budget=10, require_acceptance=False):
        events=[];calls=[];ticks=[0]
        class Arm:
            def request(self,method):
                calls.append(method);ticks[0]+=1
                x=responses.pop(0)
                if isinstance(x,Exception):raise x
                return x
        ok=guard.stop_and_verify(Arm(),lambda k,v:events.append((k,v)),budget=budget,
                                clock=lambda:ticks[0],pause=lambda s:ticks.__setitem__(0,ticks[0]+s),require_acceptance=require_acceptance)
        return ok,events,calls
    def test_actual_stop_then_independent_read(self):
        ok,events,calls=self.run_case([{'accepted':True},{'state':'Stopped'}])
        self.assertTrue(ok);self.assertEqual(calls,['POST','GET'])
    def test_unknown_post_outcome_is_still_verified(self):
        ok,events,calls=self.run_case([TimeoutError(),{'state':'Stopped'}])
        self.assertTrue(ok);self.assertEqual(calls,['POST','GET'])
        self.assertEqual(events[0][1]['type'],'TimeoutError')
    def test_transient_read_failure_retries_boundedly(self):
        ok,_,calls=self.run_case([{},TimeoutError(),{'state':'Stopped'}])
        self.assertTrue(ok);self.assertEqual(calls,['POST','GET','GET'])
    def test_operation_in_progress_conflict_still_verifies_stopped(self):
        ok,events,calls=self.run_case([guard.ArmError('POST',409),{'state':'Stopped'}])
        self.assertTrue(ok);self.assertEqual(calls,['POST','GET'])
        self.assertEqual(events[0][1]['code'],409)
    def test_prestart_requires_actual_stop_permission_even_when_already_stopped(self):
        ok,_,_=self.run_case([guard.ArmError('POST',403),{'state':'Stopped'}],budget=3,require_acceptance=True)
        self.assertFalse(ok)
    def test_auth_failure_is_explicit_and_does_not_claim_success(self):
        ok,events,_=self.run_case([guard.ArmError('POST',401),guard.ArmError('GET',401)],budget=3)
        self.assertFalse(ok);self.assertEqual(events[0][1]['code'],401)
    def test_running_does_not_count_as_stopped(self):
        ok,_,_=self.run_case([{}, {'state':'Running'}],budget=3)
        self.assertFalse(ok)
    def test_target_is_pinned_and_there_is_no_start_action(self):
        self.assertTrue(guard.TARGET.endswith('/containerApps/ca-kovagpt-auth-rehearsal'))
        with self.assertRaises(ValueError):guard.Arm('not-a-token').request('START')

if __name__=='__main__':unittest.main()
