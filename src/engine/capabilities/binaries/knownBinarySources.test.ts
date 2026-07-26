import { describe, expect, it } from 'vitest'
import {
  getKnownBinaryDefinition,
  identifyBinaryDefinitionByExecutable
} from './knownBinarySources'

describe('identifyBinaryDefinitionByExecutable', () => {
  it('recognizes uv and uvx as the same "uv" entry (real machine fixture names)', () => {
    expect(identifyBinaryDefinitionByExecutable('uv')?.name).toBe('uv')
    expect(identifyBinaryDefinitionByExecutable('uvx')?.name).toBe('uv')
  })

  it('recognizes micromamba', () => {
    expect(identifyBinaryDefinitionByExecutable('micromamba')?.name).toBe('micromamba')
  })

  it('returns null for an unrecognized executable name -- never guesses', () => {
    expect(identifyBinaryDefinitionByExecutable('rtk')).toBeNull()
    expect(identifyBinaryDefinitionByExecutable('sync-claude-to-opencode.sh')).toBeNull()
    // 이름이 비슷해도(uv 접두어) 다른 도구라 매칭되지 않는다 (실사례: uvicorn).
    expect(identifyBinaryDefinitionByExecutable('uvicorn')).toBeNull()
  })

  it('uv release asset is a tar.gz containing both uv and uvx', () => {
    const def = getKnownBinaryDefinition('uv')
    expect(def?.source.kind).toBe('github-release')
    if (def?.source.kind === 'github-release') {
      expect(def.source.coordinate).toBe('astral-sh/uv')
      expect(def.source.assetKind).toBe('tar.gz')
    }
    expect(def?.binaries).toEqual(['uv', 'uvx'])
  })

  it('micromamba release asset is a single uncompressed binary', () => {
    const def = getKnownBinaryDefinition('micromamba')
    expect(def?.source.kind).toBe('github-release')
    if (def?.source.kind === 'github-release') {
      expect(def.source.coordinate).toBe('mamba-org/micromamba-releases')
      expect(def.source.assetKind).toBe('single-binary')
    }
    expect(def?.binaries).toEqual(['micromamba'])
  })

  it('parses uv/uvx version output (real machine format: "uv 0.11.2 (x86_64-unknown-linux-gnu)")', () => {
    const def = getKnownBinaryDefinition('uv')
    expect(def?.parseVersion('uv 0.11.2 (x86_64-unknown-linux-gnu)')).toBe('0.11.2')
    expect(def?.parseVersion('uvx 0.11.2 (x86_64-unknown-linux-gnu)')).toBe('0.11.2')
  })

  it('parses micromamba version output (real machine format: "2.3.3")', () => {
    const def = getKnownBinaryDefinition('micromamba')
    expect(def?.parseVersion('2.3.3\n')).toBe('2.3.3')
  })

  it('getKnownBinaryDefinition returns null for an unregistered name', () => {
    expect(getKnownBinaryDefinition('ripgrep')).toBeNull()
  })
})
