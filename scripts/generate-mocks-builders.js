/**
 * Pure builder functions for WireMock stub payloads.
 *
 * Exported so they can be imported by tests and by generate-mocks.js.
 * All functions are side-effect free — no file I/O, no process.exit.
 */

import { faker } from '@faker-js/faker'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export function cveId() {
  const year = faker.number.int({ min: 2020, max: 2025 })
  const id   = faker.number.int({ min: 10000, max: 99999 })
  return `CVE-${year}-${id}`
}

export function packageName() {
  const eco = faker.helpers.arrayElement(ECOSYSTEMS)
  return eco.prefix + eco.suffix()
}

export function severity() {
  return faker.helpers.arrayElement(SEVERITIES)
}

export function cvssScore(sev) {
  const ranges = { CRITICAL: [9.0, 10.0], HIGH: [7.0, 8.9], MEDIUM: [4.0, 6.9], LOW: [0.1, 3.9] }
  const [min, max] = ranges[sev] ?? [4.0, 6.9]
  return parseFloat(faker.number.float({ min, max, fractionDigits: 1 }))
}

/**
 * Generate a single random team slug.
 */
export function teamSlug() {
  const words = [
    faker.helpers.arrayElement(['attestasjon', 'pensjon', 'dagpenger', 'sykepenger', 'arbeidssoker',
      'aap', 'tiltak', 'rekruttering', 'fager', 'helsetjenester', 'soknad', 'inntekt',
      'utbetaling', 'k9', 'omsorgspenger', 'pleiepenger', 'klage', 'vedtak']),
  ]
  return `team-${words[0]}`
}

/**
 * Generate an array of N unique team slugs.
 * Use this to produce a shared slug set that can be passed to all builders.
 * Appends an index suffix to guarantee uniqueness even when the random word
 * pool produces collisions.
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

export function appName() {
  const adj  = faker.helpers.arrayElement(['isalive', 'soknad', 'api', 'proxy', 'frontend', 'backend', 'kafka-consumer', 'scheduler'])
  const noun = faker.helpers.arrayElement(['pensjon', 'dagpenger', 'sykepenger', 'aap', 'inntekt', 'klage', 'vedtak', 'tiltak'])
  return `${noun}-${adj}`
}

export function imageTag() {
  const d = faker.date.recent({ days: 60 })
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const sha = faker.git.commitSha({ length: 7 })
  return `${y}-${m}-${day}-${sha}`
}

export function imageName(team, app) {
  return `europe-north1-docker.pkg.dev/nais-management-233d/nais/${team}/${app}`
}

export function repoName(_team, app) {
  return `navikt/${app}`
}

export function envName(environments) {
  return faker.helpers.arrayElement(environments)
}

export function ingressType() {
  return faker.helpers.arrayElement(INGRESS_TYPES)
}

export function pageInfo(hasNext = false, cursor = null) {
  return { hasNextPage: hasNext, endCursor: cursor }
}

// ---------------------------------------------------------------------------
// CVE / vulnerability helpers
// ---------------------------------------------------------------------------

export function buildCvePool(numWorkloads, vulnsPerWorkload, sharedRatio) {
  const totalSlots  = numWorkloads * vulnsPerWorkload
  const sharedCount = Math.max(1, Math.round(totalSlots * sharedRatio))
  return Array.from({ length: sharedCount }, () => ({
    identifier: cveId(),
    packageName: packageName(),
  }))
}

export function buildVulnerabilities(count, sharedPool) {
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

// ---------------------------------------------------------------------------
// Nais payload builders
// ---------------------------------------------------------------------------

/**
 * Build a user-vulns payload.
 *
 * @param {object} cfg   - mock-config (nais section used)
 * @param {string[]} slugs - shared team slug array to embed in the response
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
 *
 * @param {object} cfg
 * @param {string[]} slugs - shared team slug array to embed in the response
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

/**
 * Build a team-vulns payload for a single team.
 * This stub cycles per team, so no shared slug set is needed here —
 * the team slug is generated independently (backend queries by slug it already knows).
 */
export function buildTeamVulnsPayload(cfg) {
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

export function buildAllTeamsPayload(cfg) {
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

// ---------------------------------------------------------------------------
// GCVE payload builders
// ---------------------------------------------------------------------------

export function buildCvssMetrics(sev) {
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

export function buildGcveCveRecord() {
  const id  = cveId()
  const sev = severity()
  const pkg = packageName()
  const published = faker.date.past({ years: 3 }).toISOString()

  return {
    dataType: 'CVE_RECORD',
    dataVersion: '5.2',
    cveMetadata: {
      cveId: id,
      assignerOrgId: faker.string.uuid(),
      assignerShortName: faker.helpers.arrayElement(['GitHub_M', 'Apache', 'Red Hat', 'MITRE', 'Google']),
      state: 'PUBLISHED',
      dateReserved: faker.date.past({ years: 4 }).toISOString(),
      datePublished: published,
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
            description: faker.helpers.arrayElement(['CWE-79 Cross-site Scripting', 'CWE-89 SQL Injection', 'CWE-22 Path Traversal', 'CWE-502 Deserialization', 'CWE-400 Uncontrolled Resource Consumption']),
            cweId: faker.helpers.arrayElement(['CWE-79', 'CWE-89', 'CWE-22', 'CWE-502', 'CWE-400']),
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
              id: id,
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

// ---------------------------------------------------------------------------
// WireMock stub builders
// ---------------------------------------------------------------------------

export function scenarioStates(n) {
  return Array.from({ length: n }, (_, i) => ({
    required: i === 0 ? 'Started' : `variation-${i + 1}`,
    next:     i === n - 1 ? 'Started' : `variation-${i + 2}`,
  }))
}

export function naisStub({ scenarioName, variation, states, operationName, responseBody }) {
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

export function gcveByIdStub({ variation, states, responseBody }) {
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

export function gcveNotFoundStub() {
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

export function gcveListStub(records) {
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
 *
 * @param {object} cfg
 * @param {string[]} slugs - shared team slug array to embed as naisTeams
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

export function teamkatalogenTeamsByProductAreaStub(cfg) {
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

export function teamkatalogenTeamsByClusterStub(cfg) {
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
