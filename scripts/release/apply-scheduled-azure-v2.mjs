import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const modulePath = "infra/azure/modules/scheduled-worker-job.bicep";
const contractPath = "scripts/azure/template-contract.mjs";
const productionValidatorPath = "scripts/azure/validate-production-template.mjs";
const stagingValidatorPath = "scripts/azure/validate-staging-template.mjs";
const productionTestPath = "tests/unit/azure-production-template.test.mjs";
const stagingTestPath = "tests/unit/azure-staging-template.test.mjs";
const sourceTestPath = "tests/unit/scheduled-azure-v2-source.test.mjs";

const environments = {
  production: {
    path: "infra/azure/production/main.bicep",
    schedulerEnvironment: "production",
    readinessStaleSeconds: 180,
    alertWindowSize: "PT10M",
  },
  staging: {
    path: "infra/azure/staging/main.bicep",
    schedulerEnvironment: "staging",
    readinessStaleSeconds: 600,
    alertWindowSize: "PT15M",
  },
};

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: expected source was not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source was not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${label}: start marker was not found`);
  assert.notEqual(end, -1, `${label}: end marker was not found`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function schedulerParameterBlock(readinessStaleSeconds) {
  return `@description('Maximum scheduler retries after a failed execution.')
@minValue(0)
@maxValue(10)
param schedulerRetryLimit int = ${readinessStaleSeconds === 180 ? 3 : 2}

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
param schedulerReadinessStaleSeconds int = ${readinessStaleSeconds}

@description('Maximum pending or failed delivery backlog accepted as healthy.')
@minValue(0)
@maxValue(10000)
param schedulerMaxDeliveryBacklog int = 100

@description('Deploy Azure Monitor scheduler failure and missing-success alerts.')
param deploySchedulerAlerts bool = false

@description('Azure Monitor action-group resource IDs for scheduler alerts.')
param schedulerAlertActionGroupResourceIds array = []`;
}

function scheduledWorkerModuleBlock(environment, alertWindowSize) {
  return `module scheduledWorker '../modules/scheduled-worker-job.bicep' = if (deployScheduledJob) {
  name: 'scheduled-worker-\${uniqueString(scheduledJobResourceName, sourceSha)}'
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
    schedulerEnvironment: '${environment}'
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
    alertWindowSize: '${alertWindowSize}'
    tags: tags
  }
  dependsOn: [
    acrPull
    keyVaultSecretsUser
    azureOpenAiUser
  ]
}

`;
}

function patchEnvironment(config) {
  let source = readFileSync(config.path, "utf8");
  if (source.includes("module scheduledWorker '../modules/scheduled-worker-job.bicep'")) {
    assert.doesNotMatch(source, /var schedulerScript = '''/u);
    assert.doesNotMatch(source, /KOVA_SCHEDULED_EXECUTION_ENDPOINT/u);
    return false;
  }

  const retryBlock = `@description('Maximum scheduler retries after a failed execution.')
@minValue(0)
@maxValue(10)
param schedulerRetryLimit int = ${config.schedulerEnvironment === "production" ? 3 : 2}`;
  source = replaceOnce(
    source,
    retryBlock,
    schedulerParameterBlock(config.readinessStaleSeconds),
    `${config.schedulerEnvironment} scheduler parameters`,
  );

  source = source.replace(/\nvar schedulerScript = '''[\s\S]*?'''\n\nresource acr /u, "\nresource acr ");
  assert.doesNotMatch(source, /var schedulerScript = '''/u);

  source = replaceRange(
    source,
    "resource scheduledJob 'Microsoft.App/jobs@2025-01-01' = if (deployScheduledJob) {",
    "resource budget 'Microsoft.Consumption/budgets@2024-08-01'",
    scheduledWorkerModuleBlock(config.schedulerEnvironment, config.alertWindowSize),
    `${config.schedulerEnvironment} scheduled worker module`,
  );

  source = replaceOnce(
    source,
    "output scheduledJobName string = deployScheduledJob ? scheduledJobResourceName : ''",
    `output scheduledJobName string = deployScheduledJob ? scheduledJobResourceName : ''
