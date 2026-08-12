#!/usr/bin/env node
/**
 * TPT WireMock stub generator
 *
 * Fetches the Nais GraphQL schema via `nais api schema`, validates that all
 * fields the backend depends on are still present, then generates WireMock
 * stub JSON files for:
 *   - Nais GraphQL API  (scenario-cycling, N variations)
 *   - GCVE REST API     (scenario-cycling, N variations)
 *   - Teamkatalogen     (static stubs)
 *
 * Usage:
 *   node scripts/generate-mocks.js [--config mocks/mock-config.yaml]
 *
 * Requires: nais CLI (authenticated), Node.js 24+
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { buildSchema } from 'graphql'
import {
  generateTeamSlugs,
  buildUserVulnsPayload,
  buildTeamVulnsPayload,
  buildTeamMembershipsPayload,
  buildAllTeamsPayload,
  buildGcveCveRecord,
  scenarioStates,
  naisStub,
  gcveByIdStub,
  gcveNotFoundStub,
  gcveListStub,
  teamkatalogenMembershipStub,
  teamkatalogenTeamsByProductAreaStub,
  teamkatalogenTeamsByClusterStub,
} from './generate-mocks-builders.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const configArg = process.argv.indexOf('--config')
const configPath = configArg !== -1
  ? resolve(process.cwd(), process.argv[configArg + 1])
  : resolve(ROOT, 'mocks/mock-config.yaml')

const config = yaml.load(readFileSync(configPath, 'utf8'))

const MAPPINGS_DIR = resolve(ROOT, 'local-dev/wiremock/mappings')
const SCHEMAS_DIR  = resolve(ROOT, 'schemas')

// ---------------------------------------------------------------------------
// Section 1: Fetch and validate Nais GraphQL schema
// ---------------------------------------------------------------------------

console.log('Fetching Nais GraphQL schema via `nais api schema`...')

let schemaSDL
try {
  const raw = execSync('nais api schema 2>/dev/null', { encoding: 'utf8', timeout: 30_000 })
  // The nais CLI sometimes emits WARNING/ERROR lines to stdout before the schema.
  // Strip everything before the first line that looks like GraphQL SDL.
  const lines = raw.split('\n')
  const sdlStart = lines.findIndex(l => l.trimStart().startsWith('"""') || l.trimStart().startsWith('type ') || l.trimStart().startsWith('schema ') || l.trimStart().startsWith('interface ') || l.trimStart().startsWith('scalar ') || l.trimStart().startsWith('enum ') || l.trimStart().startsWith('input ') || l.trimStart().startsWith('union ') || l.trimStart().startsWith('directive '))
  if (sdlStart === -1) {
    console.error('\nThe output of `nais api schema` does not look like a GraphQL SDL.')
    console.error('Ensure you are logged in: nais login')
    console.error('Raw output:', raw.slice(0, 500))
    process.exit(1)
  }
  schemaSDL = lines.slice(sdlStart).join('\n')
} catch (err) {
  console.error('\nFailed to fetch Nais GraphQL schema.')
  console.error('Ensure you are logged in: nais login')
  console.error(err.message)
  process.exit(1)
}

writeFileSync(resolve(SCHEMAS_DIR, 'nais-api.graphql'), schemaSDL)
console.log('  Schema written to schemas/nais-api.graphql')

// Fields the backend reads — derived directly from GraphQLModels.kt.
// If any of these are missing from the schema the backend WILL break.
// Format: "TypeName.fieldName"
const REQUIRED_FIELDS = [
  // Query root
  'Query.user',
  'Query.team',
  'Query.teams',
  // User type
  'User.teams',
  // Team member connection (User.teams returns TeamMemberConnection)
  'TeamMemberConnection.nodes',
  'TeamMemberConnection.pageInfo',
  // TeamMember node
  'TeamMember.team',
  // Team
  'Team.slug',
  'Team.applications',
  'Team.jobs',
  'Team.slackChannel',
  // Application (= "App" in Kotlin models)
  'Application.id',
  'Application.name',
  'Application.ingresses',
  'Application.deployments',
  'Application.image',
  // ApplicationConnection
  'ApplicationConnection.nodes',
  'ApplicationConnection.pageInfo',
  // Job
  'Job.id',
  'Job.name',
  'Job.deployments',
  'Job.image',
  // JobConnection
  'JobConnection.nodes',
  'JobConnection.pageInfo',
  // Ingress
  'Ingress.type',
  // DeploymentConnection
  'DeploymentConnection.nodes',
  // Deployment
  'Deployment.repository',
  'Deployment.environmentName',
  'Deployment.createdAt',
  // ContainerImage (= "Image" in Kotlin models)
  'ContainerImage.name',
  'ContainerImage.tag',
  'ContainerImage.vulnerabilities',
  // ImageVulnerabilityConnection (= "Vulnerabilities" in Kotlin models)
  'ImageVulnerabilityConnection.nodes',
  'ImageVulnerabilityConnection.pageInfo',
  // ImageVulnerability (= "Vulnerability" in Kotlin models)
  'ImageVulnerability.identifier',
  'ImageVulnerability.severity',
  'ImageVulnerability.package',
  'ImageVulnerability.description',
  'ImageVulnerability.vulnerabilityDetailsLink',
  'ImageVulnerability.suppression',
  // ImageVulnerabilitySuppression (= "Suppression" in Kotlin models)
  'ImageVulnerabilitySuppression.state',
  // PageInfo
  'PageInfo.hasNextPage',
  'PageInfo.endCursor',
  // TeamConnection (for TeamInformation / getAllTeams query)
  'TeamConnection.nodes',
  'TeamConnection.pageInfo',
]

console.log('Validating schema against required backend fields...')
let schema
try {
  schema = buildSchema(schemaSDL)
} catch (err) {
  console.error('\nFailed to parse Nais GraphQL schema SDL:')
  console.error(err.message)
  process.exit(1)
}

const typeMap = schema.getTypeMap()
const broken = []

for (const required of REQUIRED_FIELDS) {
  const [typeName, fieldName] = required.split('.')
  const type = typeMap[typeName]
  if (!type) {
    broken.push(`  Type "${typeName}" not found in schema (needed for ${typeName}.${fieldName})`)
    continue
  }
  if (typeof type.getFields !== 'function') {
    broken.push(`  Type "${typeName}" has no fields (is it a scalar or enum?)`)
    continue
  }
  const fields = type.getFields()
  if (!fields[fieldName]) {
    broken.push(`  Field "${fieldName}" missing from type "${typeName}"`)
  }
}

if (broken.length > 0) {
  console.error('\nBREAKING SCHEMA CHANGE DETECTED')
  console.error('The following fields used by tpt-backend are no longer in the Nais GraphQL schema:')
  broken.forEach(b => console.error(b))
  console.error('\nThis means the Nais API has changed in a way that will break tpt-backend.')
  console.error('Update tpt-backend\'s GraphQL queries and models, then re-run this generator.')
  process.exit(1)
}

console.log(`  All ${REQUIRED_FIELDS.length} required fields present. Schema is compatible.`)

// ---------------------------------------------------------------------------
// Section 2: Generate a shared team slug set
//
// All membership and user-vulnerability stubs are built from the same slug
// array so the backend can resolve teams from membership stubs and then find
// vulnerability data for those exact teams.
// ---------------------------------------------------------------------------

const teamSlugs = generateTeamSlugs(config.nais.teams)

// ---------------------------------------------------------------------------
// Section 3: Write stubs to disk
// ---------------------------------------------------------------------------

function writeStub(dir, filename, stub) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, filename), JSON.stringify(stub, null, 2) + '\n')
}

let stubCount = 0

function write(dir, filename, stub) {
  writeStub(dir, filename, stub)
  stubCount++
}

const variations = config.nais.variations
const naisStates = scenarioStates(variations)
const gcveStates = scenarioStates(config.gcve.variations)

const NAIS_DIR = resolve(MAPPINGS_DIR, 'nais')
const GCVE_DIR = resolve(MAPPINGS_DIR, 'gcve')
const TK_DIR   = resolve(MAPPINGS_DIR, 'teamkatalogen')

console.log('\nGenerating Nais stubs...')

// ApplicationVulnerabilitiesForUser
for (let v = 1; v <= variations; v++) {
  write(NAIS_DIR, `app-vulns-for-user-${v}.json`, naisStub({
    scenarioName: 'nais-app-vulns-for-user',
    variation: v,
    states: naisStates,
    operationName: 'ApplicationVulnerabilitiesForUser',
    responseBody: buildUserVulnsPayload(config, teamSlugs),
  }))
}

// JobVulnerabilitiesForUser
for (let v = 1; v <= variations; v++) {
  write(NAIS_DIR, `job-vulns-for-user-${v}.json`, naisStub({
    scenarioName: 'nais-job-vulns-for-user',
    variation: v,
    states: naisStates,
    operationName: 'JobVulnerabilitiesForUser',
    responseBody: buildUserVulnsPayload(config, teamSlugs),
  }))
}

// ApplicationVulnerabilitiesForTeam
for (let v = 1; v <= variations; v++) {
  write(NAIS_DIR, `app-vulns-for-team-${v}.json`, naisStub({
    scenarioName: 'nais-app-vulns-for-team',
    variation: v,
    states: naisStates,
    operationName: 'ApplicationVulnerabilitiesForTeam',
    responseBody: buildTeamVulnsPayload(config),
  }))
}

// JobVulnerabilitiesForTeam
for (let v = 1; v <= variations; v++) {
  write(NAIS_DIR, `job-vulns-for-team-${v}.json`, naisStub({
    scenarioName: 'nais-job-vulns-for-team',
    variation: v,
    states: naisStates,
    operationName: 'JobVulnerabilitiesForTeam',
    responseBody: buildTeamVulnsPayload(config),
  }))
}

// TeamMembershipsForUser (static — no cycling needed)
write(NAIS_DIR, 'team-memberships.json', {
  priority: 1,
  request: {
    method: 'POST',
    urlPath: '/nais/query',
    bodyPatterns: [{ contains: 'TeamMembershipsForUser' }],
  },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    jsonBody: buildTeamMembershipsPayload(config, teamSlugs),
  },
})
stubCount++

// TeamInformation (all teams — admin query)
write(NAIS_DIR, 'all-teams.json', {
  priority: 1,
  request: {
    method: 'POST',
    urlPath: '/nais/query',
    bodyPatterns: [{ contains: 'TeamInformation' }],
  },
  response: {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    jsonBody: buildAllTeamsPayload(config),
  },
})
stubCount++

console.log(`  Written ${variations * 4 + 2} Nais stubs`)

// GCVE stubs
console.log('Generating GCVE stubs...')

for (let v = 1; v <= config.gcve.variations; v++) {
  write(GCVE_DIR, `cve-by-id-${v}.json`, gcveByIdStub({
    variation: v,
    states: gcveStates,
    responseBody: buildGcveCveRecord(),
  }))
}

const listRecords = Array.from({ length: config.gcve.list_size }, buildGcveCveRecord)
write(GCVE_DIR, 'cve-list.json', gcveListStub(listRecords))
write(GCVE_DIR, 'cve-not-found.json', gcveNotFoundStub())

console.log(`  Written ${config.gcve.variations + 2} GCVE stubs`)

// Teamkatalogen stubs
console.log('Generating Teamkatalogen stubs...')

write(TK_DIR, 'membership-by-email.json', teamkatalogenMembershipStub(config, teamSlugs))
write(TK_DIR, 'teams-by-product-area.json', teamkatalogenTeamsByProductAreaStub(config))
write(TK_DIR, 'teams-by-cluster.json', teamkatalogenTeamsByClusterStub(config))

console.log(`  Written 3 Teamkatalogen stubs`)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`
Done. ${stubCount} stubs written to local-dev/wiremock/mappings/
  nais/          ${variations * 4 + 2} stubs (${variations} scenario variations × 4 operations + 2 static)
  gcve/          ${config.gcve.variations + 2} stubs (${config.gcve.variations} CVE variations + list + 404)
  teamkatalogen/ 3 stubs (membership, by-product-area, by-cluster)

Team slugs used across all membership and user-vulnerability stubs: ${teamSlugs.join(', ')}

WireMock admin UI (when running): http://localhost:9090/__admin/mappings
`)
