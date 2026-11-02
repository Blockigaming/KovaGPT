// Additive host deployment only. Never declares or updates an existing app,
// worker, registry, production vault or production managed identity.
targetScope = 'resourceGroup'

@allowed(['eastus'])
param location string = 'eastus'

@minLength(3)
@maxLength(24)
param namePrefix string = 'kovagpt-work-540'

@minLength(3)
@maxLength(63)
param dnsLabel string

@description('Exact Canonical Ubuntu 24.04 LTS server Gen2 image version. Resolve and validate before deployment; never use latest.')
param imageVersion string

@description('Public SSH key only. Public SSH is denied; recovery uses the existing authorized Azure management plane.')
param adminPublicKey string

@secure()
@minLength(64)
param runnerToken string

@secure()
@minLength(64)
param runnerSigningKey string

@secure()
@minLength(16)
param providerKey string

var tags = {
  application: 'KovaGPT'
  purpose: 'isolated-work-browser'
  ownerScope: 'work-host-540'
}
var secretDefinitions = [
  {
    name: 'runner-token'
    value: runnerToken
  }
  {
    name: 'runner-signing-key'
    value: runnerSigningKey
  }
  {
    name: 'provider-key'
    value: providerKey
  }
]

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${namePrefix}-ip'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Regional'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
    dnsSettings: { domainNameLabel: dnsLabel }
  }
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${namePrefix}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowHttpsOnly'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: 'Internet'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'DenyOtherInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${namePrefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.196.0.0/24'] }
    subnets: [{
      name: 'runner'
      properties: {
        addressPrefix: '10.196.0.0/24'
        networkSecurityGroup: { id: nsg.id }
      }
    }]
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${namePrefix}-nic'
  location: location
  tags: tags
  properties: {
    networkSecurityGroup: { id: nsg.id }
    ipConfigurations: [{
      name: 'primary'
      properties: {
        primary: true
        privateIPAllocationMethod: 'Dynamic'
        subnet: { id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'runner') }
        publicIPAddress: { id: publicIp.id }
      }
    }]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${namePrefix}-vm'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: 'Standard_D2as_v4' }
    securityProfile: {
      securityType: 'TrustedLaunch'
      uefiSettings: {
        secureBootEnabled: true
        vTpmEnabled: true
      }
    }
    osProfile: {
      computerName: '${namePrefix}-vm'
      adminUsername: 'kovaworkadmin'
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: { publicKeys: [{
          path: '/home/kovaworkadmin/.ssh/authorized_keys'
          keyData: adminPublicKey
        }] }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: imageVersion
      }
      osDisk: {
        name: '${namePrefix}-os'
        createOption: 'FromImage'
        caching: 'ReadWrite'
        diskSizeGB: 32
        // Retain private state if the VM is removed; disk charges continue.
        deleteOption: 'Detach'
        managedDisk: { storageAccountType: 'Premium_LRS' }
      }
    }
    networkProfile: { networkInterfaces: [{
      id: nic.id
      properties: {
        primary: true
        deleteOption: 'Detach'
      }
    }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: false } }
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kvkw${uniqueString(resourceGroup().id, namePrefix)}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    accessPolicies: []
  }
}

resource runnerSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = [for item in secretDefinitions: {
  parent: vault
  name: item.name
  properties: {
    value: item.value
    attributes: { enabled: true }
  }
}]

// Each grant covers one new secret, never the existing production vault.
resource secretReaders 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (item, index) in secretDefinitions: {
  name: guid(vm.id, runnerSecrets[index].id, 'KeyVaultSecretsUser')
  scope: runnerSecrets[index]
  properties: {
    principalId: vm.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}]

output vmId string = vm.id
output vmName string = vm.name
output hostPrincipalId string = vm.identity.principalId
output hostname string = publicIp.properties.dnsSettings.fqdn
output publicIpAddress string = publicIp.properties.ipAddress
output vaultName string = vault.name
// Versioned references only; no credential values in deployment outputs.
output secretUris array = [for (item, index) in secretDefinitions: {
  name: item.name
  uri: runnerSecrets[index].properties.secretUriWithVersion
}]
