import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { PlanExecutor } from '../../plan'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { APPIMAGE_LAYER } from './constants'
import { diffAppimage } from './diff'
import { planAppimage } from './plan'
import { makeFakeAssetResolver, makeFakeDownloader, makeFakeGearLeverProvider } from './testHelpers'

// 케이스 출처: 구 repo tests/test_appimage.py의 일부 행동을 새 Gear Lever
// 모델로 옮김(행동만 — 코드 복사 아님):
// - test_download_action_planned_not_sudo -> "홈 디렉터리 다운로드만, 절대
//   privileged 아님"을 그대로 확인.
// - test_no_actions_when_in_sync -> diff가 비어 있으면 plan도 빈 배열.
// - test_download_failure_is_clean -> fetch/다운로드 실패가 예외 없이
//   {ok:false, detail}로 깔끔히 보고됨(전송 계층이 urllib에서 주입 가능한
//   Downloader 인터페이스로 바뀌었을 뿐 행동은 동일).

describe('planAppimage', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('produces no actions when diff has no drift (test_no_actions_when_in_sync)', async () => {
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ installed: [] }))
    const actions = planAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider(),
      makeFakeAssetResolver(),
      makeFakeDownloader(),
      diff
    )
    expect(actions).toEqual([])
  })

  it('a to_install action is never privileged (test_download_action_planned_not_sudo)', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ installed: [] }))
    const actions = planAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider(),
      makeFakeAssetResolver(),
      makeFakeDownloader(),
      diff
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].privileged).toBeFalsy()
    expect(actions[0].summary).toContain('tev.desktop')
    expect(actions[0].summary).toContain('Tom94/tev')
  })

  it('runs the full integrate flow: resolve asset -> download -> integrate -> set-update-source', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ installed: [] }))
    const provider = makeFakeGearLeverProvider()
    const resolver = makeFakeAssetResolver({
      assetsByCoordinate: {
        'Tom94/tev': {
          name: 'tev.appimage',
          downloadUrl: 'https://github.com/Tom94/tev/releases/download/v2.13.1/tev.appimage'
        }
      }
    })
    const downloader = makeFakeDownloader()

    const actions = planAppimage(fixture.ctx, provider, resolver, downloader, diff)
    expect(actions).toHaveLength(1)

    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(downloader.calls).toHaveLength(1)
    expect(downloader.calls[0].url).toBe(
      'https://github.com/Tom94/tev/releases/download/v2.13.1/tev.appimage'
    )
    expect(provider.integrateCalls).toHaveLength(1)
    expect(provider.setUpdateSourceCalls).toHaveLength(1)
    expect(provider.setUpdateSourceCalls[0].params.repo).toBe('Tom94/tev')
    expect(provider.setUpdateSourceCalls[0].params.repo_filename).toBe('tev.appimage')
  })

  it('a download failure is reported cleanly, no throw (test_download_failure_is_clean)', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ installed: [] }))
    const resolver = makeFakeAssetResolver({
      assetsByCoordinate: {
        'Tom94/tev': { name: 'tev.appimage', downloadUrl: 'https://example/tev.appimage' }
      }
    })
    const downloader = makeFakeDownloader({
      result: { ok: false, detail: 'download 실패: network error' }
    })

    const actions = planAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider(),
      resolver,
      downloader,
      diff
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('download 실패')
  })

  it('reports a clean failure when no matching asset can be resolved', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ installed: [] }))
    const actions = planAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider(),
      makeFakeAssetResolver(), // 빈 옵션 -- 항상 null 반환
      makeFakeDownloader(),
      diff
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('asset')
  })

  it('an unsupported (non-GithubUpdater) source gets a skipReason and PlanExecutor reports it as skipped without ever calling run()', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'foo.desktop',
          source: 'StaticFileUpdater',
          coordinate: 'https://example.com/foo.appimage',
          repoFilename: 'foo.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ installed: [] }))
    const actions = planAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider(),
      makeFakeAssetResolver(),
      makeFakeDownloader(),
      diff
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].skipReason).toContain('미지원 소스')

    const results = await new PlanExecutor().execute(actions, { confirm: true })
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('skipped')
    expect(results[0].detail).toContain('미지원 소스')
  })
})
