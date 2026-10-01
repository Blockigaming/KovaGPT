#!/usr/bin/env python3
"""Scoped, guarded S6 image/config transitions. No startup, production or SQL actions.

Google credentials are read from the existing staging Key Vault into memory and
sent in an HTTPS ARM request body. They never enter argv, files or logs.
"""
import argparse, copy, importlib.util, json, pathlib, re, secrets as random_secrets, subprocess, time
import urllib.request, urllib.error

ORIGIN='https://ca-kovagpt-auth-rehearsal.whitepebble-42e8ad60.eastus.azurecontainerapps.io'
REPO='kovagptacr-dte9hugbhjghcyb8.azurecr.io/kovagpt-web-auth-rehearsal'
BASE_IMAGE=REPO+'@sha256:976c191615aca22d3653d0d3c1704cff743b16df693afea9407b5e2c57be71a1'
BASE_SHA='c92fdbfea58a0917f34c25264d7b8b40a78a47fb'
TARGET='/subscriptions/ab732127-11c3-46a7-a1cb-6ee8d86594f4/resourceGroups/rg-kovagpt-dev/providers/Microsoft.App/containerApps/ca-kovagpt-auth-rehearsal'
SECRET='kova-s6-google-client-secret'
RELAY_SECRET='kova-s6-owner-relay-key'
GOOGLE_VAULT='kv-kovagpt-staging'
GOOGLE_VAULT_NAMES=('kova-s6-google-client-id','kova-s6-google-client-secret')
GOOGLE_FIELDS={'KOVA_GOOGLE_CLIENT_ID','KOVA_GOOGLE_CLIENT_SECRET','KOVA_AUTH_REVERSE_PROXY_ORIGIN',
  'KOVA_S6_OWNER_RELAY_KEY','KOVA_S6_OWNER_RELAY_DEADLINE','KOVA_S6_SOURCE_SHA'}

def image(value):
    if not re.fullmatch(re.escape(REPO)+r'@sha256:[a-f0-9]{64}',value):
        raise ValueError('Pinned rehearsal image digest required')
    return value

def staging_google_credentials():
    values=[]
    for name in GOOGLE_VAULT_NAMES:
        result=subprocess.run(['az','keyvault','secret','show','--subscription',TARGET.split('/')[2],
            '--vault-name',GOOGLE_VAULT,'--name',name,'--query','value','-o','tsv','--only-show-errors'],
            capture_output=True,text=True,timeout=15)
        if result.returncode!=0:
            raise ValueError('staging_google_credential_unavailable')
        values.append(result.stdout.rstrip('\r\n'))
    client_id,client_secret=values
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',client_id) or not 16<=len(client_secret)<=512:
        raise ValueError('staging_google_credential_invalid')
    return client_id,client_secret

def build_receipt(path,mode,source):
    result=json.loads(pathlib.Path(path).read_text())
    assert result['mode']==mode and result['compiledMode']==mode
    assert result['sourceSha']==source and result['projectRef']=='oztdrjtdglkizlewnulh'
    assert result['googleEnabled'] is True
    assert re.fullmatch('[a-f0-9]{40}',result['sourceTree'])
    image(result['image'])
    return result

def transition_matches(props,template,secrets):
    desired=template['containers'][0]
    actual=props['template']['containers'][0]
    entries=lambda values: {x['name']:(x.get('value'),x.get('secretRef')) for x in values}
    return (props.get('runningStatus')=='Running' and props.get('provisioningState')=='Succeeded' and
      props.get('latestRevisionName')==props.get('latestReadyRevisionName') and
      actual['image']==desired['image'] and entries(actual['env'])==entries(desired['env']) and
      {x['name'] for x in props['configuration']['secrets']}=={x['name'] for x in secrets})

