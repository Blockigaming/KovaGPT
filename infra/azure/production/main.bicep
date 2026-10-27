// Migration-frozen template only. It disables ingress and uses Single revision
// mode, so never apply or plan it against the existing live direct Azure app.
// The production PLAN workflow rejects that live topology before what-if.
targetScope = 'resourceGroup'

@description('Azure region for production resources.')
param location string = resourceGroup().location

@description('Short lowercase prefix used for generated resource names.')
@minLength(3)
@maxLength(24)
param namePrefix string = 'kovagpt-prod'

@description('Exact name of the inventoried existing production Container App. Never derive a deployment target from namePrefix.')
param containerAppName string

@description('Existing production Container Apps managed environment.')
param managedEnvironmentName string = 'cae-kovagpt-prod'

@description('Existing production user-assigned managed identity.')
param managedIdentityName string = 'id-kovagpt-prod'

@description('Existing production Log Analytics workspace.')
param logAnalyticsWorkspaceName string = 'log-kovagpt-prod'

@description('Immutable ACR image reference built and verified with the production browser Supabase configuration. Supply repository@sha256:digest, never a mutable tag.')
param imageReference string

@description('Existing Azure Container Registry name.')
param acrName string = 'kovagptacr'

@description('Resource group containing the existing ACR.')
param acrResourceGroupName string = resourceGroup().name

@description('Existing production Key Vault name used only for server-side credentials.')
param keyVaultName string

@description('Resource group containing the existing Key Vault.')
param keyVaultResourceGroupName string = resourceGroup().name

@description('Versioned Key Vault secret URI for SUPABASE_SERVICE_ROLE_KEY.')
@secure()
param supabaseServiceRoleSecretUri string

@description('Versioned Key Vault secret URI for anonymous generation IP hashing.')
@secure()
param kovaIpHashSecretUri string

@description('Select the text provider explicitly. auto preserves endpoint-based routing; direct OpenAI requires the existing key reference below.')
@allowed([
  'auto'
  'openai'
  'azure_openai'
])
param textProvider string = 'auto'

@description('Optional versioned existing Key Vault URI for OPENAI_API_KEY. Required when textProvider is openai; never pass a raw API key.')
@secure()
param openAiApiKeySecretUri string = ''

// Optional voice configuration only. Defaults preserve the disabled runtime.
@description('Existing versioned Key Vault URI for ELEVENLABS_API_KEY. Never pass a raw key; leave empty while unconfigured.')
@secure()
param elevenLabsApiKeySecretUri string = ''

@description('Owner-selected accessible ElevenLabs voice ID; no default voice is assumed.')
param elevenLabsVoiceId string = ''

@description('Owner-reviewed voice catalog entries: id, label, providerVoiceId, allowedPlans and optional showWhenLocked. Empty preserves single-voice compatibility; no plan mapping is supplied.')
@maxLength(32)
param voiceCatalog array = []

@description('Optional preferred catalog ID. Must exist in the explicit catalog; each account falls back to its first allowed catalog entry.')
param voiceDefaultId string = ''

@description('Saved-response Read aloud only. Defaults off, is separate from browser voice and microphone permission, and still obeys the generation kill switch. Activate only after existing key/model/voice entitlement is confirmed.')
param speechEnabled bool = false

@description('Enable only after the separate owner-approved voice activation checks. Does not alter ingress, replicas or the database feature flag.')
param voiceEnabled bool = false

@description('Explicit audio/STT/STS activation. Keep false until recording and provider acceptance checks are authorized.')
param voiceAudioEnabled bool = false

@description('Owner-selected per-user UTC-day request cap, not a currency budget. Zero keeps voice unavailable.')
@minValue(0)
param voiceDailyRequestLimit int = 0

@description('Keep billing disabled until the reviewed migration, webhook drain, account provenance, trial policy, and smoke gates pass.')
@allowed([
  'disabled'
  'durable'
])
param stripeBillingRuntime string = 'disabled'

@description('Approved public Stripe account identity; secret and build-time keys require independent account matching.')
@allowed([
  'acct_1UAeDgAEZlsb6DBY'
])
param stripeLiveAccountId string = 'acct_1UAeDgAEZlsb6DBY'

@description('Existing owner-approved Portal configuration. No Portal settings are changed by this template.')
@allowed([
  'bpc_1UB2ZxAEZlsb6DBYU3PoJJPU'
])
param stripeBillingPortalConfigurationId string = 'bpc_1UB2ZxAEZlsb6DBYU3PoJJPU'

@description('Exact server-selected Checkout and Portal return origin. Empty keeps billing returns unavailable; select the direct Azure origin while Cloudflare is out of path.')
@allowed([
  ''
  'https://kovagpt.com'
  'https://kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io'
])
param billingReturnOrigin string = ''

@description('Versioned existing Key Vault URI for STRIPE_LIVE_API_KEY; leave empty while unconfigured.')
@secure()
param stripeLiveApiKeySecretUri string = ''

