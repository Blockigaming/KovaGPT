targetScope = 'resourceGroup'

@description('Azure region for Work jobs and alerts.')
param location string

@description('Existing Container Apps managed environment resource ID.')
param managedEnvironmentId string

@description('Model-only Work Job name.')
param modelJobName string

@description('Browser-research Work Job name.')
param browserJobName string

@description('Immutable application image containing dist/worker/work-v2.mjs.')
param modelImageReference string

@description('Immutable isolated Playwright browser-worker image.')
param browserImageReference string

@description('Deploy the isolated browser job. It remains separately runtime-gated.')
param deployBrowserJob bool = false

@description('ACR login server.')
param registryServer string

@description('User-assigned managed identity resource ID.')
param managedIdentityResourceId string

@description('User-assigned managed identity client ID.')
param managedIdentityClientId string

@description('Versioned Key Vault URI for SUPABASE_SERVICE_ROLE_KEY.')
@secure()
param supabaseServiceRoleSecretUri string

@description('Supabase project URL.')
param supabaseUrl string

@description('Azure OpenAI endpoint.')
param azureOpenAiEndpoint string

@description('Azure OpenAI deep-model deployment used by Work.')
param azureOpenAiDeepDeployment string

@description('Exact source SHA represented by both immutable images.')
@minLength(40)
@maxLength(40)
param sourceSha string

@description('Logical Work environment written to heartbeat evidence.')
@allowed([
  'staging'
  'production'
])
param workEnvironment string

@description('UTC cron for model-only Work polling.')
param modelCronExpression string

@description('UTC cron for browser-research Work polling.')
param browserCronExpression string

@description('Enable provider generation only after exact-SHA readiness is proven.')
param generationEnabled bool = false

@description('Maximum model Work jobs processed per execution.')
@minValue(1)
@maxValue(25)
param modelBatchLimit int = 3

@description('Maximum simultaneous model Work claims.')
@minValue(1)
@maxValue(16)
param modelCapacity int = 3

@description('Maximum browser Work jobs processed per execution.')
@minValue(1)
@maxValue(4)
param browserBatchLimit int = 1

@description('Maximum browser replicas for one scheduled execution.')
@minValue(1)
@maxValue(4)
param browserParallelism int = 1

@description('Model Work job timeout.')
@minValue(120)
@maxValue(3600)
param modelTimeoutSeconds int = 900

@description('Browser Work job timeout.')
@minValue(120)
@maxValue(3600)
param browserTimeoutSeconds int = 1200

@description('Azure-level retry limit for each job execution.')
@minValue(0)
@maxValue(5)
param retryLimit int = 1

@description('Log Analytics workspace resource ID.')
param logAnalyticsWorkspaceId string

@description('Create Work failure and missing-success alert rules.')
param deployAlerts bool = false

@description('Action-group resource IDs for Work alerts.')
param alertActionGroupResourceIds array = []

@description('Resource tags.')
param tags object = {}

var alertsEnabled = deployAlerts && length(alertActionGroupResourceIds) > 0
var workFailureQuery = '''
ContainerAppConsoleLogs_CL
| where Log_s has '"component":"work-worker-v2"'
    or Log_s has '"component":"work-browser-worker-v2"'
| where Log_s has '"event":"work_worker_failed"'
    or Log_s has '"event":"work_worker_process_failed"'
    or Log_s has '"event":"work_browser_worker_failed"'
    or Log_s has '"event":"work_browser_worker_process_failed"'
'''
var modelSuccessQuery = '''
ContainerAppConsoleLogs_CL
| where Log_s has '"component":"work-worker-v2"'
| where Log_s has '"event":"work_worker_completed"'
'''
var browserSuccessQuery = '''
ContainerAppConsoleLogs_CL
| where Log_s has '"component":"work-browser-worker-v2"'
| where Log_s has '"event":"work_browser_worker_completed"'
'''

