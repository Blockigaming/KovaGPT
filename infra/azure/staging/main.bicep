targetScope = 'resourceGroup'

@description('Azure region for staging resources.')
param location string = resourceGroup().location

@description('Short lowercase prefix used for generated resource names.')
@minLength(3)
@maxLength(24)
param namePrefix string = 'kovagpt-stg'

@description('Immutable ACR image reference. Supply repository@sha256:digest, never a mutable tag.')
param imageReference string

@description('Exact 40-character Git commit represented by imageReference.')
@minLength(40)
@maxLength(40)
param sourceSha string

@description('Exact Git tree represented by imageReference.')
@minLength(40)
@maxLength(40)
param sourceTree string

@description('Expected synthetic staging Supabase project reference embedded in the browser bundle.')
@minLength(20)
@maxLength(64)
param expectedSupabaseProjectRef string

@description('Existing Azure Container Registry name.')
param acrName string = 'kovagptacr'

@description('Resource group containing the existing ACR.')
param acrResourceGroupName string = resourceGroup().name

@description('Existing Key Vault name used for server credentials and optional origin certificate.')
param keyVaultName string

@description('Resource group containing the existing Key Vault.')
param keyVaultResourceGroupName string = resourceGroup().name

@description('Versioned Key Vault secret URI for SUPABASE_SERVICE_ROLE_KEY.')
@secure()
param supabaseServiceRoleSecretUri string

@description('Versioned Key Vault secret URI for anonymous generation IP hashing.')
@secure()
param kovaIpHashSecretUri string

@description('Versioned Key Vault secret URI shared by the web app and optional scheduled execution job.')
@secure()
param scheduledExecutionSecretUri string

@description('Additional Key Vault secret bindings. Keys are Container Apps secret names; values contain envName and a versioned secretUri.')
@secure()
param additionalKeyVaultSecretBindings object = {}

@description('Additional non-secret runtime environment variables. Keys become environment-variable names.')
param additionalEnvironmentVariables object = {}

@description('Existing Azure OpenAI account name. The staging identity receives only Cognitive Services OpenAI User on this resource.')
param azureOpenAiAccountName string

@description('Resource group containing the existing Azure OpenAI account.')
param azureOpenAiResourceGroupName string = resourceGroup().name

@description('Azure OpenAI deployment used for Luna/normal chat.')
param azureOpenAiChatDeployment string = 'kova-chat'

@description('Azure OpenAI deployment used for Terra/thinking requests.')
param azureOpenAiThinkingDeployment string = 'kova-think'

@description('Azure OpenAI deployment used for the Kova logical model gpt-5.6-sol.')
param azureOpenAiDeepDeployment string = 'kova-deep'

@description('Azure OpenAI image generation deployment.')
param azureOpenAiImageDeployment string = 'kova-image'

@description('Azure OpenAI embedding deployment.')
param azureOpenAiEmbeddingDeployment string = 'kova-embedding'

@description('Browser-safe Supabase project URL for the synthetic staging project.')
param supabaseUrl string

@description('Browser-safe Supabase publishable key for the synthetic staging project.')
@secure()
param supabasePublishableKey string

@description('Canonical staging HTTPS base URL. Do not include a trailing slash.')
param publicBaseUrl string

@description('Generation remains disabled until owner-approved staging provider smoke tests.')
param generationEnabled bool = false

@description('Minimum web replicas. Zero minimizes idle staging cost.')
@minValue(0)
@maxValue(2)
param minReplicas int = 0

@description('Maximum web replicas for staging cost containment.')
@minValue(1)
@maxValue(4)
param maxReplicas int = 2

@description('Restrict staging ingress to allowedIngressCidrs.')
param restrictIngress bool = false

@description('Allowed staging ingress CIDRs. Required when restrictIngress is true.')
param allowedIngressCidrs array = []

@description('Bind optional staging custom domains using a Key Vault certificate.')
param bindCustomDomains bool = false

@description('Optional staging custom domains covered by the origin certificate.')
param customDomains array = []

@description('Versioned Key Vault secret URI containing the optional staging PFX or PEM certificate.')
@secure()
param customDomainCertificateSecretUri string = ''

@description('Name assigned to the optional staging environment certificate resource.')
param customDomainCertificateName string = 'kovagpt-staging-origin'

@description('Deploy the staging scheduled execution job.')
param deployScheduledJob bool = false