@description('Versioned existing Key Vault URI for PAYMENTS_LIVE_WEBHOOK_SECRET; leave empty while unconfigured.')
@secure()
param stripeLiveWebhookSecretUri string = ''

@description('Optional versioned existing Key Vault URI for STRIPE_SANDBOX_API_KEY, required to retire historical sandbox Customers.')
@secure()
param stripeSandboxApiKeySecretUri string = ''

@description('Optional versioned existing Key Vault URI for PAYMENTS_SANDBOX_WEBHOOK_SECRET.')
@secure()
param stripeSandboxWebhookSecretUri string = ''

@description('Existing Azure OpenAI account name. The production identity receives only Cognitive Services OpenAI User on this resource.')
param azureOpenAiAccountName string

@description('Resource group containing the existing Azure OpenAI account.')
param azureOpenAiResourceGroupName string = resourceGroup().name

@description('Existing dedicated Azure OpenAI account for image generation. Leave empty to use the primary account.')
param azureOpenAiImageAccountName string = ''

@description('Resource group containing the optional dedicated image Azure OpenAI account.')
param azureOpenAiImageResourceGroupName string = azureOpenAiResourceGroupName

@description('Optional versioned Key Vault secret URI for AZURE_OPENAI_IMAGE_API_KEY. Leave empty to use managed identity.')
@secure()
param azureOpenAiImageApiKeySecretUri string = ''

@description('Azure OpenAI deployment used for Luna/normal chat.')
param azureOpenAiChatDeployment string = 'kova-chat'

@description('Azure OpenAI deployment used for Terra/thinking requests.')
param azureOpenAiThinkingDeployment string = 'kova-think'

@description('Azure OpenAI deployment used for Sol/deep reasoning requests.')
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

@description('One active Cloudflare per-hostname Authenticated Origin Pull client-certificate SHA-256 fingerprint, or two during a zero-downtime rotation. Use uppercase or lowercase hexadecimal, with optional colons.')
@minLength(1)
@maxLength(2)
param cloudflareClientCertificateSha256Fingerprints array

@description('Enable production AI generation only after production provider verification.')
param generationEnabled bool = false

@description('Migration cost freeze: production must remain scaled to zero until a separately reviewed Azure activation change.')
@allowed([
  0
])
param minReplicas int = 0

@description('Maximum production web replicas.')
@minValue(1)
@maxValue(4)
param maxReplicas int = 4

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

// App-local secret names only; existing Key Vault secret names/versions come
// from protected parameters and are never guessed or created here.
var stripeSecretSettings = [
  {
    name: 'stripe-live-api-key'
    envName: 'STRIPE_LIVE_API_KEY'
    uri: stripeLiveApiKeySecretUri
  }
  {
    name: 'stripe-live-webhook'
    envName: 'PAYMENTS_LIVE_WEBHOOK_SECRET'
    uri: stripeLiveWebhookSecretUri
  }
  {
    name: 'stripe-sandbox-key'
    envName: 'STRIPE_SANDBOX_API_KEY'
    uri: stripeSandboxApiKeySecretUri
  }
  {
    name: 'stripe-test-webhook'
    envName: 'PAYMENTS_SANDBOX_WEBHOOK_SECRET'
    uri: stripeSandboxWebhookSecretUri
  }
]
var configuredStripeSecrets = filter(stripeSecretSettings, setting => !empty(setting.uri))
var stripeSecretReferences = [for setting in configuredStripeSecrets: {
  name: setting.name
  keyVaultUrl: setting.uri
  identity: identity.id
}]
var stripeSecretEnvironment = [for setting in configuredStripeSecrets: {
  name: setting.envName
  secretRef: setting.name
}]

var appInsightsName = '${namePrefix}-insights'
var budgetName = '${namePrefix}-monthly-budget'
var useDedicatedAzureOpenAiImage = !empty(azureOpenAiImageAccountName)
var useAzureOpenAiImageApiKey = useDedicatedAzureOpenAiImage && !empty(azureOpenAiImageApiKeySecretUri)
var useAzureOpenAiImageManagedIdentity = useDedicatedAzureOpenAiImage && !useAzureOpenAiImageApiKey
var useDirectOpenAiApiKey = !empty(openAiApiKeySecretUri)
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

resource azureOpenAiImage 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (useDedicatedAzureOpenAiImage) {
  name: azureOpenAiImageAccountName
  scope: resourceGroup(azureOpenAiImageResourceGroupName)
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: managedIdentityName
}

module azureOpenAiImageAccess 'cognitive-account-role.bicep' = if (useAzureOpenAiImageManagedIdentity) {
  name: 'azure-openai-image-access'
  scope: resourceGroup(azureOpenAiImageResourceGroupName)
  params: {
    accountName: azureOpenAiImageAccountName
    principalId: identity.properties.principalId
    identityResourceId: identity.id
    roleDefinitionId: cognitiveServicesOpenAiUserRoleDefinitionId
  }
}
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
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

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: managedEnvironmentName
}

