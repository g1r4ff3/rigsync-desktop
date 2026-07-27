import { describe, expect, it } from 'vitest'
import {
  DISTRO_METAPACKAGE_RE,
  classifyAptPackages,
  parseDependsClosure,
  parseInstalledPriorities,
  parsePolicyPackages,
  parsePolicySources
} from './classify'
import { makeFakeAptProvider } from './testHelpers'

// 픽스처 원문은 전부 이 머신 실측(2026-07-27, apt-cache policy / apt-cache
// depends / dpkg-query 실제 출력)에서 대표 케이스만 추린 것 — 포맷을 지어내지
// 않았다. 스펙 §1.2 실측 검증(manual 159 → 배포판 28/사용자 131)과 같은
// 규칙·파서다.

const POLICY_SOURCES_RAW = [
  'Package files:',
  ' 100 /var/lib/dpkg/status',
  '     release a=now',
  ' 500 https://zotero.retorque.re/file/apt-package-archive ./ Packages',
  '     release n=./,c=',
  '     origin zotero.retorque.re',
  ' 500 https://packages.microsoft.com/repos/code stable/main amd64 Packages',
  '     release o=code stable,a=stable,n=stable,l=code stable,c=main,b=amd64',
  '     origin packages.microsoft.com',
  ' 500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages',
  '     release v=24.04,o=Ubuntu,a=noble,n=noble,l=Ubuntu,c=main,b=amd64',
  '     origin archive.ubuntu.com',
  'Pinned packages:',
  ''
].join('\n')

const POLICY_PACKAGES_RAW = [
  'zotero:',
  '  Installed: 9.0.6',
  '  Candidate: 9.0.6',
  '  Version table:',
  ' *** 9.0.6 500',
  '        500 https://zotero.retorque.re/file/apt-package-archive ./ Packages',
  '        100 /var/lib/dpkg/status',
  'zsh:',
  '  Installed: 5.9-6ubuntu2',
  '  Candidate: 5.9-6ubuntu2',
  '  Version table:',
  ' *** 5.9-6ubuntu2 500',
  '        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages',
  '        100 /var/lib/dpkg/status',
  'code:',
  '  Installed: 1.102.1-1752598717',
  '  Candidate: 1.102.2-1753207478',
  '  Version table:',
  '     1.102.2-1753207478 500',
  '        500 https://packages.microsoft.com/repos/code stable/main amd64 Packages',
  ' *** 1.102.1-1752598717 100',
  '        100 /var/lib/dpkg/status',
  'ubuntu-wallpapers:',
  '  Installed: 24.04.2',
  '  Candidate: 24.04.2',
  '  Version table:',
  ' *** 24.04.2 500',
  '        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages',
  '        100 /var/lib/dpkg/status',
  'bash:',
  '  Installed: 5.2.21-2ubuntu4',
  '  Candidate: 5.2.21-2ubuntu4',
  '  Version table:',
  ' *** 5.2.21-2ubuntu4 500',
  '        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages',
  '        100 /var/lib/dpkg/status',
  'claude-desktop:',
  '  Installed: 1.24012.9',
  '  Candidate: 1.24012.9',
  '  Version table:',
  ' *** 1.24012.9 100',
  '        100 /var/lib/dpkg/status',
  ''
].join('\n')

const CLOSURE_RAW = [
  'ubuntu-desktop-minimal',
  '  Depends: alsa-base',
  '  Depends: anacron',
  '    systemd-cron',
  '  Depends: ubuntu-wallpapers',
  'ubuntu-minimal',
  '  Depends: adduser',
  'ubuntu-wallpapers',
  '  Depends: ubuntu-wallpapers-noble',
  'adduser',
  '  Depends: passwd',
  ''
].join('\n')

const PRIORITIES_RAW = [
  'bash\trequired\tinstalled',
  'zsh\toptional\tinstalled',
  'zotero\toptional\tinstalled',
  'code\toptional\tinstalled',
  'claude-desktop\toptional\tinstalled',
  'ubuntu-wallpapers\toptional\tinstalled',
  'ubuntu-desktop-minimal\toptional\tinstalled',
  'ubuntu-minimal\timportant\tinstalled',
  'libfoo:amd64\toptional\tinstalled',
  'removed-pkg\toptional\tconfig-files',
  ''
].join('\n')

describe('parsePolicySources', () => {
  it('maps each normalized source line to its o= origin label', () => {
    const map = parsePolicySources(POLICY_SOURCES_RAW)
    expect(map.get('http://archive.ubuntu.com/ubuntu noble/main amd64 Packages')).toBe('Ubuntu')
    expect(map.get('https://packages.microsoft.com/repos/code stable/main amd64 Packages')).toBe(
      'code stable'
    )
  })

  it('keeps an empty origin for a release line without o= (real case: zotero repo)', () => {
    const map = parsePolicySources(POLICY_SOURCES_RAW)
    expect(map.get('https://zotero.retorque.re/file/apt-package-archive ./ Packages')).toBe('')
  })
})