@description('UTC five-field cron expression for staging scheduled execution.')
param schedulerCronExpression string = '*/5 * * * *'

@description('Maximum scheduler replica runtime in seconds.')
@minValue(60)
@maxValue(3600)
param schedulerTimeoutSeconds int = 300

@description('Maximum scheduler retries after a failed execution.')
@minValue(0)
@maxValue(10)
param schedulerRetryLimit int = 2

@description('Maximum task occurrences processed by one scheduler execution.')
@minValue(1)
@maxValue(25)
param schedulerBatchLimit int = 5

@description('Maximum delivery rows processed by one scheduler execution.')
@minValue(1)
@maxValue(200)
param schedulerDeliveryBatchLimit int = 50

@description('Age in seconds after which a delivery processing row may be recovered.')
@minValue(30)
@maxValue(3600)
param schedulerDeliveryStaleSeconds int = 300

@description('Maximum healthy scheduler heartbeat age in seconds.')
@minValue(30)
@maxValue(3600)
param schedulerReadinessStaleSeconds int = 600

@description('Maximum pending or failed delivery backlog accepted as healthy.')
@minValue(0)
@maxValue(10000)
param schedulerMaxDeliveryBacklog int = 100

@description('Expose Scheduled Tasks in the web UI only after schema, worker and canary verification. The runtime remains disabled unless the Job and generation are also enabled.')
param scheduledTasksEnabled bool = false

@description('Deploy Azure Monitor scheduler failure and missing-success alerts.')
param deploySchedulerAlerts bool = false

@description('Azure Monitor action-group resource IDs for scheduler alerts.')
param schedulerAlertActionGroupResourceIds array = []

@description('Log Analytics retention in days.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

@description('Log Analytics daily ingestion cap in GB.')
@minValue(1)
@maxValue(10)
param logDailyQuotaGb int = 1

@description('Create a monthly resource-group budget.')
param deployBudget bool = false

@description('Monthly budget amount in the subscription billing currency.')
@minValue(1)
param monthlyBudgetAmount int = 25

@description('Budget start date. Must be the first day of a month in ISO UTC format.')
param budgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

@description('Budget notification recipients. Required when deployBudget is true.')
param budgetContactEmails array = []

@description('Tags applied to all created resources.')
param tags object = {
  application: 'kovagpt'
  environment: 'staging'
  managedBy: 'bicep'
  costCenter: 'kovagpt-staging'
}

var environmentName = '${namePrefix}-env'
var webAppName = '${namePrefix}-web'
var scheduledJobResourceName = '${namePrefix}-scheduled-execution'
var identityName = '${namePrefix}-identity'
var workspaceName = '${namePrefix}-logs'
var appInsightsName = '${namePrefix}-insights'
var budgetName = '${namePrefix}-monthly-budget'
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
var keyVaultSecretsUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var cognitiveServicesOpenAiUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
)
var additionalSecretItems = items(additionalKeyVaultSecretBindings)
var additionalEnvironmentItems = items(additionalEnvironmentVariables)
var coreSecrets = [
  {
    name: 'supabase-service-role-key'
    keyVaultUrl: supabaseServiceRoleSecretUri
    identity: identity.id
  }
  {
    name: 'kova-ip-hash-secret'
    keyVaultUrl: kovaIpHashSecretUri
    identity: identity.id
  }
  {
    name: 'scheduled-execution-secret'
    keyVaultUrl: scheduledExecutionSecretUri
    identity: identity.id
  }
]
var additionalSecrets = [for binding in additionalSecretItems: {
  name: binding.key
  keyVaultUrl: binding.value.secretUri
  identity: identity.id
}]
var coreEnvironment = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'AZURE_ENVIRONMENT'
    value: 'staging'
  }
  {
    name: 'KOVA_RUNTIME_PLATFORM'
    value: 'azure-container-apps'
  }
  {
    name: 'KOVA_CLOUDFLARE_EDGE_ONLY'
    value: 'true'
  }
  {
    name: 'KOVA_NITRO_PRESET'
    value: 'node-server'
  }
  {
    name: 'HOST'
    value: '0.0.0.0'
  }
  {
    name: 'PORT'
    value: '3000'
  }
  {
    name: 'KOVA_PUBLIC_BASE_URL'
    value: publicBaseUrl
  }
  {
    name: 'KOVA_PUBLIC_URL'
    value: publicBaseUrl
  }
  {
    name: 'KOVA_BUILD_SHA'
    value: sourceSha
  }
  {
    name: 'KOVA_SOURCE_SHA'
    value: sourceSha
  }
  {
    name: 'KOVA_SOURCE_TREE'
    value: sourceTree
  }
  {
    name: 'KOVA_SCHEDULED_TASKS_ENABLED'
    value: scheduledTasksEnabled && deployScheduledJob && generationEnabled ? '1' : '0'
  }
  {
    name: 'KOVA_EXPECTED_SUPABASE_PROJECT_REF'
    value: expectedSupabaseProjectRef
  }
  {
    name: 'SUPABASE_URL'
    value: supabaseUrl
  }
  {
    name: 'SUPABASE_PUBLISHABLE_KEY'
    value: supabasePublishableKey
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
    name: 'SCHEDULED_TASK_SECRET'
    secretRef: 'scheduled-execution-secret'
  }
  {
    name: 'AZURE_OPENAI_ENDPOINT'
    value: azureOpenAi.properties.endpoint
  }
  {
    name: 'AZURE_CLIENT_ID'
    value: identity.properties.clientId
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
    name: 'AZURE_OPENAI_DEPLOYMENT_IMAGE'
    value: azureOpenAiImageDeployment
  }
  {
    name: 'AZURE_OPENAI_DEPLOYMENT_EMBEDDING'
    value: azureOpenAiEmbeddingDeployment
  }
  {
    name: 'AI_GENERATION_ENABLED'
    value: generationEnabled ? 'true' : 'false'
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
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsights.properties.ConnectionString
  }
]
var additionalSecretEnvironment = [for binding in additionalSecretItems: {
  name: binding.value.envName
  secretRef: binding.key
}]
var additionalPlainEnvironment = [for binding in additionalEnvironmentItems: {
  name: binding.key
  value: string(binding.value)
}]
var webEnvironment = concat(coreEnvironment, additionalSecretEnvironment, additionalPlainEnvironment)
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
  scope: resourceGroup(acrResourceGroupName)
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
  scope: resourceGroup(keyVaultResourceGroupName)
}

