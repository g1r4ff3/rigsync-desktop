import path from 'node:path'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { checkBinariesPreflight } from './checks'

function writeExecutable(fixture: TestFixture, filename: string): void {
  const dir = path.join(fixture.homeDir, '.local', 'bin')
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, filename)
  fs.writeFileSync(target, '#!/bin/sh\necho fake\n')
  fs.chmodSync(target, 0o755)
}

describe('checkBinariesPreflight', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('does not warn for an unresolved (unregistered) executable with a plain, unversioned name', () => {
    writeExecutable(fixture, 'sync-claude-to-opencode.sh')
    const result = checkBinariesPreflight(fixture.ctx)
    expect(result.unresolvedInstalled).toEqual(['sync-claude-to-opencode.sh'])
    expect(result.warnings).toEqual([])
  })

  it('warns about a versioned filename on an unresolved executable (F5)', () => {
    writeExecutable(fixture, 'JetBrainsMono-2.304.ttf')
    const result = checkBinariesPreflight(fixture.ctx)
    expect(result.unresolvedInstalled).toEqual(['JetBrainsMono-2.304.ttf'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('JetBrainsMono-2.304.ttf')
    expect(result.warnings[0]).toContain('수렴하지 않을 수 있음')
  })

  it('does not warn about a registered binary (uv) even though it is a known name', () => {
    writeExecutable(fixture, 'uv')
    const result = checkBinariesPreflight(fixture.ctx)
    expect(result.unresolvedInstalled).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('all green when nothing is installed', () => {
    const result = checkBinariesPreflight(fixture.ctx)
    expect(result.unresolvedInstalled).toEqual([])
    expect(result.warnings).toEqual([])
  })
})
