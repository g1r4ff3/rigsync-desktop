import { describe, expect, it } from 'vitest'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { makeFixture } from '../../testFixtures'
import { TOOLS_LAYER } from './constants'
import { ToolPackageNotInstalledError, registerToolPackage } from './register'
import { makeFakeToolsProvider } from './testHelpers'
import type { ToolsManifest } from './types'

describe('registerToolPackage', () => {
  it('npm 전역 목록에 있으면 common tools.toml packages에 upsert한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeToolsProvider({ globals: { pnpm: '9.0.0' } })

    await registerToolPackage(fixture.ctx, provider, 'pnpm')

    const doc = readCommonLayer(fixture.ctx, TOOLS_LAYER) as ToolsManifest
    expect(doc.packages).toEqual(['pnpm'])
    fixture.cleanup()
  })

  it('npm 전역 목록에 없으면 거부한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeToolsProvider({ globals: {} })

    await expect(registerToolPackage(fixture.ctx, provider, 'pnpm')).rejects.toThrow(
      ToolPackageNotInstalledError
    )
    fixture.cleanup()
  })

  it('기존 node 필드는 건드리지 않는다', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, TOOLS_LAYER, {
      packages: [],
      node: { version: 'v20.0.0', manager: 'nvm' }
    })
    const provider = makeFakeToolsProvider({ globals: { pnpm: '9.0.0' } })

    await registerToolPackage(fixture.ctx, provider, 'pnpm')

    const doc = readCommonLayer(fixture.ctx, TOOLS_LAYER) as ToolsManifest
    expect(doc.node).toEqual({ version: 'v20.0.0', manager: 'nvm' })
    expect(doc.packages).toEqual(['pnpm'])
    fixture.cleanup()
  })

  it('이미 등록된 패키지는 멱등', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeToolsProvider({ globals: { pnpm: '9.0.0' } })

    await registerToolPackage(fixture.ctx, provider, 'pnpm')
    await registerToolPackage(fixture.ctx, provider, 'pnpm')

    const doc = readCommonLayer(fixture.ctx, TOOLS_LAYER) as ToolsManifest
    expect(doc.packages).toEqual(['pnpm'])
    fixture.cleanup()
  })
})