resource azureOpenAi 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: azureOpenAiAccountName
  scope: resourceGroup(azureOpenAiResourceGroupName)
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}

module acrPull '../modules/acr-role-assignment.bicep' = {
  name: 'acrPull-${uniqueString(acr.id, identity.id)}'
  scope: resourceGroup(acrResourceGroupName)
  params: {
    acrName: acrName
    principalId: identity.properties.principalId
    roleDefinitionId: acrPullRoleDefinitionId
  }
}

module keyVaultSecretsUser '../modules/keyvault-role-assignment.bicep' = {
  name: 'keyVaultSecretsUser-${uniqueString(keyVault.id, identity.id)}'
  scope: resourceGroup(keyVaultResourceGroupName)
  params: {
    keyVaultName: keyVaultName
    principalId: identity.properties.principalId
    roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
  }
}

module azureOpenAiUser '../modules/openai-role-assignment.bicep' = {
  name: 'azureOpenAiUser-${uniqueString(azureOpenAi.id, identity.id)}'
  scope: resourceGroup(azureOpenAiResourceGroupName)
  params: {
    accountName: azureOpenAiAccountName
    principalId: identity.properties.principalId
    roleDefinitionId: cognitiveServicesOpenAiUserRoleDefinitionId
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    retentionInDays: logRetentionDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    workspaceCapping: {
      dailyQuotaGb: logDailyQuotaGb
    }
  }
  sku: {
    name: 'PerGB2018'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    IngestionMode: 'LogAnalytics'
    WorkspaceResourceId: workspace.id
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    zoneRedundant: false
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: listKeys(workspace.id, workspace.apiVersion).primarySharedKey
      }
    }
  }
}

resource originCertificate 'Microsoft.App/managedEnvironments/certificates@2025-01-01' = if (bindCustomDomains) {
  parent: environment
  name: customDomainCertificateName
  location: location
  tags: tags
  properties: {
    certificateKeyVaultProperties: {
      identity: identity.id
      keyVaultUrl: customDomainCertificateSecretUri
    }
  }
  dependsOn: [
    keyVaultSecretsUser
  ]
}

var customDomainBindings = [for domain in customDomains: {
  name: domain
  bindingType: 'SniEnabled'
  certificateId: resourceId(
    'Microsoft.App/managedEnvironments/certificates',
    environment.name,
    customDomainCertificateName
  )
}]

