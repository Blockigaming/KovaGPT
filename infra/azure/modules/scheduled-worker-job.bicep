targetScope = 'resourceGroup'

@description('Azure region for the Container Apps Job and alert rules.')
param location string

@description('Scheduled Container Apps Job resource name.')
param jobName string

@description('Existing Container Apps managed environment resource ID.')
param managedEnvironmentId string

@description('Immutable ACR image reference containing dist/worker/scheduled-v2.mjs.')
param imageReference string

@description('ACR login server for the immutable worker image.')
param registryServer string

@description('User-assigned managed identity resource ID used by the job and registry.')
param managedIdentityResourceId string

@description('Managed identity client ID used for Azure OpenAI authentication.')
param managedIdentityClientId string

@description('Versioned Key Vault URI for SUPABASE_SERVICE_ROLE_KEY.')
@secure()
param supabaseServiceRoleSecretUri string

@description('Versioned Key Vault URI for KOVA_IP_HASH_SECRET.')
@secure()
param kovaIpHashSecretUri string

@description('Supabase project URL used by the scheduled worker.')
param supabaseUrl string

@description('Azure OpenAI endpoint used by the scheduled worker.')
param azureOpenAiEndpoint string

@description('Azure OpenAI deployment used for balanced scheduled-task generation.')
param azureOpenAiChatDeployment string

@description('Azure OpenAI deployment used for thinking requests.')
param azureOpenAiThinkingDeployment string

@description('Azure OpenAI deployment used for deep requests.')
param azureOpenAiDeepDeployment string

@description('Exact source SHA represented by imageReference.')
@minLength(40)
@maxLength(40)
param sourceSha string

@description('Logical scheduler environment recorded in heartbeat evidence.')
@allowed([
  'staging'
  'production'
])
param schedulerEnvironment string

@description('UTC five-field cron expression.')
param cronExpression string

@description('Maximum one-shot job runtime.')
@minValue(60)
@maxValue(3600)
param timeoutSeconds int = 300

@description('Azure-level retries after a failed job execution.')
@minValue(0)
@maxValue(10)
param retryLimit int = 2

@description('Maximum task occurrences processed by one worker execution.')
@minValue(1)
@maxValue(25)
param batchLimit int = 5

@description('Maximum delivery-outbox rows processed by one worker execution.')
@minValue(1)
@maxValue(200)
param deliveryBatchLimit int = 50

@description('Age in seconds after which a delivery processing row may be recovered.')
@minValue(30)
@maxValue(3600)
param deliveryStaleSeconds int = 300

@description('Maximum healthy heartbeat age accepted by scheduler readiness.')
@minValue(30)
@maxValue(3600)
param readinessStaleSeconds int = 180

@description('Maximum pending/failed delivery backlog allowed for healthy readiness.')
@minValue(0)
@maxValue(10000)
param maxDeliveryBacklog int = 100

@description('Enable model generation for this immutable release only after provider readiness is proven.')
param generationEnabled bool = false

@description('Log Analytics workspace resource ID used for scheduler alerts.')
param logAnalyticsWorkspaceId string

@description('Create scheduler failure and missing-success alert rules. Requires at least one action-group resource ID.')
param deployAlerts bool = false

@description('Azure Monitor action-group resource IDs invoked by scheduler alerts.')
param alertActionGroupResourceIds array = []

@description('Alert evaluation frequency in ISO 8601 duration format.')
param alertEvaluationFrequency string = 'PT5M'

@description('Alert lookback window in ISO 8601 duration format.')
param alertWindowSize string = 'PT10M'

@description('Resource tags.')
param tags object = {}

var alertsEnabled = deployAlerts && length(alertActionGroupResourceIds) > 0
var failureQuery = '''
ContainerAppConsoleLogs_CL
| where Log_s has '"component":"scheduled-worker-v2"'
| where Log_s has '"event":"scheduled_worker_failed"'
    or Log_s has '"event":"scheduled_worker_process_failed"'
'''
var successQuery = '''
ContainerAppConsoleLogs_CL
| where Log_s has '"component":"scheduled-worker-v2"'
| where Log_s has '"event":"scheduled_worker_completed"'
'''

