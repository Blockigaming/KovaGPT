

targetScope = 'resourceGroup'

@description('Azure region for production resources.')
param location string = resourceGroup().location

@description('Short lowercase prefix used for generated resource names.')
@minLength(3)
@maxLength(24)
param namePrefix string = 'kovagpt-prod'

@description('Existing production Container Apps managed environment.')
param managedEnvironmentName string = 'cae-kovagpt-prod'

@description('Existing production user-assigned managed identity.')
param managedIdentityName string = 'id-kovagpt-prod'

@description('Existing production Log Analytics workspace.')
param logAnalyticsWorkspaceName string = 'log-kovagpt-prod'

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

@description('Expected production Supabase project reference embedded in the browser bundle.')
@minLength(20)
@maxLength(64)
param expectedSupabaseProjectRef string

@description('Existing Azure Container Registry name.')
param acrName string = 'kovagptacr'

@description('Resource group containing the existing ACR.')
param acrResourceGroupName string = resourceGroup().name

@description('Existing production Key Vault name used only for server-side credentials and the Cloudflare origin certificate.')
param keyVaultName string

@description('Resource group containing the existing Key Vault.')
param keyVaultResourceGroupName string = resourceGroup().name

@description('Versioned Key Vault secret URI for SUPABASE_SERVICE_ROLE_KEY.')
@secure()
param supabaseServiceRoleSecretUri string

@description('Versioned Key Vault secret URI for anonymous generation IP hashing.')
@secure()
param kovaIpHashSecretUri string

@description('Versioned Key Vault secret URI shared by the web app and the scheduled execution job.')
@secure()
param scheduledExecutionSecretUri string

@description('Additional Key Vault secret bindings. Keys are Container Apps secret names; values contain envName and a versioned secretUri. Every pre-existing production secret must be represented before deployment because Container Apps treats the secret collection declaratively.')
@secure()
param additionalKeyVaultSecretBindings object = {}

@description('Additional non-secret runtime environment variables. Keys become environment-variable names.')
param additionalEnvironmentVariables object = {}

@description('Existing Azure OpenAI account name. The production identity receives only Cognitive Services OpenAI User on this resource.')
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

@description('Browser-safe Supabase project URL for the production project.')
param supabaseUrl string

@description('Browser-safe Supabase publishable key for the production project.')
@secure()
param supabasePublishableKey string

@description('Canonical public HTTPS origin used for redirects, scheduler calls, and production verification. Do not include a trailing slash.')
param publicBaseUrl string = 'https://kovagpt.com'

@description('Enable production AI generation only after production provider verification.')
param generationEnabled bool = false

@description('Minimum production web replicas.')
@minValue(1)
@maxValue(4)
param minReplicas int = 1

@description('Maximum production web replicas.')
@minValue(1)
@maxValue(10)
param maxReplicas int = 4

@description('Current Cloudflare IPv4 and IPv6 origin CIDRs. The final production deployment must supply at least one current range.')
@minLength(1)
param cloudflareOriginCidrs array

@description('Temporary additional CIDRs allowed to reach the Azure origin during controlled verification. Final evidence must prove this is empty.')
param temporaryOriginVerificationCidrs array = []

@description('Bind custom domains to the Container App using the Key Vault origin certificate.')
param bindCustomDomains bool = false

@description('Custom domains covered by the origin certificate.')
param customDomains array = [
  'kovagpt.com'
  'www.kovagpt.com'
]

@description('Versioned Key Vault secret URI containing a PFX or PEM certificate trusted by Cloudflare for every customDomains entry.')
@secure()
param customDomainCertificateSecretUri string = ''

@description('Name assigned to the Container Apps environment certificate resource.')
param customDomainCertificateName string = 'kovagpt-cloudflare-origin'

@description('Deploy the scheduled Container Apps Job. Keep false until publicBaseUrl routes through Cloudflare to this release.')
param deployScheduledJob bool = false

@description('UTC five-field cron expression for the scheduled execution job.')
param schedulerCronExpression string = '*/1 * * * *'

@description('Maximum scheduler replica runtime in seconds.')
@minValue(60)
@maxValue(3600)
param schedulerTimeoutSeconds int = 300

