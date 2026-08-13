#!/usr/bin/env node
/**
 * TPT WireMock stub generator — deep module
 *
 * Single interface: generateStubs(config, options)
 *
 * What it does:
 *   1. Fetches + validates the Nais GraphQL schema via `nais api schema`
 *   2. Generates WireMock stubs for Nais, GCVE, and Teamkatalogen
 *   3. Generates test-data/mock/ artifacts for Mode A (tpt-backend static files)
 *
 * All builder logic lives in this file. Nothing is exported except the public
 * interface: generateStubs, generateTeamSlugs, buildUserVulnsPayload,
 * buildTeamMembershipsPayload, and teamkatalogenMembershipStub (for tests).
 *
 * Usage (CLI):
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
import { faker } from '@faker-js/faker'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// =============================================================================
// Implementation: primitives
// =============================================================================

const SEVERITIES    = ['CRITICAL', 'HIGH', 'HIGH', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'LOW']
const INGRESS_TYPES = ['INTERNAL', 'EXTERNAL']
const ECOSYSTEMS = [
  { prefix: 'org.springframework:', suffix: () => faker.helpers.arrayElement(['spring-core', 'spring-web', 'spring-security-core', 'spring-boot']) },
  { prefix: 'com.fasterxml.jackson.core:', suffix: () => 'jackson-databind' },
  { prefix: 'io.netty:', suffix: () => faker.helpers.arrayElement(['netty-codec-http2', 'netty-handler', 'netty-common']) },
  { prefix: 'org.apache.commons:', suffix: () => faker.helpers.arrayElement(['commons-text', 'commons-compress', 'commons-io']) },
  { prefix: '', suffix: () => faker.helpers.arrayElement(['lodash', 'express', 'axios', 'next', 'react-dom']) },
  { prefix: 'github.com/gorilla/', suffix: () => faker.helpers.arrayElement(['mux', 'websocket', 'handlers']) },
  { prefix: 'golang.org/x/', suffix: () => faker.helpers.arrayElement(['net', 'crypto', 'text']) },
]

function cveId() {
  const year = faker.number.int({ min: 2020, max: 2025 })
  const id   = faker.number.int({ min: 10000, max: 99999 })
  return `CVE-${year}-${id}`
}

function packageName() {
  const eco = faker.helpers.arrayElement(ECOSYSTEMS)
  return eco.prefix + eco.suffix()
}

function severity() {
  return faker.helpers.arrayElement(SEVERITIES)
}

function cvssScore(sev) {
  const ranges = { CRITICAL: [9.0, 10.0], HIGH: [7.0, 8.9], MEDIUM: [4.0, 6.9], LOW: [0.1, 3.9] }
  const [min, max] = ranges[sev] ?? [4.0, 6.9]
  return parseFloat(faker.number.float({ min, max, fractionDigits: 1 }))
}

function teamSlug() {
  const word = faker.helpers.arrayElement([
    'attestasjon', 'pensjon', 'dagpenger', 'sykepenger', 'arbeidssoker',
    'aap', 'tiltak', 'rekruttering', 'fager', 'helsetjenester', 'soknad', 'inntekt',
    'utbetaling', 'k9', 'omsorgspenger', 'pleiepenger', 'klage', 'vedtak',
  ])
  return `team-${word}`
}

function appName() {
  const adj  = faker.helpers.arrayElement(['isalive', 'soknad', 'api', 'proxy', 'frontend', 'backend', 'kafka-consumer', 'scheduler'])
  const noun = faker.helpers.arrayElement(['pensjon', 'dagpenger', 'sykepenger', 'aap', 'inntekt', 'klage', 'vedtak', 'tiltak'])
  return `${noun}-${adj}`
}

function imageTag() {
  const d = faker.date.recent({ days: 60 })
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const sha = faker.git.commitSha({ length: 7 })
  return `${y}-${m}-${day}-${sha}`
}

function imageName(team, app) {
  return `europe-north1-docker.pkg.dev/nais-management-233d/nais/${team}/${app}`
}

function repoName(_team, app) {
  return `navikt/${app}`
}

function envName(environments) {
  return faker.helpers.arrayElement(environments)
}

function ingressType() {
  return faker.helpers.arrayElement(INGRESS_TYPES)
}

function pageInfo(hasNext = false, cursor = null) {
  return { hasNextPage: hasNext, endCursor: cursor }
}

// =============================================================================
// Implementation: CVE / vulnerability helpers
// =============================================================================

function buildCvePool(numWorkloads, vulnsPerWorkload, sharedRatio) {
  const totalSlots  = numWorkloads * vulnsPerWorkload
  const sharedCount = Math.max(1, Math.round(totalSlots * sharedRatio))
  return Array.from({ length: sharedCount }, () => ({
    identifier: cveId(),
    packageName: packageName(),
  }))
}

function buildVulnerabilities(count, sharedPool) {
  const sharedCount = Math.min(Math.round(count * 0.3), sharedPool.length)
  const uniqueCount = count - sharedCount
  const shared = faker.helpers.arrayElements(sharedPool, sharedCount)
  const unique = Array.from({ length: uniqueCount }, () => ({
    identifier: cveId(),
    packageName: packageName(),
  }))
  return [...shared, ...unique].map(({ identifier, packageName: pkg }) => {
    const sev = severity()
    return {
      identifier,
      severity: sev,
      package: pkg,
      description: `${faker.hacker.phrase()} (${identifier})`,
      vulnerabilityDetailsLink: `https://nvd.nist.gov/vuln/detail/${identifier}`,
      suppression: null,
    }
  })
}

// =============================================================================
// Implementation: Nais payload builders
// =============================================================================

/**
 * Build a user-vulns payload.
 * Exported for tests.
 */
