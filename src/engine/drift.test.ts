import { describe, expect, it } from 'vitest'
import { summarizeDrift, shouldNotify } from './drift'

describe('summarizeDrift', () => {
  it('counts items per capability and totals across all of them', () => {
    const summary = summarizeDrift(
      { apt: ['git', 'curl'], dotfiles: ['~/.zshrc'], appimage: [] },
      '2026-07-25T00:00:00.000Z'
    )
    expect(summary.total).toBe(3)
    expect(summary.byCapability).toEqual({ apt: 2, dotfiles: 1 })
    expect(summary.checkedAt).toBe('2026-07-25T00:00:00.000Z')
  })

  it('produces the same hash regardless of item order within a capability', () => {
    const a = summarizeDrift({ apt: ['git', 'curl'] }, 't1')
    const b = summarizeDrift({ apt: ['curl', 'git'] }, 't2')
    expect(a.hash).toBe(b.hash)
  })

  it('produces the same hash regardless of capability key order', () => {
    const a = summarizeDrift({ apt: ['git'], dotfiles: ['~/.zshrc'] }, 't1')
    const b = summarizeDrift({ dotfiles: ['~/.zshrc'], apt: ['git'] }, 't2')
    expect(a.hash).toBe(b.hash)
  })

  it('produces a different hash when the item content differs even if the count is the same', () => {
    const a = summarizeDrift({ apt: ['git', 'curl'] }, 't1')
    const b = summarizeDrift({ apt: ['docker', 'vim'] }, 't2')
    expect(a.total).toBe(b.total)
    expect(a.hash).not.toBe(b.hash)
  })

  it('an empty input summarizes to total 0 with a stable hash', () => {
    const summary = summarizeDrift({}, 't1')
    expect(summary.total).toBe(0)
    expect(summary.byCapability).toEqual({})
  })
})

describe('shouldNotify', () => {
  it('does not notify when there is no prior check and no current drift', () => {
    const curr = summarizeDrift({}, 't1')
    expect(shouldNotify(null, curr)).toBe(false)
  })

  it('notifies on the very first check if it already finds drift (no prior check at all)', () => {
    const curr = summarizeDrift({ apt: ['git'] }, 't1')
    expect(shouldNotify(null, curr)).toBe(true)
  })

  it('notifies on the none -> something transition', () => {
    const prev = summarizeDrift({}, 't0')
    const curr = summarizeDrift({ apt: ['git'] }, 't1')
    expect(shouldNotify(prev, curr)).toBe(true)
  })

  it('does not re-notify for the exact same drift on a later check (no 6-hourly spam)', () => {
    const prev = summarizeDrift({ apt: ['git', 'curl'] }, 't0')
    const curr = summarizeDrift({ apt: ['git', 'curl'] }, 't1')
    expect(shouldNotify(prev, curr)).toBe(false)
  })

  it('notifies again when the drift content changes while staying non-empty', () => {
    const prev = summarizeDrift({ apt: ['git'] }, 't0')
    const curr = summarizeDrift({ apt: ['git', 'curl'] }, 't1')
    expect(shouldNotify(prev, curr)).toBe(true)
  })

  it('does not notify on the something -> none transition (resolution is not itself notify-worthy)', () => {
    const prev = summarizeDrift({ apt: ['git'] }, 't0')
    const curr = summarizeDrift({}, 't1')
    expect(shouldNotify(prev, curr)).toBe(false)
  })
})