def gate(path, reserve=360):
    s=json.loads(pathlib.Path(path).read_text())
    assert s['target']==TARGET and s['status']=='armed' and s['selfTest'] is True
    assert s['pid']!=s['launcherPid']
    assert 0<=time.time()-__import__('datetime').datetime.fromisoformat(s['heartbeatAt']).timestamp()<8
    assert reserve<s['deadlineEpoch']-time.time()<=1200
    assert __import__('datetime').datetime.fromisoformat(s['tokenExpires']).timestamp()>s['deadlineEpoch']+120
    return s['deadlineEpoch']

def template_for(template, pinned_image, mode):
    assert mode in ('dual','kova');result=copy.deepcopy(template)
    assert len(result['containers'])==1
    container=result['containers'][0];container['image']=image(pinned_image)
    env=[x for x in container['env'] if x['name'] not in ('KOVA_AUTH_MODE','KOVA_COMPILED_AUTH_MODE')]
    env.append({'name':'KOVA_AUTH_MODE','value':mode})
    container['env']=env
    # KOVA_COMPILED_AUTH_MODE must come from the pinned image; never fake it with
    # a runtime override to conceal a browser/server mode mismatch.
    result.pop('revisionSuffix',None)
    return result

class Control:
    def __init__(self):
        r=subprocess.run(['az','account','get-access-token','--subscription',TARGET.split('/')[2],
            '--resource','https://management.azure.com/','-o','json'],capture_output=True,text=True,check=True,timeout=15)
        self.token=json.loads(r.stdout)['accessToken']
    def request(self,method,suffix='',body=None):
        assert method in ('GET','POST','PATCH') and suffix in ('','/listSecrets')
        assert method!='POST' or suffix=='/listSecrets'
        url='https://management.azure.com'+TARGET+suffix+'?api-version=2024-03-01'
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*a,**kw):raise ValueError('redirect_refused')
        req=urllib.request.Request(url,method=method,data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=8) as response:
            raw=response.read(2000000)
            return json.loads(raw) if raw else {}
    def current(self):
        result=self.request('GET');assert result['id'].lower()==TARGET.lower()
        assert result['properties']['configuration']['ingress']['allowInsecure'] is False
        return result