export function buildUserVulnsPayload(cfg, slugs) {
  const teams = slugs.map(slug => {
    const sharedPool = buildCvePool(
      cfg.nais.apps_per_team + cfg.nais.jobs_per_team,
      cfg.nais.vulns_per_workload,
      cfg.nais.shared_cve_ratio
    )

    const applications = {
      pageInfo: pageInfo(),
      nodes: Array.from({ length: cfg.nais.apps_per_team }, () => {
        const name = appName()
        const env  = envName(cfg.nais.environments)
        return {
          id: faker.string.uuid(),
          name,
          ingresses: [{ type: ingressType() }],
          deployments: {
            nodes: [{
              repository: repoName(slug, name),
              environmentName: env,
              createdAt: faker.date.recent({ days: 30 }).toISOString(),
            }],
          },
          image: {
            name: imageName(slug, name),
            tag:  imageTag(),
            vulnerabilities: {
              pageInfo: pageInfo(),
              nodes: buildVulnerabilities(cfg.nais.vulns_per_workload, sharedPool),
            },
          },
        }
      }),
    }

    const jobs = {
      pageInfo: pageInfo(),
      nodes: Array.from({ length: cfg.nais.jobs_per_team }, () => {
        const name = appName() + '-job'
        const env  = envName(cfg.nais.environments)
        return {
          id: faker.string.uuid(),
          name,
          deployments: {
            nodes: [{
              repository: repoName(slug, name),
              environmentName: env,
              createdAt: faker.date.recent({ days: 30 }).toISOString(),
            }],
          },
          image: {
            name: imageName(slug, name),
            tag:  imageTag(),
            vulnerabilities: {
              pageInfo: pageInfo(),
              nodes: buildVulnerabilities(cfg.nais.vulns_per_workload, sharedPool),
            },
          },
        }
      }),
    }

    return { team: { slug, applications, jobs } }
  })

  return {
    data: {
      user: {
        teams: {
          pageInfo: pageInfo(),
          nodes: teams,
        },
      },
    },
  }
}

/**
 * Build a team-memberships payload using the provided slugs.
 * Exported for tests.
 */
export function buildTeamMembershipsPayload(_cfg, slugs) {
  return {
    data: {
      user: {
        teams: {
          nodes: slugs.map(slug => ({ team: { slug } })),
        },
      },
    },
  }
}

