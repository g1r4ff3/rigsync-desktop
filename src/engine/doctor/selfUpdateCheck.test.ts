import { describe, expect, it } from 'vitest'
import { checkSelfUpdateStatus, selfUpdateManualCommand } from './selfUpdateCheck'

describe('checkSelfUpdateStatus', () => {
  it('is not applicable when not running as an AppImage (dev/deb)', () => {
    const result = checkSelfUpdateStatus({
      appImagePath: null,
      gearLeverInstalled: true,
      appConfig: { updateManager: { repo: 'g1r4ff3/rigsync-desktop' } }
    })
    expect(result).toEqual({ applicable: false, status: 'not-appimage' })
  })

  it('warns when Gear Lever is not installed', () => {
    const result = checkSelfUpdateStatus({
      appImagePath: '/home/user/Applications/rigsync-desktop.AppImage',
      gearLeverInstalled: false,
      appConfig: null
    })
    expect(result.applicable).toBe(true)
    expect(result.status).toBe('gearlever-missing')
    expect(result.warning).toBeDefined()
    expect(result.manualCommand).toBeUndefined()
  })

  it('warns when Gear Lever is installed but this AppImage is not integrated', () => {
    const result = checkSelfUpdateStatus({
      appImagePath: '/home/user/Applications/rigsync-desktop.AppImage',
      gearLeverInstalled: true,
      appConfig: null
    })
    expect(result.status).toBe('not-integrated')
    expect(result.warning).toBeDefined()
  })

  it('warns with a runnable manual command when integrated but no update source is set', () => {
    const appImagePath = '/home/user/Applications/rigsync-desktop.AppImage'
    const result = checkSelfUpdateStatus({
      appImagePath,
      gearLeverInstalled: true,
      appConfig: { updateManager: undefined }
    })
    expect(result.status).toBe('source-missing')
    expect(result.manualCommand).toBe(selfUpdateManualCommand(appImagePath))
    expect(result.warning).toContain(result.manualCommand as string)
  })

  it('warns with a manual command when integrated but the update_manager section has no repo', () => {
    const appImagePath = '/home/user/Applications/rigsync-desktop.AppImage'
    const result = checkSelfUpdateStatus({
      appImagePath,
      gearLeverInstalled: true,
      appConfig: { updateManager: { repo: undefined, manager: 'GithubUpdater' } }
    })
    expect(result.status).toBe('source-missing')
    expect(result.manualCommand).toBeDefined()
  })

  it('passes cleanly when the update source is already configured', () => {
    const result = checkSelfUpdateStatus({
      appImagePath: '/home/user/Applications/rigsync-desktop.AppImage',
      gearLeverInstalled: true,
      appConfig: {
        updateManager: {
          repo: 'g1r4ff3/rigsync-desktop',
          repoFilename: 'rigsync-desktop-*.AppImage',
          manager: 'GithubUpdater',
          allowPrereleases: false
        }
      }
    })
    expect(result).toEqual({ applicable: true, status: 'configured' })
  })
})

describe('selfUpdateManualCommand', () => {
  it('embeds the exact appimage path and the fixed repo coordinates', () => {
    const cmd = selfUpdateManualCommand('/opt/rigsync-desktop-0.1.4.AppImage')
    expect(cmd).toContain('--set-update-source "/opt/rigsync-desktop-0.1.4.AppImage"')
    expect(cmd).toContain('repo=g1r4ff3/rigsync-desktop')
    expect(cmd).toContain("repo_filename='rigsync-desktop-*.AppImage'")
    expect(cmd).toContain('allow_prereleases=false')
    expect(cmd).toContain('--manager GithubUpdater')
  })
})