def main(args):
    if args.command=='check-google':
        staging_google_credentials()
        print(json.dumps({'credentialSource':GOOGLE_VAULT,'ready':True,'appStartRequested':False}));return
    if args.command=='plan':
        dual=build_receipt(args.dual_receipt,'dual',args.source_sha)
        kova=build_receipt(args.kova_receipt,'kova',args.source_sha)
        assert dual['sourceTree']==kova['sourceTree']
        assert dual['image']!=kova['image']
        plan={'target':TARGET,'origin':ORIGIN,'googleRedirect':ORIGIN+'/api/auth/google/callback',
          'googleClientType':'Web application','googleAuthorizedJavascriptOrigin':ORIGIN,
          'googleScopes':['openid','email','profile'],'googleConsentAudience':'External / Testing; dedicated disposable Google account as test user',
          'googleOfflineAccess':False,'secretStore':GOOGLE_VAULT,'googleCredentialNames':GOOGLE_VAULT_NAMES,
          'temporarySecrets':[SECRET,RELAY_SECRET],'ownerBrowser':'headed browser on owner physical device',
          'sourceSha':args.source_sha,'dualImage':dual['image'],'kovaImage':kova['image'],
          'buildReceipts':{'dual':dual,'kova':kova},
          'restoreImage':BASE_IMAGE,'restoreSource':BASE_SHA,
          'sequence':['pinned dual baseline','prepared dual image + Google opt-in','matching compiled kova image','pinned original dual image'],
          'databaseRollback':False,'fixtureScope':'new disposable S6 identities only','production':False}
        assert re.fullmatch('[a-f0-9]{40}',args.source_sha)
        pathlib.Path(args.plan).write_text(json.dumps(plan,indent=2));return
    operation_end=time.monotonic()+105
    reserve=210 if args.command=='restore' else 360
    deadline=gate(args.guard,reserve)
    control=Control();app=control.current();assert app['properties']['runningStatus']=='Running'
    plan=json.loads(pathlib.Path(args.plan).read_text());assert plan['target']==TARGET
    current=app['properties']['template'];mode={x['name']:x.get('value') for x in current['containers'][0]['env']}.get('KOVA_AUTH_MODE')
    if args.command=='capture':
        assert current['containers'][0]['image']==BASE_IMAGE and mode=='dual'
        assert not any(x['name'] in GOOGLE_FIELDS for x in current['containers'][0]['env'])
        assert current['scale']['maxReplicas']==1, 'Owner relay requires exactly one staging replica'
        path=pathlib.Path(args.baseline);assert not path.exists();path.write_text(json.dumps(current));path.chmod(0o600);return
    baseline=json.loads(pathlib.Path(args.baseline).read_text())
    assert baseline['containers'][0]['image']==BASE_IMAGE
    secrets=control.request('POST','/listSecrets')['value']
    if args.command=='configure-google':
        assert not any(x['name'] in (SECRET,RELAY_SECRET) for x in secrets)
        client_id,client_secret=staging_google_credentials()
        gate(args.guard,reserve)
        template=template_for(current,plan['dualImage'],'dual')
        template['containers'][0]['env']=[x for x in template['containers'][0]['env'] if x['name'] not in GOOGLE_FIELDS]+[
          {'name':'KOVA_GOOGLE_CLIENT_ID','value':client_id},{'name':'KOVA_GOOGLE_CLIENT_SECRET','secretRef':SECRET},
          {'name':'KOVA_AUTH_REVERSE_PROXY_ORIGIN','value':ORIGIN},
          {'name':'KOVA_S6_OWNER_RELAY_KEY','secretRef':RELAY_SECRET},
          {'name':'KOVA_S6_OWNER_RELAY_DEADLINE','value':__import__('datetime').datetime.fromtimestamp(deadline,__import__('datetime').timezone.utc).isoformat()},
          {'name':'KOVA_S6_SOURCE_SHA','value':plan['sourceSha']}]
        secrets.append({'name':SECRET,'value':client_secret})
        secrets.append({'name':RELAY_SECRET,'value':random_secrets.token_urlsafe(32)})
    elif args.command=='switch-kova':
        assert current['containers'][0]['image']==plan['dualImage'] and mode=='dual'
        template=template_for(current,plan['kovaImage'],'kova')
    elif args.command=='restore':
        assert current['containers'][0]['image'] in (plan['dualImage'],plan['kovaImage'],BASE_IMAGE)
        template=copy.deepcopy(baseline);template.pop('revisionSuffix',None)
        secrets=[x for x in secrets if x['name'] not in (SECRET,RELAY_SECRET)]
    else:raise ValueError('unknown_action')
    gate(args.guard,reserve)
    control.request('PATCH',body={'properties':{'template':template,'configuration':{'secrets':secrets}}})
    while time.monotonic()<operation_end-8 and time.time()<deadline-118:
        observed=control.current();props=observed['properties'];container=props['template']['containers'][0]
        if transition_matches(props,template,secrets):
            print(json.dumps({'action':args.command,'target':TARGET,'revision':props.get('latestReadyRevisionName'),
              'image':container['image'],'state':props.get('runningStatus'),'mode':'kova' if args.command=='switch-kova' else 'dual',
              'compiledMode':'kova' if args.command=='switch-kova' else 'dual',
              'compiledModeProof':'pinned original image' if args.command=='restore' else plan['buildReceipts']['kova' if args.command=='switch-kova' else 'dual'],
              'googleSecretPresent':any(x['name']==SECRET for x in props['configuration']['secrets']),
              'relaySecretPresent':any(x['name']==RELAY_SECRET for x in props['configuration']['secrets'])}))
            return
        time.sleep(2)
    raise TimeoutError('config_transition_not_verified')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['plan','check-google','capture','configure-google','switch-kova','restore'])
    for name in ['plan','guard','baseline','dual-receipt','kova-receipt','source-sha']:p.add_argument('--'+name)
    try:main(p.parse_args())
    except Exception as error:print(json.dumps({'status':'FAILED','errorType':type(error).__name__}));raise SystemExit(2)