function buildTeamVulnsPayload(cfg) {
  const slug = teamSlug()
  const sharedPool = buildCvePool(
    cfg.nais.apps_per_team + cfg.nais.jobs_per_team,
    cfg.nais.vulns_per_workload,
    cfg.nais.shared_cve_ratio
  )

  return {
    data: {
      team: {
        slug,
        applications: {
          pageInfo: pageInfo(),
          nodes: Array.from({ length: cfg.nais.apps_per_team }, () => {
            const name = appName()
            return {
              id: faker.string.uuid(),
              name,
              ingresses: [{ type: ingressType() }],
              deployments: {
                nodes: [{
                  repository: repoName(slug, name),
                  environmentName: envName(cfg.nais.environments),
                  createdAt: faker.date.recent({ days: 30 }).toISOString(),
                }],
              },
              image: {
                name: imageName(slug, name),
                tag:  imageTag(),
                vulnerabilities: {
                  pageInfo: pageInfo(),
                  nodes: buildVulnerabilities(cfg.nais.vulns_per_workload, sharedPool),
                },
              },
            }
          }),
        },
        jobs: {
          pageInfo: pageInfo(),
          nodes: Array.from({ length: cfg.nais.jobs_per_team }, () => {
            const name = appName() + '-job'
            return {
              id: faker.string.uuid(),
              name,
              deployments: {
                nodes: [{
                  repository: repoName(slug, name),
                  environmentName: envName(cfg.nais.environments),
                  createdAt: faker.date.recent({ days: 30 }).toISOString(),
                }],
              },
              image: {
                name: imageName(slug, name),
                tag:  imageTag(),
                vulnerabilities: {
                  pageInfo: pageInfo(),
                  nodes: buildVulnerabilities(cfg.nais.vulns_per_workload, sharedPool),
                },
              },
            }
          }),
        },
      },
    },
  }
}

function buildAllTeamsPayload(cfg) {
  return {
    data: {
      teams: {
        pageInfo: pageInfo(),
        nodes: Array.from({ length: cfg.nais.teams * 3 }, () => ({
          slug: teamSlug(),
          slackChannel: `#${faker.helpers.arrayElement(['appsec', 'pensjon', 'dagpenger', 'sykepenger', 'team-platform'])}`,
        })),
      },
    },
  }
}

// =============================================================================
// Implementation: GCVE payload builders
// =============================================================================