@description('Maximum scheduler retries after a failed execution.')
@minValue(0)
@maxValue(10)
param schedulerRetryLimit int = 3

@description('Create a monthly resource-group budget.')
param deployBudget bool = false

@description('Monthly budget amount in the subscription billing currency.')
@minValue(1)
param monthlyBudgetAmount int = 100

@description('Budget start date. Must be the first day of a month in ISO UTC format.')
param budgetStartDate string = utcNow('yyyy-MM-01T00:00:00Z')

@description('Budget notification recipients. Required when deployBudget is true.')
param budgetContactEmails array = []

@description('Tags applied to all created resources.')
param tags object = {
  application: 'kovagpt'
  environment: 'production'
  managedBy: 'bicep'
  costCenter: 'kovagpt-production'
}

var webAppName = '${namePrefix}-web'
var scheduledJobResourceName = '${namePrefix}-scheduled-execution'
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
var originCidrs = concat(cloudflareOriginCidrs, temporaryOriginVerificationCidrs)
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
    value: 'production'
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
var schedulerScript = '''
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 55000);
(async () => {
  const endpoint = process.env.KOVA_SCHEDULED_EXECUTION_ENDPOINT;
  const token = process.env.SCHEDULED_TASK_SECRET;
  if (!endpoint || !token) throw new Error('scheduler_configuration_missing');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: '{}',
    signal: controller.signal,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`scheduler_http_${response.status}`);
  console.log(JSON.stringify({ ok: true, status: response.status, responseBytes: Buffer.byteLength(body) }));
})()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'scheduler_execution_failed');
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(timeout));
'''

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

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: managedIdentityName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: managedEnvironmentName
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleDefinitionId)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleDefinitionId
  }
}

resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, keyVaultSecretsUserRoleDefinitionId)
  scope: keyVault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
  }
}

resource azureOpenAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(azureOpenAi.id, identity.id, cognitiveServicesOpenAiUserRoleDefinitionId)
  scope: azureOpenAi
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: cognitiveServicesOpenAiUserRoleDefinitionId
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
        customDomains: bindCustomDomains ? [for domain in customDomains: {
          name: domain
          bindingType: 'SniEnabled'
          certificateId: originCertificate.id
        }] : []
        ipSecurityRestrictions: [for (cidr, index) in originCidrs: {
          name: 'edge-${index}'
          description: index < length(cloudflareOriginCidrs) ? 'Cloudflare edge network' : 'Temporary controlled origin verification'
          ipAddressRange: cidr
          action: 'Allow'
        }]
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
                path: '/api/readyz'
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

resource scheduledJob 'Microsoft.App/jobs@2025-01-01' = if (deployScheduledJob) {
  name: scheduledJobResourceName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: schedulerTimeoutSeconds
      replicaRetryLimit: schedulerRetryLimit
      scheduleTriggerConfig: {
        cronExpression: schedulerCronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        {
          name: 'scheduled-execution-secret'
          keyVaultUrl: scheduledExecutionSecretUri
          identity: identity.id
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
            '-e'
            schedulerScript
          ]
          env: [
            {
              name: 'KOVA_SCHEDULED_EXECUTION_ENDPOINT'
              value: '${publicBaseUrl}/api/internal/scheduled-execution'
            }
            {
              name: 'SCHEDULED_TASK_SECRET'
              secretRef: 'scheduled-execution-secret'
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
  dependsOn: [
    webApp
    acrPull
    keyVaultSecretsUser
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
output customDomainsBound bool = bindCustomDomains
output originCidrsCount int = length(originCidrs)
output temporaryOriginVerificationCidrsCount int = length(temporaryOriginVerificationCidrs)
output managedEnvironmentName string = environment.name
output managedIdentityResourceId string = identity.id
output acrResourceId string = acr.id
output keyVaultResourceId string = keyVault.id
output managedIdentityClientId string = identity.properties.clientId
output azureOpenAiResourceId string = azureOpenAi.id
output logAnalyticsWorkspaceName string = workspace.name
output applicationInsightsName string = appInsights.name
output generationIsEnabled bool = generationEnabled
output deployedSourceSha string = sourceSha
output deployedSourceTree string = sourceTree
