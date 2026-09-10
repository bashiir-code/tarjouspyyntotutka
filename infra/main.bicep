// Search + embedding deployment for Tarjouspyyntötutka on an existing Foundry (AIServices) account.
// az deployment group create -g ai103-learning -f infra/main.bicep -p foundryName=ai103-bashiir-2947

param location string = resourceGroup().location
param foundryName string
param searchName string = 'hilma-search-${uniqueString(resourceGroup().id)}'
@allowed(['free', 'basic', 'standard'])
param searchSku string = 'free'
param embeddingDeployment string = 'text-embedding-3-small'

resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: foundryName
}

// GlobalStandard for this model returned DeploymentNotFound at inference time in swedencentral;
// Standard is not offered there. DataZoneStandard works and keeps processing inside the EU.
resource embedding 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundry
  name: embeddingDeployment
  sku: { name: 'DataZoneStandard', capacity: 120 }
  properties: {
    model: { format: 'OpenAI', name: 'text-embedding-3-small', version: '1' }
  }
}

resource search 'Microsoft.Search/searchServices@2024-06-01-preview' = {
  name: searchName
  location: location
  sku: { name: searchSku }
  properties: {
    replicaCount: 1
    partitionCount: 1
    semanticSearch: 'free'
  }
}

output searchEndpoint string = 'https://${search.name}.search.windows.net'
output foundryEndpoint string = foundry.properties.endpoint