function buildCvssMetrics(sev) {
  const score = cvssScore(sev)
  return [{
    cvssV3_1: {
      version: '3.1',
      vectorString: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:${sev === 'CRITICAL' ? 'H' : 'L'}/I:${sev === 'HIGH' ? 'H' : 'L'}/A:${sev === 'CRITICAL' || sev === 'HIGH' ? 'H' : 'N'}`,
      baseScore: score,
      baseSeverity: sev,
    },
  }]
}

function buildGcveCveRecord() {
  const id  = cveId()
  const sev = severity()
  const pkg = packageName()
  // Pick a CWE entry whose description and id are consistent
  const cweEntries = [
    { description: 'CWE-79 Cross-site Scripting',           cweId: 'CWE-79'  },
    { description: 'CWE-89 SQL Injection',                  cweId: 'CWE-89'  },
    { description: 'CWE-22 Path Traversal',                 cweId: 'CWE-22'  },
    { description: 'CWE-502 Deserialization of Untrusted Data', cweId: 'CWE-502' },
    { description: 'CWE-400 Uncontrolled Resource Consumption', cweId: 'CWE-400' },
  ]
  const cwe = faker.helpers.arrayElement(cweEntries)

  return {
    dataType: 'CVE_RECORD',
    dataVersion: '5.2',
    cveMetadata: {
      cveId: id,
      assignerOrgId: faker.string.uuid(),
      assignerShortName: faker.helpers.arrayElement(['GitHub_M', 'Apache', 'Red Hat', 'MITRE', 'Google']),
      state: 'PUBLISHED',
      dateReserved: faker.date.past({ years: 4 }).toISOString(),
      datePublished: faker.date.past({ years: 3 }).toISOString(),
      dateUpdated: faker.date.recent({ days: 90 }).toISOString(),
    },
    containers: {
      cna: {
        providerMetadata: {
          orgId: faker.string.uuid(),
          shortName: 'NVD',
          dateUpdated: faker.date.recent({ days: 30 }).toISOString(),
        },
        affected: [{
          vendor: pkg.split(':')[0] || pkg.split('/')[0] || 'unknown',
          product: pkg,
          versions: [{
            version: `${faker.number.int({ min: 1, max: 5 })}.${faker.number.int({ min: 0, max: 9 })}.${faker.number.int({ min: 0, max: 20 })}`,
            status: 'affected',
            lessThan: `${faker.number.int({ min: 5, max: 10 })}.0.0`,
            versionType: 'semver',
          }],
          defaultStatus: 'unaffected',
        }],
        descriptions: [{
          lang: 'en',
          value: `${faker.hacker.phrase()} in ${pkg}. ${faker.lorem.sentence()}`,
        }],
        metrics: buildCvssMetrics(sev),
        references: [{
          url: `https://nvd.nist.gov/vuln/detail/${id}`,
        }, {
          url: `https://github.com/advisories/GHSA-${faker.string.alphanumeric(4)}-${faker.string.alphanumeric(4)}-${faker.string.alphanumeric(4)}`,
        }],
        problemTypes: [{
          descriptions: [{
            lang: 'en',
            description: cwe.description,
            cweId: cwe.cweId,
            type: 'CWE',
          }],
        }],
      },
      adp: [{
        providerMetadata: {
          orgId: faker.string.uuid(),
          shortName: 'CISA-ADP',
          dateUpdated: faker.date.recent({ days: 14 }).toISOString(),
        },
        metrics: [{
          other: {
            type: 'ssvc',
            content: {
              id,
              role: 'CISA Coordinator',
              options: [{
                Exploitation: faker.helpers.arrayElement(['none', 'poc', 'active']),
                Automatable: faker.helpers.arrayElement(['yes', 'no']),
                'Technical Impact': faker.helpers.arrayElement(['partial', 'total']),
              }],
              version: '2-0-3',
              timestamp: faker.date.recent({ days: 30 }).toISOString(),
            },
          },
        }, {
          cvssV3_1: {
            baseScore: cvssScore(sev),
            baseSeverity: sev,
            vectorString: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`,
            version: '3.1',
          },
        }],
        epss: [{
          score: parseFloat(faker.number.float({ min: 0.001, max: 0.9, fractionDigits: 5 }).toFixed(5)),
          percentile: parseFloat(faker.number.float({ min: 0.5, max: 0.999, fractionDigits: 5 }).toFixed(5)),
        }],
      }],
    },
  }
}

// =============================================================================
// Implementation: WireMock stub builders
// =============================================================================

function scenarioStates(n) {
  return Array.from({ length: n }, (_, i) => ({
    required: i === 0 ? 'Started' : `variation-${i + 1}`,
    next:     i === n - 1 ? 'Started' : `variation-${i + 2}`,
  }))
}

function naisStub({ scenarioName, variation, states, operationName, responseBody }) {
  const { required, next } = states[variation - 1]
  return {
    scenarioName,
    requiredScenarioState: required,
    newScenarioState: next,
    priority: 1,
    request: {
      method: 'POST',
      urlPath: '/nais/query',
      bodyPatterns: [{ contains: operationName }],
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: responseBody,
    },
  }
}

function gcveByIdStub({ variation, states, responseBody }) {
  const { required, next } = states[variation - 1]
  return {
    scenarioName: 'gcve-cve-by-id',
    requiredScenarioState: required,
    newScenarioState: next,
    priority: 1,
    request: {
      method: 'GET',
      urlPathPattern: '/gcve/vulnerability/CVE-[0-9]{4}-[0-9]+',
      queryParameters: {
        with_meta: { equalTo: 'true' },
      },
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: responseBody,
    },
  }
}

function gcveNotFoundStub() {
  return {
    priority: 10,
    request: {
      method: 'GET',
      urlPathPattern: '/gcve/vulnerability/[^/]+',
    },
    response: {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: {},
    },
  }
}

function gcveListStub(records) {
  return {
    priority: 1,
    request: {
      method: 'GET',
      urlPath: '/gcve/vulnerability/',
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: records,
    },
  }
}

/**
 * Build the teamkatalogen membership-by-email stub.
 * Exported for tests.
 */
export function teamkatalogenMembershipStub(cfg, slugs) {
  const clusters  = Array.from({ length: cfg.teamkatalogen.clusters }, () => ({
    id: faker.string.uuid(),
    name: faker.helpers.arrayElement(['prod-gcp', 'dev-gcp']),
    productAreaId: faker.string.uuid(),
  }))
  const productAreas = Array.from({ length: cfg.teamkatalogen.product_areas }, () => ({
    id: clusters[0]?.productAreaId ?? faker.string.uuid(),
    name: faker.helpers.arrayElement(['NAV IT', 'Arbeid og ytelser', 'Helse og sykdom']),
  }))

  return {
    priority: 1,
    request: {
      method: 'GET',
      urlPath: '/teamkatalogen/member/membership/byUserEmail',
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: {
        teams: [{ naisTeams: slugs }],
        clusters,
        productAreas,
      },
    },
  }
}

function teamkatalogenTeamsByProductAreaStub(cfg) {
  return {
    priority: 1,
    request: {
      method: 'GET',
      urlPath: '/teamkatalogen/team',
      queryParameters: { productAreaId: { matches: '.+' } },
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: {
        content: Array.from({ length: cfg.teamkatalogen.nais_teams_per_user }, () => ({
          naisTeams: [teamSlug()],
        })),
      },
    },
  }
}

function teamkatalogenTeamsByClusterStub(cfg) {
  return {
    priority: 2,
    request: {
      method: 'GET',
      urlPath: '/teamkatalogen/team',
      queryParameters: { clusterId: { matches: '.+' } },
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      jsonBody: {
        content: Array.from({ length: cfg.teamkatalogen.nais_teams_per_user }, () => ({
          naisTeams: [teamSlug()],
        })),
      },
    },
  }
}

// =============================================================================
// Implementation: Nais schema fetch + validation
// =============================================================================

// Fields the backend reads — derived directly from GraphQLModels.kt.
// If any of these are missing from the schema the backend WILL break.
const REQUIRED_FIELDS = [
  'Query.user', 'Query.team', 'Query.teams',
  'User.teams',
  'TeamMemberConnection.nodes', 'TeamMemberConnection.pageInfo',
  'TeamMember.team',
  'Team.slug', 'Team.applications', 'Team.jobs', 'Team.slackChannel',
  'Application.id', 'Application.name', 'Application.ingresses',
  'Application.deployments', 'Application.image',
  'ApplicationConnection.nodes', 'ApplicationConnection.pageInfo',
  'Job.id', 'Job.name', 'Job.deployments', 'Job.image',
  'JobConnection.nodes', 'JobConnection.pageInfo',
  'Ingress.type',
  'DeploymentConnection.nodes',
  'Deployment.repository', 'Deployment.environmentName', 'Deployment.createdAt',
  'ContainerImage.name', 'ContainerImage.tag', 'ContainerImage.vulnerabilities',
  'ImageVulnerabilityConnection.nodes', 'ImageVulnerabilityConnection.pageInfo',
  'ImageVulnerability.identifier', 'ImageVulnerability.severity',
  'ImageVulnerability.package', 'ImageVulnerability.description',
  'ImageVulnerability.vulnerabilityDetailsLink', 'ImageVulnerability.suppression',
  'ImageVulnerabilitySuppression.state',
  'PageInfo.hasNextPage', 'PageInfo.endCursor',
  'TeamConnection.nodes', 'TeamConnection.pageInfo',
]

function fetchNaisSchema() {
  console.log('Fetching Nais GraphQL schema via `nais api schema`...')
  try {
    const raw = execSync('nais api schema 2>/dev/null', { encoding: 'utf8', timeout: 30_000 })
    const lines = raw.split('\n')
    const sdlStart = lines.findIndex(l =>
      l.trimStart().startsWith('"""') ||
      l.trimStart().startsWith('type ') ||
      l.trimStart().startsWith('schema ') ||
      l.trimStart().startsWith('interface ') ||
      l.trimStart().startsWith('scalar ') ||
      l.trimStart().startsWith('enum ') ||
      l.trimStart().startsWith('input ') ||
      l.trimStart().startsWith('union ') ||
      l.trimStart().startsWith('directive ')
    )
    if (sdlStart === -1) {
      console.error('\nThe output of `nais api schema` does not look like a GraphQL SDL.')
      console.error('Ensure you are logged in: nais login')
      process.exit(1)
    }
    return lines.slice(sdlStart).join('\n')
  } catch (err) {
    console.error('\nFailed to fetch Nais GraphQL schema.')
    console.error('Ensure you are logged in: nais login')
    console.error(err.message)
    process.exit(1)
  }
}

function validateSchema(schemaSDL) {
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
    if (!type.getFields()[fieldName]) {
      broken.push(`  Field "${fieldName}" missing from type "${typeName}"`)
    }
  }

  if (broken.length > 0) {
    console.error('\nBREAKING SCHEMA CHANGE DETECTED')
    console.error('The following fields used by tpt-backend are no longer in the Nais GraphQL schema:')
    broken.forEach(b => console.error(b))
    console.error('\nUpdate tpt-backend\'s GraphQL queries and models, then re-run this generator.')
    process.exit(1)
  }

  console.log(`  All ${REQUIRED_FIELDS.length} required fields present. Schema is compatible.`)
}

// =============================================================================
// Implementation: test-data/mock/ artifact builder (Mode A)
// =============================================================================

/**
 * Translate the Nais user-vulns payload into the flat shape tpt-backend reads
 * at startup in Mode A: { teams: [{ slug, workloads: [...] }] }
 */
function buildModeAVulnerabilities(cfg, slugs) {
  const teams = slugs.map(slug => {
    const sharedPool = buildCvePool(
      cfg.nais.apps_per_team + cfg.nais.jobs_per_team,
      cfg.nais.vulns_per_workload,
      cfg.nais.shared_cve_ratio
    )

    const appWorkloads = Array.from({ length: cfg.nais.apps_per_team }, () => {
      const name = appName()
      const env  = envName(cfg.nais.environments)
      const vulns = buildVulnerabilities(cfg.nais.vulns_per_workload, sharedPool)
      return {
        id: faker.string.uuid(),
        name,
        workloadType: 'app',
        imageTag: imageTag(),
        repository: repoName(slug, name),
        environment: env,
        ingressTypes: [ingressType()],
        vulnerabilities: vulns.map(v => ({
          identifier: v.identifier,
          severity: v.severity,
          packageName: v.package,
          description: v.description,
          vulnerabilityDetailsLink: v.vulnerabilityDetailsLink,
          suppressed: false,
        })),
      }
    })

    const jobWorkloads = Array.from({ length: cfg.nais.jobs_per_team }, () => {
      const name = appName() + '-job'
      const env  = envName(cfg.nais.environments)
      const vulns = buildVulnerabilities(cfg.nais.vulns_per_workload, sharedPool)
      return {
        id: faker.string.uuid(),
        name,
        workloadType: 'job',
        imageTag: imageTag(),
        repository: repoName(slug, name),
        environment: env,
        ingressTypes: [],
        vulnerabilities: vulns.map(v => ({
          identifier: v.identifier,
          severity: v.severity,
          packageName: v.package,
          description: v.description,
          vulnerabilityDetailsLink: v.vulnerabilityDetailsLink,
          suppressed: false,
        })),
      }
    })

    return { slug, workloads: [...appWorkloads, ...jobWorkloads] }
  })

  return { teams }
}

/**
 * Build mock-github-data.json from the same slug set and workload names so
 * that Mode A backend can correlate repositories with vulnerabilities.
 */
function buildModeAGithubData(cfg, slugs) {
  const repositories = []
  for (const slug of slugs) {
    for (let i = 0; i < cfg.nais.apps_per_team; i++) {
      const name = appName()
      repositories.push({
        name,
        fullName: `navikt/${name}`,
        defaultBranch: 'main',
        archived: false,
        alerts: [],
      })
    }
  }
  return { repositories }
}

// =============================================================================
// Public interface
// =============================================================================

/**
 * Generate N unique team slugs.
 * Exported for tests.
 */
export function generateTeamSlugs(n) {
  const seen = new Set()
  return Array.from({ length: n }, (_, i) => {
    let slug = teamSlug()
    if (seen.has(slug)) {
      slug = `${slug}-${i + 1}`
    }
    seen.add(slug)
    return slug
  })
}

/**
 * generateStubs(config) — the single deep interface.
 *
 * Writes WireMock stubs to local-dev/wiremock/mappings/ and
 * test-data/mock/ artifacts for Mode A.
 *
 * @param {object} config   - parsed mock-config.yaml
 * @param {object} [opts]
 * @param {string} [opts.mappingsDir]  - override WireMock mappings dir
 * @param {string} [opts.schemasDir]   - override schemas dir
 * @param {string} [opts.testDataDir]  - override test-data/mock dir
 */
export function generateStubs(config, opts = {}) {
  const MAPPINGS_DIR = opts.mappingsDir ?? resolve(ROOT, 'local-dev/wiremock/mappings')
  const SCHEMAS_DIR  = opts.schemasDir  ?? resolve(ROOT, 'schemas')
  const TEST_DATA_DIR = opts.testDataDir ?? resolve(ROOT, 'test-data/mock')

  // ── Schema fetch + validation ──────────────────────────────────────────────
  const schemaSDL = fetchNaisSchema()
  writeFileSync(resolve(SCHEMAS_DIR, 'nais-api.graphql'), schemaSDL)
  console.log('  Schema written to schemas/nais-api.graphql')
  validateSchema(schemaSDL)

  // ── Shared team slug set ───────────────────────────────────────────────────
  const teamSlugs = generateTeamSlugs(config.nais.teams)

  // ── Stub writer ────────────────────────────────────────────────────────────
  let stubCount = 0
  function write(dir, filename, stub) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, filename), JSON.stringify(stub, null, 2) + '\n')
    stubCount++
  }

  const variations  = config.nais.variations
  const naisStates  = scenarioStates(variations)
  const gcveStates  = scenarioStates(config.gcve.variations)

  const NAIS_DIR = resolve(MAPPINGS_DIR, 'nais')
  const GCVE_DIR = resolve(MAPPINGS_DIR, 'gcve')
  const TK_DIR   = resolve(MAPPINGS_DIR, 'teamkatalogen')

  // ── Nais stubs ─────────────────────────────────────────────────────────────
  console.log('\nGenerating Nais stubs...')

  for (const [opName, scenarioName] of [
    ['ApplicationVulnerabilitiesForUser', 'nais-app-vulns-for-user'],
    ['JobVulnerabilitiesForUser',         'nais-job-vulns-for-user'],
  ]) {
    for (let v = 1; v <= variations; v++) {
      write(NAIS_DIR, `${scenarioName.replace('nais-', '')}-${v}.json`, naisStub({
        scenarioName,
        variation: v,
        states: naisStates,
        operationName: opName,
        responseBody: buildUserVulnsPayload(config, teamSlugs),
      }))
    }
  }

  for (const [opName, scenarioName] of [
    ['ApplicationVulnerabilitiesForTeam', 'nais-app-vulns-for-team'],
    ['JobVulnerabilitiesForTeam',         'nais-job-vulns-for-team'],
  ]) {
    for (let v = 1; v <= variations; v++) {
      write(NAIS_DIR, `${scenarioName.replace('nais-', '')}-${v}.json`, naisStub({
        scenarioName,
        variation: v,
        states: naisStates,
        operationName: opName,
        responseBody: buildTeamVulnsPayload(config),
      }))
    }
  }

  write(NAIS_DIR, 'team-memberships.json', {
    priority: 1,
    request: { method: 'POST', urlPath: '/nais/query', bodyPatterns: [{ contains: 'TeamMembershipsForUser' }] },
    response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: buildTeamMembershipsPayload(config, teamSlugs) },
  })

  write(NAIS_DIR, 'all-teams.json', {
    priority: 1,
    request: { method: 'POST', urlPath: '/nais/query', bodyPatterns: [{ contains: 'TeamInformation' }] },
    response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: buildAllTeamsPayload(config) },
  })

  console.log(`  Written ${variations * 4 + 2} Nais stubs`)

  // ── GCVE stubs ─────────────────────────────────────────────────────────────
  console.log('Generating GCVE stubs...')

  for (let v = 1; v <= config.gcve.variations; v++) {
    write(GCVE_DIR, `cve-by-id-${v}.json`, gcveByIdStub({
      variation: v,
      states: gcveStates,
      responseBody: buildGcveCveRecord(),
    }))
  }
  write(GCVE_DIR, 'cve-list.json', gcveListStub(Array.from({ length: config.gcve.list_size }, buildGcveCveRecord)))
  write(GCVE_DIR, 'cve-not-found.json', gcveNotFoundStub())

  console.log(`  Written ${config.gcve.variations + 2} GCVE stubs`)

  // ── Teamkatalogen stubs ────────────────────────────────────────────────────
  console.log('Generating Teamkatalogen stubs...')

  write(TK_DIR, 'membership-by-email.json', teamkatalogenMembershipStub(config, teamSlugs))
  write(TK_DIR, 'teams-by-product-area.json', teamkatalogenTeamsByProductAreaStub(config))
  write(TK_DIR, 'teams-by-cluster.json', teamkatalogenTeamsByClusterStub(config))

  console.log(`  Written 3 Teamkatalogen stubs`)

  // ── Mode A test-data artifacts ─────────────────────────────────────────────
  console.log('Generating test-data/mock/ artifacts (Mode A)...')

  mkdirSync(TEST_DATA_DIR, { recursive: true })
  writeFileSync(
    resolve(TEST_DATA_DIR, 'mock-vulnerabilities.json'),
    JSON.stringify(buildModeAVulnerabilities(config, teamSlugs), null, 2) + '\n'
  )
  writeFileSync(
    resolve(TEST_DATA_DIR, 'mock-github-data.json'),
    JSON.stringify(buildModeAGithubData(config, teamSlugs), null, 2) + '\n'
  )

  console.log(`  Written mock-vulnerabilities.json and mock-github-data.json`)

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`
Done. ${stubCount} stubs written to local-dev/wiremock/mappings/
  nais/          ${variations * 4 + 2} stubs (${variations} scenario variations × 4 operations + 2 static)
  gcve/          ${config.gcve.variations + 2} stubs (${config.gcve.variations} CVE variations + list + 404)
  teamkatalogen/ 3 stubs (membership, by-product-area, by-cluster)

test-data/mock/ artifacts regenerated (Mode A):
  mock-vulnerabilities.json
  mock-github-data.json

Team slugs used across all membership and user-vulnerability stubs: ${teamSlugs.join(', ')}

WireMock admin UI (when running): http://localhost:9090/__admin/mappings
`)
}

// =============================================================================
// CLI entry point
// =============================================================================

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configArg  = process.argv.indexOf('--config')
  const configPath = configArg !== -1
    ? resolve(process.cwd(), process.argv[configArg + 1])
    : resolve(ROOT, 'mocks/mock-config.yaml')

  const config = yaml.load(readFileSync(configPath, 'utf8'))
  generateStubs(config)
}