describe('parsePolicyPackages', () => {
  it('collects only the installed (***) version sources, dropping dpkg status', () => {
    const map = parsePolicyPackages(POLICY_PACKAGES_RAW)
    expect(map.get('zsh')).toEqual(['http://archive.ubuntu.com/ubuntu noble/main amd64 Packages'])
    expect(map.get('zotero')).toEqual([
      'https://zotero.retorque.re/file/apt-package-archive ./ Packages'
    ])
  })

  it('does not leak other-version sources into the installed set (real case: code has a newer candidate)', () => {
    // code의 설치본(***)은 dpkg status뿐 -- 위에 나오는 candidate 스탠자의
    // microsoft repo 라인을 설치본 출처로 오인하면 안 된다.
    const map = parsePolicyPackages(POLICY_PACKAGES_RAW)
    expect(map.get('code')).toEqual([])
  })

  it('yields an empty source list for a local .deb install (claude-desktop)', () => {
    const map = parsePolicyPackages(POLICY_PACKAGES_RAW)
    expect(map.get('claude-desktop')).toEqual([])
  })
})

describe('parseDependsClosure', () => {
  it('collects unindented stanza headers only (dependency lines and alternatives are indented)', () => {
    const closure = parseDependsClosure(CLOSURE_RAW)
    expect(closure).toEqual(
      new Set(['ubuntu-desktop-minimal', 'ubuntu-minimal', 'ubuntu-wallpapers', 'adduser'])
    )
  })
})

describe('parseInstalledPriorities', () => {
  it('keeps installed packages, strips arch suffixes, and drops config-files leftovers', () => {
    const map = parseInstalledPriorities(PRIORITIES_RAW)
    expect(map.get('bash')).toBe('required')
    expect(map.get('libfoo')).toBe('optional')
    expect(map.has('removed-pkg')).toBe(false)
  })
})

describe('DISTRO_METAPACKAGE_RE', () => {
  it('matches the four flavor metapackage families and nothing else', () => {
    expect(DISTRO_METAPACKAGE_RE.test('ubuntu-minimal')).toBe(true)
    expect(DISTRO_METAPACKAGE_RE.test('ubuntu-desktop-minimal')).toBe(true)
    expect(DISTRO_METAPACKAGE_RE.test('kubuntu-desktop')).toBe(true)
    expect(DISTRO_METAPACKAGE_RE.test('ubuntu-wallpapers')).toBe(false)
    expect(DISTRO_METAPACKAGE_RE.test('ubuntu-drivers-common')).toBe(false)
  })
})

describe('classifyAptPackages', () => {
  const provider = makeFakeAptProvider({
    policySourcesRaw: POLICY_SOURCES_RAW,
    policyPackagesRaw: POLICY_PACKAGES_RAW,
    dependsClosureRaw: CLOSURE_RAW,
    prioritiesRaw: PRIORITIES_RAW
  })

  it('rule 1: a third-party-only installed source is user, even a repo without o= (zotero)', async () => {
    const result = await classifyAptPackages(provider, ['zotero', 'code'])
    expect(result.get('zotero')).toBe('user')
    expect(result.get('code')).toBe('user')
  })

  it('rule 2: metapackage closure membership is distro (ubuntu-wallpapers, priority optional)', async () => {
    const result = await classifyAptPackages(provider, ['ubuntu-wallpapers'])
    expect(result.get('ubuntu-wallpapers')).toBe('distro')
  })

  it('rule 3: required/important/standard priority is distro (bash, ubuntu-minimal)', async () => {
    const result = await classifyAptPackages(provider, ['bash', 'ubuntu-minimal'])
    expect(result.get('bash')).toBe('distro')
    expect(result.get('ubuntu-minimal')).toBe('distro')
  })

  it('rule 4 default: an Ubuntu-origin optional package outside the closure is user (zsh)', async () => {
    const result = await classifyAptPackages(provider, ['zsh'])
    expect(result.get('zsh')).toBe('user')
  })

  it('rule 4 default: a local .deb with no sources at all is user (claude-desktop)', async () => {
    const result = await classifyAptPackages(provider, ['claude-desktop'])
    expect(result.get('claude-desktop')).toBe('user')
  })

  it('fails safe: with empty raw inputs everything classifies as user (nothing gets hidden)', async () => {
    const empty = makeFakeAptProvider({})
    const result = await classifyAptPackages(empty, ['anything', 'bash'])
    expect(result.get('anything')).toBe('user')
    expect(result.get('bash')).toBe('user')
  })
})