resource modelJob 'Microsoft.App/jobs@2025-01-01' = {
  name: modelJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: managedEnvironmentId
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: modelTimeoutSeconds
      replicaRetryLimit: retryLimit
      scheduleTriggerConfig: {
        cronExpression: modelCronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryServer
          identity: managedIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'supabase-service-role-key'
          keyVaultUrl: supabaseServiceRoleSecretUri
          identity: managedIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'work-model'
          image: modelImageReference
          command: [
            'node'
          ]
          args: [
            'dist/worker/work-v2.mjs'
          ]
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'KOVA_RUNTIME_PLATFORM'
              value: 'azure-container-apps'
            }
            {
              name: 'KOVA_WORK_WORKER_ENABLED'
              value: '1'
            }
            {
              name: 'KOVA_WORK_WORKER_ENVIRONMENT'
              value: workEnvironment
            }
            {
              name: 'KOVA_WORKER_REVISION'
              value: sourceSha
            }
            {
              name: 'KOVA_SOURCE_SHA'
              value: sourceSha
            }
            {
              name: 'KOVA_BUILD_SHA'
              value: sourceSha
            }
            {
              name: 'KOVA_WORK_WORKER_CAPACITY'
              value: string(modelCapacity)
            }
            {
              name: 'KOVA_WORK_WORKER_BATCH_LIMIT'
              value: string(modelBatchLimit)
            }
            {
              name: 'KOVA_WORK_WORKER_LEASE_SECONDS'
              value: '300'
            }
            {
              name: 'KOVA_WORK_WORKER_HEARTBEAT_MS'
              value: '30000'
            }
            {
              name: 'KOVA_WORK_WORKER_READINESS_STALE_SECONDS'
              value: '300'
            }
            {
              name: 'KOVA_WORK_MODEL_PROVIDER'
              value: 'azure-managed-identity'
            }
            {
              name: 'KOVA_WORK_MODEL_DEPLOYMENT'
              value: azureOpenAiDeepDeployment
            }
            {
              name: 'SUPABASE_URL'
              value: supabaseUrl
            }
            {
              name: 'SUPABASE_SERVICE_ROLE_KEY'
              secretRef: 'supabase-service-role-key'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: azureOpenAiEndpoint
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT_DEEP'
              value: azureOpenAiDeepDeployment
            }
            {
              name: 'AZURE_OPENAI_USE_MANAGED_IDENTITY'
              value: 'true'
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: managedIdentityClientId
            }
            {
              name: 'KOVA_GENERATION_DISABLED'
              value: generationEnabled ? 'false' : 'true'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}

resource browserJob 'Microsoft.App/jobs@2025-01-01' = if (deployBrowserJob) {
  name: browserJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: managedEnvironmentId
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: browserTimeoutSeconds
      replicaRetryLimit: retryLimit
      scheduleTriggerConfig: {
        cronExpression: browserCronExpression
        parallelism: browserParallelism
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryServer
          identity: managedIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'supabase-service-role-key'
          keyVaultUrl: supabaseServiceRoleSecretUri
          identity: managedIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'work-browser'
          image: browserImageReference
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'KOVA_RUNTIME_PLATFORM'
              value: 'azure-container-apps'
            }
            {
              name: 'KOVA_WORK_BROWSER_WORKER_ENABLED'
              value: '1'
            }
            {
              name: 'KOVA_WORK_BROWSER_ENVIRONMENT'
              value: workEnvironment
            }
            {
              name: 'KOVA_WORKER_REVISION'
              value: sourceSha
            }
            {
              name: 'KOVA_SOURCE_SHA'
              value: sourceSha
            }
            {
              name: 'KOVA_BUILD_SHA'
              value: sourceSha
            }
            {
              name: 'KOVA_WORK_BROWSER_CAPACITY'
              value: string(browserParallelism)
            }
            {
              name: 'KOVA_WORK_BROWSER_BATCH_LIMIT'
              value: string(browserBatchLimit)
            }
            {
              name: 'KOVA_WORK_BROWSER_LEASE_SECONDS'
              value: '600'
            }
            {
              name: 'KOVA_WORK_BROWSER_NAVIGATION_TIMEOUT_MS'
              value: '20000'
            }
            {
              name: 'KOVA_WORK_BROWSER_READINESS_STALE_SECONDS'
              value: '600'
            }
            {
              name: 'SUPABASE_URL'
              value: supabaseUrl
            }
            {
              name: 'SUPABASE_SERVICE_ROLE_KEY'
              secretRef: 'supabase-service-role-key'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: azureOpenAiEndpoint
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT_DEEP'
              value: azureOpenAiDeepDeployment
            }
            {
              name: 'AZURE_OPENAI_USE_MANAGED_IDENTITY'
              value: 'true'
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: managedIdentityClientId
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

resource workFailureAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (alertsEnabled) {
  name: '${modelJobName}-failure'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'KovaGPT Work worker failure'
    description: 'A model or browser Work worker emitted a terminal failure.'
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    severity: 1
    autoMitigate: true
    skipQueryValidation: true
    criteria: {
      allOf: [
        {
          query: workFailureQuery
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          dimensions: []
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: alertActionGroupResourceIds
    }
  }
}

resource workModelMissingSuccessAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (alertsEnabled) {
  name: '${modelJobName}-missing-success'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'KovaGPT model Work worker missing success'
    description: 'The model Work worker emitted no completion in the alert window.'
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    severity: 2
    autoMitigate: true
    skipQueryValidation: true
    criteria: {
      allOf: [
        {
          query: modelSuccessQuery
          timeAggregation: 'Count'
          operator: 'LessThan'
          threshold: 1
          dimensions: []
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: alertActionGroupResourceIds
    }
  }
}

resource workBrowserMissingSuccessAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (alertsEnabled && deployBrowserJob) {
  name: '${browserJobName}-missing-success'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'KovaGPT browser Work worker missing success'
    description: 'The browser Work worker emitted no completion in the alert window.'
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [
      logAnalyticsWorkspaceId
    ]
    severity: 2
    autoMitigate: true
    skipQueryValidation: true
    criteria: {
      allOf: [
        {
          query: browserSuccessQuery
          timeAggregation: 'Count'
          operator: 'LessThan'
          threshold: 1
          dimensions: []
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: alertActionGroupResourceIds
    }
  }
}

output modelJobName string = modelJob.name
output modelJobResourceId string = modelJob.id
output browserJobName string = deployBrowserJob ? browserJob.name : ''
output browserJobResourceId string = deployBrowserJob ? browserJob.id : ''
output workAlertsEnabled bool = alertsEnabled