var stagingIpSecurityRestrictions = [
  for (cidr, index) in allowedIngressCidrs: {
    name: 'staging-${index}'
    description: 'Controlled staging ingress'
    ipAddressRange: cidr
    action: 'Allow'
  }
]

resource webApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: webAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 3000
        transport: 'auto'
        customDomains: bindCustomDomains ? customDomainBindings : []
        ipSecurityRestrictions: restrictIngress ? stagingIpSecurityRestrictions : []
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: concat(coreSecrets, additionalSecrets)
    }
    template: {
      containers: [
        {
          name: 'web'
          image: imageReference
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: webEnvironment
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/api/health'
                port: 3000
                scheme: 'HTTP'
              }
              periodSeconds: 5
              timeoutSeconds: 5
              failureThreshold: 12
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 20
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: generationEnabled ? '/api/readyz' : '/api/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 6
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    acrPull
    keyVaultSecretsUser
    azureOpenAiUser
  ]
}

module scheduledWorker '../modules/scheduled-worker-job.bicep' = if (deployScheduledJob) {
  name: 'scheduled-worker-${uniqueString(scheduledJobResourceName, sourceSha)}'
  params: {
    location: location
    jobName: scheduledJobResourceName
    managedEnvironmentId: environment.id
    imageReference: imageReference
    registryServer: acr.properties.loginServer
    managedIdentityResourceId: identity.id
    managedIdentityClientId: identity.properties.clientId
    supabaseServiceRoleSecretUri: supabaseServiceRoleSecretUri
    kovaIpHashSecretUri: kovaIpHashSecretUri
    supabaseUrl: supabaseUrl
    azureOpenAiEndpoint: azureOpenAi.properties.endpoint
    azureOpenAiChatDeployment: azureOpenAiChatDeployment
    azureOpenAiThinkingDeployment: azureOpenAiThinkingDeployment
    azureOpenAiDeepDeployment: azureOpenAiDeepDeployment
    sourceSha: sourceSha
    schedulerEnvironment: 'staging'
    cronExpression: schedulerCronExpression
    timeoutSeconds: schedulerTimeoutSeconds
    retryLimit: schedulerRetryLimit
    batchLimit: schedulerBatchLimit
    deliveryBatchLimit: schedulerDeliveryBatchLimit
    deliveryStaleSeconds: schedulerDeliveryStaleSeconds
    readinessStaleSeconds: schedulerReadinessStaleSeconds
    maxDeliveryBacklog: schedulerMaxDeliveryBacklog
    generationEnabled: generationEnabled
    logAnalyticsWorkspaceId: workspace.id
    deployAlerts: deploySchedulerAlerts
    alertActionGroupResourceIds: schedulerAlertActionGroupResourceIds
    alertEvaluationFrequency: 'PT5M'
    alertWindowSize: 'PT15M'
    tags: tags
  }
  dependsOn: [
    acrPull
    keyVaultSecretsUser
    azureOpenAiUser
  ]
}

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = if (deployBudget) {
  name: budgetName
  properties: {
    amount: monthlyBudgetAmount
    category: 'Cost'
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      Actual_50_Percent: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: budgetContactEmails
        contactGroups: []
        contactRoles: []
      }
      Actual_80_Percent: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: budgetContactEmails
        contactGroups: []
        contactRoles: []
      }
      Forecasted_100_Percent: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: budgetContactEmails
        contactGroups: []
        contactRoles: []
      }
    }
  }
}

output containerAppName string = webApp.name
output containerAppFqdn string = webApp.properties.configuration.ingress.fqdn
output scheduledJobName string = deployScheduledJob ? scheduledJobResourceName : ''
output schedulerAlertsEnabled bool = deployScheduledJob && deploySchedulerAlerts && length(schedulerAlertActionGroupResourceIds) > 0
output customDomainsBound bool = bindCustomDomains
output ingressRestricted bool = restrictIngress
output managedEnvironmentName string = environment.name
output managedIdentityResourceId string = identity.id
output managedIdentityClientId string = identity.properties.clientId
output azureOpenAiResourceId string = azureOpenAi.id
output logAnalyticsWorkspaceName string = workspace.name
output applicationInsightsName string = appInsights.name
output generationIsEnabled bool = generationEnabled
output deployedSourceSha string = sourceSha
output deployedSourceTree string = sourceTree
