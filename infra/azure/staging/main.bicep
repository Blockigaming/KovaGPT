targetScope = 'resourceGroup'

@description('Azure region for staging resources.')
param location string = resourceGroup().location

@description('Short lowercase prefix used for generated resource names.')
@minLength(3)
@maxLength(24)
param namePrefix string = 'kovagpt-stg'

@description('Immutable ACR image reference. Supply repository@sha256:digest, never a mutable tag.')
param imageReference string

@description('Existing Azure Container Registry name.')
param acrName string = 'kovagptacr'

@description('Resource group containing the existing ACR.')
param acrResourceGroupName string = resourceGroup().name

@description('Existing Key Vault name. Secret values are never accepted by this template.')
param keyVaultName string

@description('Resource group containing the existing Key Vault.')
param keyVaultResourceGroupName string = resourceGroup().name

@description('Versioned or versionless Key Vault secret URI for OPENAI_API_KEY.')
@secure()
param openAiSecretUri string

@description('Versioned or versionless Key Vault secret URI for SUPABASE_SERVICE_ROLE_KEY.')
@secure()
param supabaseServiceRoleSecretUri string

@description('Browser-safe Supabase project URL for the synthetic staging project.')
param supabaseUrl string

@description('Browser-safe Supabase publishable key for the synthetic staging project.')
@secure()
param supabasePublishableKey string

@description('Generation remains disabled until owner-approved staging provider smoke tests.')
param generationEnabled bool = false

@description('Minimum web replicas. Zero minimizes idle staging cost.')
@minValue(0)
@maxValue(1)
param minReplicas int = 0

@description('Maximum web replicas for staging cost containment.')
@minValue(1)
@maxValue(4)
param maxReplicas int = 2

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

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
  scope: resourceGroup(acrResourceGroupName)
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
  scope: resourceGroup(keyVaultResourceGroupName)
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
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
      secrets: [
        {
          name: 'openai-api-key'
          keyVaultUrl: openAiSecretUri
          identity: identity.id
        }
        {
          name: 'supabase-service-role-key'
          keyVaultUrl: supabaseServiceRoleSecretUri
          identity: identity.id
        }
      ]
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
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'AZURE_ENVIRONMENT'
              value: 'staging'
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
              name: 'SUPABASE_URL'
              value: supabaseUrl
            }
            {
              name: 'VITE_SUPABASE_URL'
              value: supabaseUrl
            }
            {
              name: 'SUPABASE_PUBLISHABLE_KEY'
              value: supabasePublishableKey
            }
            {
              name: 'VITE_SUPABASE_PUBLISHABLE_KEY'
              value: supabasePublishableKey
            }
            {
              name: 'SUPABASE_SERVICE_ROLE_KEY'
              secretRef: 'supabase-service-role-key'
            }
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-api-key'
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
          probes: [
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
                path: '/api/health'
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
output managedEnvironmentName string = environment.name
output managedIdentityResourceId string = identity.id
output logAnalyticsWorkspaceName string = workspace.name
output applicationInsightsName string = appInsights.name
output generationIsEnabled bool = generationEnabled