output schedulerAlertsEnabled bool = deployScheduledJob && deploySchedulerAlerts && length(schedulerAlertActionGroupResourceIds) > 0`,
    `${config.schedulerEnvironment} scheduler outputs`,
  );

  assert.match(source, /module scheduledWorker '\.\.\/modules\/scheduled-worker-job\.bicep' = if \(deployScheduledJob\)/u);
  assert.doesNotMatch(source, /KOVA_SCHEDULED_EXECUTION_ENDPOINT|authorization: `Bearer \$\{token\}`/u);
  writeFileSync(config.path, source);
  return true;
}

function patchTemplateContract() {
  let source = readFileSync(contractPath, "utf8");
  if (source.includes('const schedulerModule = readFileSync("infra/azure/modules/scheduled-worker-job.bicep"')) {
    return false;
  }

  source = replaceOnce(
    source,
    `export function validateCommonAzureTemplate({ template, parameters, environment }) {
  const parsedParameters = JSON.parse(parameters);`,
    `export function validateCommonAzureTemplate({ template, parameters, environment }) {
  const schedulerModule = readFileSync("infra/azure/modules/scheduled-worker-job.bicep", "utf8");
  const parsedParameters = JSON.parse(parameters);`,
    "template contract module load",
  );

  source = replaceOnce(
    source,
    `  requireMatch(
    template,
    /resource scheduledJob 'Microsoft\\.App\\/jobs@2025-01-01' = if \\(deployScheduledJob\\)/u,
    \`\${environment} scheduled job is required\`,
  );`,
    `  requireMatch(
    template,
    /module scheduledWorker '\\.\\.\\/modules\\/scheduled-worker-job\\.bicep' = if \\(deployScheduledJob\\)/u,
    \`\${environment} must wire the dedicated scheduled-worker module\`,
  );
  requireMatch(
    schedulerModule,
    /resource scheduledJob 'Microsoft\\.App\\/jobs@2025-01-01'/u,
    "scheduled-worker module must use Container Apps Jobs",
  );`,
    "template contract job module",
  );

  source = replaceRange(
    source,
    `  requireMatch(template, /KOVA_SCHEDULED_EXECUTION_ENDPOINT/u, "scheduled job endpoint is missing");`,
    `  requireMatch(
    template,
    /APPLICATIONINSIGHTS_CONNECTION_STRING/u,`,
    `  rejectMatch(
    template,
    /schedulerScript|KOVA_SCHEDULED_EXECUTION_ENDPOINT|authorization: \\`Bearer/u,
    "HTTP-wrapper scheduled execution is prohibited",
  );
  requireMatch(
    schedulerModule,
    /args: \\[\\s*'dist\\/worker\\/scheduled-v2\\.mjs'\\s*\\]/u,
    "scheduled job must execute the dedicated one-shot worker",
  );
  requireMatch(
    schedulerModule,
    /name: 'KOVA_SCHEDULED_WORKER_ENABLED'[\\s\\S]*?value: '1'/u,
    "scheduled worker must require an explicit enable flag",
  );
  requireMatch(
    schedulerModule,
    /name: 'KOVA_SOURCE_SHA'[\\s\\S]*?value: sourceSha/u,
    "scheduled worker must carry exact source identity",
  );
  requireMatch(schedulerModule, /scheduleTriggerConfig/u, "scheduled trigger configuration is missing");
  requireMatch(
    schedulerModule,
    /cronExpression: cronExpression/u,
    "scheduler cron must be explicit",
  );
  requireMatch(
    schedulerModule,
    /Microsoft\\.Insights\\/scheduledQueryRules@2023-12-01/u,
    "scheduler alert definitions are missing",
  );
  requireMatch(
    schedulerModule,
    /scheduled_worker_failed/u,
    "scheduler failure alert query is missing",
  );
  requireMatch(
    schedulerModule,
    /scheduled_worker_completed/u,
    "scheduler missing-success alert query is missing",
  );
`,
    "template contract HTTP wrapper replacement",
  );

  writeFileSync(contractPath, source);
  return true;
}

function patchValidator(path) {
  let source = readFileSync(path, "utf8");
  if (source.includes("dedicatedScheduledWorker: true")) return false;
  source = replaceOnce(
    source,
    "    scheduledJobDefined: true,",
    "    scheduledJobDefined: true,\n    dedicatedScheduledWorker: true,\n    schedulerAlertsDefined: true,",
    `${path} evidence`,
  );
  writeFileSync(path, source);
  return true;
}

function patchTemplateTest(path) {
  let source = readFileSync(path, "utf8");
  if (source.includes("evidence.dedicatedScheduledWorker")) return false;
  source = replaceOnce(
    source,
    "  assert.equal(evidence.scheduledJobDefined, true);",
    `  assert.equal(evidence.scheduledJobDefined, true);
  assert.equal(evidence.dedicatedScheduledWorker, true);
  assert.equal(evidence.schedulerAlertsDefined, true);`,
    `${path} evidence assertions`,
  );
  writeFileSync(path, source);
  return true;
}

function writeSourceTest() {
  const content = `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleSource = readFileSync("infra/azure/modules/scheduled-worker-job.bicep", "utf8");
const production = readFileSync("infra/azure/production/main.bicep", "utf8");
const staging = readFileSync("infra/azure/staging/main.bicep", "utf8");
const verifier = readFileSync("scripts/azure/verify-scheduled-job-local.sh", "utf8");
const product = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");

test("staging and production both wire the dedicated scheduled worker module", () => {
  for (const source of [production, staging]) {
    assert.match(source, /module scheduledWorker '\\.\\.\\/modules\\/scheduled-worker-job\\.bicep' = if \\(deployScheduledJob\\)/u);
    assert.match(source, /schedulerBatchLimit/u);
    assert.match(source, /schedulerDeliveryBatchLimit/u);
    assert.match(source, /deploySchedulerAlerts/u);
    assert.match(source, /schedulerAlertActionGroupResourceIds/u);
    assert.doesNotMatch(source, /var schedulerScript = '''|KOVA_SCHEDULED_EXECUTION_ENDPOINT/u);
  }
});

test("scheduled worker job executes the immutable non-http worker with least-privilege secrets", () => {
  assert.match(moduleSource, /resource scheduledJob 'Microsoft\\.App\\/jobs@2025-01-01'/u);
  assert.match(moduleSource, /args: \\[\\s*'dist\\/worker\\/scheduled-v2\\.mjs'\\s*\\]/u);
  assert.match(moduleSource, /name: 'KOVA_SCHEDULED_WORKER_ENABLED'[\\s\\S]*?value: '1'/u);
  assert.match(moduleSource, /name: 'KOVA_SOURCE_SHA'[\\s\\S]*?value: sourceSha/u);
  assert.match(moduleSource, /name: 'SUPABASE_SERVICE_ROLE_KEY'[\\s\\S]*?secretRef: 'supabase-service-role-key'/u);
  assert.match(moduleSource, /name: 'KOVA_IP_HASH_SECRET'[\\s\\S]*?secretRef: 'kova-ip-hash-secret'/u);
  assert.doesNotMatch(moduleSource, /scheduled-execution-secret|SCHEDULED_TASK_SECRET|KOVA_SCHEDULED_EXECUTION_ENDPOINT/u);
});

test("scheduler alerts cover terminal failures and missing successful executions", () => {
  assert.match(moduleSource, /Microsoft\\.Insights\\/scheduledQueryRules@2023-12-01/u);
  assert.match(moduleSource, /scheduled_worker_failed/u);
  assert.match(moduleSource, /scheduled_worker_process_failed/u);
  assert.match(moduleSource, /scheduled_worker_completed/u);
  assert.match(moduleSource, /operator: 'LessThan'[\\s\\S]*?threshold: 1/u);
  assert.match(moduleSource, /actionGroups: alertActionGroupResourceIds/u);
});

test("deployed-job verifier is structural by default and canary execution is explicit", () => {
  assert.match(verifier, /KOVA_SCHEDULER_RUN_CANARY:-0/u);
  assert.match(verifier, /dist\\/worker\\/scheduled-v2\\.mjs/u);
  assert.match(verifier, /KOVA_SCHEDULED_WORKER_ENABLED/u);
  assert.match(verifier, /KOVA_EXPECTED_SOURCE_SHA/u);
  assert.doesNotMatch(verifier, /api\\/internal\\/scheduled-execution|definitely-invalid/u);
});

test("Azure source wiring does not make the product claim scheduler readiness", () => {
  assert.match(product, /export const scheduledExecutionAvailable = false;/u);
});
`;
  writeFileSync(sourceTestPath, content);
}

const changed = [];
for (const config of Object.values(environments)) {
  if (patchEnvironment(config)) changed.push(config.path);
}
if (patchTemplateContract()) changed.push(contractPath);
if (patchValidator(productionValidatorPath)) changed.push(productionValidatorPath);
if (patchValidator(stagingValidatorPath)) changed.push(stagingValidatorPath);
if (patchTemplateTest(productionTestPath)) changed.push(productionTestPath);
if (patchTemplateTest(stagingTestPath)) changed.push(stagingTestPath);
writeSourceTest();
changed.push(sourceTestPath);

assert.match(readFileSync(modulePath, "utf8"), /dist\/worker\/scheduled-v2\.mjs/u);
console.log(`KOVAGPT_SCHEDULED_AZURE_V2_APPLIED=${changed.length}`);
for (const path of changed) console.log(path);