resource webApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: containerAppName
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
      // No ingress during migration: HTTP traffic must not wake a replica.
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: concat([
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
      ], stripeSecretReferences, !empty(elevenLabsApiKeySecretUri) ? [{
        name: 'elevenlabs-api-key'
        keyVaultUrl: elevenLabsApiKeySecretUri
        identity: identity.id
      }] : [], useDirectOpenAiApiKey ? [
        {
          name: 'openai-api-key'
          keyVaultUrl: openAiApiKeySecretUri
          identity: identity.id
        }
      ] : [], useAzureOpenAiImageApiKey ? [
        {
          name: 'azure-openai-image-api-key'
          keyVaultUrl: azureOpenAiImageApiKeySecretUri
          identity: identity.id
        }
      ] : [])
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
          env: concat([
            {
              name: 'KOVA_SPEECH_ENABLED'
              value: speechEnabled ? 'true' : 'false'
            }
            {
              name: 'KOVA_VOICE_ENABLED'
              value: voiceEnabled ? 'true' : 'false'
            }
            {
              name: 'KOVA_VOICE_AUDIO_ENABLED'
              value: voiceAudioEnabled ? 'true' : 'false'
            }
            {
              name: 'KOVA_VOICE_DAILY_REQUEST_LIMIT'
              value: string(voiceDailyRequestLimit)
            }
            {
              name: 'ELEVENLABS_VOICE_ID'
              value: elevenLabsVoiceId
            }
            {
              name: 'STRIPE_BILLING_RUNTIME'
              value: stripeBillingRuntime
            }
            {
              name: 'STRIPE_LIVE_ACCOUNT_ID'
              value: stripeLiveAccountId
            }
            {
              name: 'STRIPE_BILLING_PORTAL_CONFIGURATION_ID'
              value: stripeBillingPortalConfigurationId
            }
            {
              name: 'KOVA_BILLING_RETURN_ORIGIN'
              value: billingReturnOrigin
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'AZURE_ENVIRONMENT'
              value: 'production'
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
              name: 'SUPABASE_PUBLISHABLE_KEY'
              value: supabasePublishableKey
            }
            {
              name: 'SUPABASE_SERVICE_ROLE_KEY'
              secretRef: 'supabase-service-role-key'
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
              name: 'KOVA_TEXT_PROVIDER'
              value: textProvider
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
              name: 'KOVA_IP_HASH_SECRET'
              secretRef: 'kova-ip-hash-secret'
            }
            {
              name: 'KOVA_CLOUDFLARE_CLIENT_CERT_SHA256_FINGERPRINTS'
              value: join(cloudflareClientCertificateSha256Fingerprints, ',')
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
          ], stripeSecretEnvironment, !empty(voiceCatalog) ? [{
            name: 'KOVA_VOICE_CATALOG'
            value: string(voiceCatalog)
          }] : [], !empty(voiceDefaultId) ? [{
            name: 'KOVA_VOICE_DEFAULT_ID'
            value: voiceDefaultId
          }] : [], !empty(elevenLabsApiKeySecretUri) ? [{
            name: 'ELEVENLABS_API_KEY'
            secretRef: 'elevenlabs-api-key'
          }] : [], useDirectOpenAiApiKey ? [
            {
              name: 'OPENAI_API_KEY'
              secretRef: 'openai-api-key'
            }
          ] : [], useDedicatedAzureOpenAiImage ? [
            {
              name: 'AZURE_OPENAI_IMAGE_ENDPOINT'
              value: azureOpenAiImage.properties.endpoint
            }
          ] : [], useAzureOpenAiImageApiKey ? [
            {
              name: 'AZURE_OPENAI_IMAGE_API_KEY'
              secretRef: 'azure-openai-image-api-key'
            }
          ] : [])
          probes: [
            {
              type: 'Startup'
              tcpSocket: {
                port: 3000
              }
              initialDelaySeconds: 1
              periodSeconds: 2
              timeoutSeconds: 1
              failureThreshold: 60
            }
            {
              type: 'Liveness'
              tcpSocket: {
                port: 3000
              }
              initialDelaySeconds: 20
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              tcpSocket: {
                port: 3000
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
        rules: []
      }
    }
  }
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
// No public hostname exists while migration ingress is disabled.
output containerAppFqdn string = ''
output managedEnvironmentName string = environment.name
output managedIdentityResourceId string = identity.id
output managedIdentityClientId string = identity.properties.clientId
output azureOpenAiResourceId string = azureOpenAi.id
output azureOpenAiImageResourceId string = useDedicatedAzureOpenAiImage ? azureOpenAiImage.id : azureOpenAi.id
output logAnalyticsWorkspaceName string = workspace.name
output applicationInsightsName string = appInsights.name
output generationIsEnabled bool = generationEnabled
