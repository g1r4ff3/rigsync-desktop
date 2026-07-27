import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../testFixtures'
import { writeCommonLayer } from '../manifest'
import { readManualSyncNotes } from './manualSyncNotes'

describe('readManualSyncNotes', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('returns [] when manual-sync.toml does not exist', () => {
    expect(readManualSyncNotes(fixture.ctx)).toEqual([])
  })

  it('parses two notes, preserving file order', () => {
    writeCommonLayer(fixture.ctx, 'manual-sync', {
      note: [
        { id: 'a', title: 'Title A', detail: 'Detail A' },
        { id: 'b', title: 'Title B', detail: 'Detail B' }
      ]
    })

    expect(readManualSyncNotes(fixture.ctx)).toEqual([
      { id: 'a', title: 'Title A', detail: 'Detail A' },
      { id: 'b', title: 'Title B', detail: 'Detail B' }
    ])
  })

  it('includes a note whose exists path is present on this machine', () => {
    fs.mkdirSync(path.join(fixture.homeDir, '.config', 'Claude'), { recursive: true })
    writeCommonLayer(fixture.ctx, 'manual-sync', {
      note: [
        { id: 'claude-desktop', title: 'Claude Desktop', detail: 'd', exists: '~/.config/Claude' }
      ]
    })

    expect(readManualSyncNotes(fixture.ctx)).toEqual([
      { id: 'claude-desktop', title: 'Claude Desktop', detail: 'd' }
    ])
  })

  it('excludes a note whose exists path is absent on this machine', () => {
    writeCommonLayer(fixture.ctx, 'manual-sync', {
      note: [
        { id: 'claude-desktop', title: 'Claude Desktop', detail: 'd', exists: '~/.config/Claude' }
      ]
    })

    expect(readManualSyncNotes(fixture.ctx)).toEqual([])
  })

  it('expands a leading ~/ against ctx.homeDir, not process.env.HOME', () => {
    fs.mkdirSync(path.join(fixture.homeDir, 'marker-dir'), { recursive: true })
    writeCommonLayer(fixture.ctx, 'manual-sync', {
      note: [{ id: 'm', title: 'M', detail: 'd', exists: '~/marker-dir' }]
    })

    expect(readManualSyncNotes(fixture.ctx)).toEqual([{ id: 'm', title: 'M', detail: 'd' }])
  })

  it('silently skips entries missing a required field (id/title/detail)', () => {
    writeCommonLayer(fixture.ctx, 'manual-sync', {
      note: [
        { id: 'ok', title: 'OK', detail: 'd' },
        { id: 'missing-title', detail: 'd' },
        { id: 'missing-detail', title: 'T' },
        { title: 'missing-id', detail: 'd' }
      ]
    })

    expect(readManualSyncNotes(fixture.ctx)).toEqual([{ id: 'ok', title: 'OK', detail: 'd' }])
  })
})
