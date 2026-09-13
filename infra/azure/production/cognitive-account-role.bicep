targetScope = 'resourceGroup'

@description('Existing Cognitive Services account that receives the resource-scoped assignment.')
param accountName string

@description('Object ID of the existing user-assigned managed identity.')
param principalId string

@description('Resource ID of the existing user-assigned managed identity, used only for deterministic naming.')
param identityResourceId string

@description('Subscription-scoped built-in role definition resource ID.')
param roleDefinitionId string

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: accountName
}

resource accountRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, identityResourceId, roleDefinitionId)
  scope: account
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: roleDefinitionId
  }
}

output roleAssignmentId string = accountRole.id