resource scheduledJob 'Microsoft.App/jobs@2025-01-01' = {
  name: jobName
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
      replicaTimeout: timeoutSeconds
      replicaRetryLimit: retryLimit
      scheduleTriggerConfig: {
        cronExpression: cronExpression
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
        {
          name: 'kova-ip-hash-secret'
          keyVaultUrl: kovaIpHashSecretUri
          identity: managedIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'scheduler'
          image: imageReference
          command: [
            'node'
          ]
          args: [
            'dist/worker/scheduled-v2.mjs'
          ]
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'AZURE_ENVIRONMENT'
              value: schedulerEnvironment
            }
            {
              name: 'KOVA_RUNTIME_PLATFORM'
              value: 'azure-container-apps'
            }
            {
              name: 'KOVA_SCHEDULED_WORKER_ENABLED'
              value: '1'
            }
            {
              name: 'KOVA_SCHEDULED_WORKER_ENVIRONMENT'
              value: schedulerEnvironment
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
              name: 'KOVA_SCHEDULED_WORKER_BATCH_LIMIT'
              value: string(batchLimit)
            }
            {
              name: 'KOVA_SCHEDULED_DELIVERY_BATCH_LIMIT'
              value: string(deliveryBatchLimit)
            }
            {
              name: 'KOVA_SCHEDULED_DELIVERY_STALE_SECONDS'
              value: string(deliveryStaleSeconds)
            }
            {
              name: 'KOVA_SCHEDULED_WORKER_MAX_STALE_SECONDS'
              value: string(readinessStaleSeconds)
            }
            {
              name: 'KOVA_SCHEDULED_WORKER_MAX_DELIVERY_BACKLOG'
              value: string(maxDeliveryBacklog)
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
              name: 'KOVA_IP_HASH_SECRET'
              secretRef: 'kova-ip-hash-secret'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: azureOpenAiEndpoint
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: managedIdentityClientId
            }
            {
              name: 'AZURE_OPENAI_USE_MANAGED_IDENTITY'
              value: 'true'
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT_CHAT'
              value: azureOpenAiChatDeployment
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT_THINKING'
              value: azureOpenAiThinkingDeployment
            }
            {
              name: 'AZURE_OPENAI_DEPLOYMENT_DEEP'
              value: azureOpenAiDeepDeployment
            }
            {
              name: 'KOVA_GENERATION_DISABLED'
              value: generationEnabled ? 'false' : 'true'
            }
            {
              name: 'KOVA_INSTANT_MODEL'
              value: 'gpt-5.6-luna'
            }
            {
              name: 'KOVA_NORMAL_MODEL'
              value: 'gpt-5.6-luna'
            }
            {
              name: 'KOVA_THINKING_MODEL'
              value: 'gpt-5.6-terra'
            }
            {
              name: 'KOVA_DEEP_MODEL'
              value: 'gpt-5.6-sol'
            }
            {
              name: 'KOVA_UTILITY_MODEL'
              value: 'gpt-5.6-luna'
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

resource schedulerFailureAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (alertsEnabled) {
  name: '${jobName}-failure'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${jobName} failure'
    description: 'Scheduled worker emitted a terminal failure event.'
    enabled: true
    evaluationFrequency: alertEvaluationFrequency
    windowSize: alertWindowSize
    scopes: [
      logAnalyticsWorkspaceId
    ]
    severity: 1
    autoMitigate: true
    skipQueryValidation: true
    criteria: {
      allOf: [
        {
          query: failureQuery
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

resource schedulerMissingSuccessAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (alertsEnabled) {
  name: '${jobName}-missing-success'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${jobName} missing success heartbeat'
    description: 'Scheduled worker has not emitted a successful completion in the alert window.'
    enabled: true
    evaluationFrequency: alertEvaluationFrequency
    windowSize: alertWindowSize
    scopes: [
      logAnalyticsWorkspaceId
    ]
    severity: 2
    autoMitigate: true
    skipQueryValidation: true
    criteria: {
      allOf: [
        {
          query: successQuery
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

output scheduledJobName string = scheduledJob.name
output scheduledJobResourceId string = scheduledJob.id
output schedulerAlertsEnabled bool = alertsEnabled
output schedulerFailureAlertName string = alertsEnabled ? schedulerFailureAlert.name : ''
output schedulerMissingSuccessAlertName string = alertsEnabled ? schedulerMissingSuccessAlert.name : ''
