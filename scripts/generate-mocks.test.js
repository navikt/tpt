/**
 * Tests for the stub generation module (generate-mocks.js).
 *
 * Seam: the exported builder functions that produce stub payloads.
 * We verify that team slugs are consistent across the three stubs
 * that must agree: user-vulns, team-memberships, and teamkatalogen membership.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateTeamSlugs,
  buildUserVulnsPayload,
  buildTeamMembershipsPayload,
  teamkatalogenMembershipStub,
} from './generate-mocks.js'

const cfg = {
  nais: {
    teams: 3,
    apps_per_team: 1,
    jobs_per_team: 1,
    vulns_per_workload: 2,
    shared_cve_ratio: 0.3,
    environments: ['dev-gcp', 'prod-gcp'],
    variations: 2,
  },
  teamkatalogen: {
    nais_teams_per_user: 3,
    clusters: 1,
    product_areas: 1,
  },
}

describe('generateTeamSlugs', () => {
  it('returns N slugs', () => {
    const slugs = generateTeamSlugs(5)
    assert.equal(slugs.length, 5)
  })

  it('returns unique slugs', () => {
    // Run several times to catch collisions in the random pool
    for (let i = 0; i < 10; i++) {
      const slugs = generateTeamSlugs(10)
      const unique = new Set(slugs)
      assert.equal(unique.size, slugs.length, `Duplicate slug found: ${slugs}`)
    }
  })
})

describe('slug alignment', () => {
  it('buildTeamMembershipsPayload uses the provided slugs', () => {
    const slugs = ['team-alpha', 'team-beta', 'team-gamma']
    const payload = buildTeamMembershipsPayload(cfg, slugs)
    const actual = payload.data.user.teams.nodes.map(n => n.team.slug)
    assert.deepEqual(actual, slugs)
  })

  it('buildUserVulnsPayload uses the provided slugs', () => {
    const slugs = ['team-alpha', 'team-beta', 'team-gamma']
    const payload = buildUserVulnsPayload(cfg, slugs)
    const actual = payload.data.user.teams.nodes.map(n => n.team.slug)
    assert.deepEqual(actual, slugs)
  })

  it('teamkatalogenMembershipStub uses the provided slugs', () => {
    const slugs = ['team-alpha', 'team-beta', 'team-gamma']
    const stub = teamkatalogenMembershipStub(cfg, slugs)
    const actual = stub.response.jsonBody.teams[0].naisTeams
    assert.deepEqual(actual, slugs)
  })

  it('all three stubs agree on slugs when given the same slug set', () => {
    const slugs = ['team-foo', 'team-bar']

    const vulns = buildUserVulnsPayload({ ...cfg, nais: { ...cfg.nais, teams: 2 } }, slugs)
    const memberships = buildTeamMembershipsPayload({ ...cfg, nais: { ...cfg.nais, teams: 2 } }, slugs)
    const tk = teamkatalogenMembershipStub({ ...cfg, teamkatalogen: { ...cfg.teamkatalogen, nais_teams_per_user: 2 } }, slugs)

    const vulnSlugs   = vulns.data.user.teams.nodes.map(n => n.team.slug)
    const memberSlugs = memberships.data.user.teams.nodes.map(n => n.team.slug)
    const tkSlugs     = tk.response.jsonBody.teams[0].naisTeams

    assert.deepEqual(vulnSlugs, slugs)
    assert.deepEqual(memberSlugs, slugs)
    assert.deepEqual(tkSlugs, slugs)
  })
})
