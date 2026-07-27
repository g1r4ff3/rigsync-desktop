/**
 * packages 테스트 전용 fake provider — 이 파일은 Vitest include 패턴에
 * 안 걸리므로 테스트 파일이 아니다. **실제 apt-mark/snap/flatpak 호출이나
 * /etc/apt 파일 접근은 여기 어디에도 없다** (P2a 결정 ⑥).
 */
import type {
  AptProvider,
  AptSourceFile,
  FlatpakAppDetail,
  FlatpakAppRow,
  FlatpakCommandResult,
  FlatpakOverrideFile,
  FlatpakProvider,
  FlatpakRemoteRow,
  SnapListRow,
  SnapProvider
} from './providerTypes'

export interface FakeAptProviderOptions {
  readonly available?: boolean
  readonly manual?: readonly string[]
  readonly sourceFiles?: readonly AptSourceFile[]
  /** 절대경로 -> 내용. `fileExists`/`readFileBytes`가 여기서만 답한다. */
  readonly files?: Readonly<Record<string, string | Buffer>>
  /** 패키지명 -> 한 줄 설명. `descriptions()`가 여기서만 답한다(기본 빈 맵). */
  readonly descriptions?: Readonly<Record<string, string>>
  /** `removeDryRun()`이 그대로 돌려줄 원문 stdout+stderr (기본 빈 문자열). */
  readonly removeDryRunOutput?: string
  /**
   * refactor-spec-v0.2 §1 분류 픽스처의 지름길 — 패키지명 -> 원하는 분류.
   * distro는 priority=required, user는 priority=optional인 `prioritiesRaw`
   * 원문을 합성해(분류 규칙 3 경유) 그 분류가 나오게 한다. 파서 자체를
   * 검증하는 테스트는 이 지름길 대신 아래 raw 4종을 직접 준다. 기본(전부
   * 미지정)은 원료가 전부 빈 문자열 -> 모든 이름이 규칙 4(기본값 사용자)로
   * 떨어진다 — 분류에 관심 없는 기존 캡처/디프 테스트가 그대로 동작하는
   * 안전 기본값(classify.ts의 "안전한 실패 방향"과 같은 성질).
   */
  readonly classify?: Readonly<Record<string, 'user' | 'distro'>>
  readonly policySourcesRaw?: string
  readonly policyPackagesRaw?: string
  readonly dependsClosureRaw?: string
  readonly prioritiesRaw?: string
  /** dpkg가 소유한 것으로 답할 절대경로 집합. `dpkgOwnsPaths()`가 여기서만 답한다(기본 빈 집합 -- 전부 미소속). */
  readonly dpkgOwnedPaths?: readonly string[]
}

export interface FakeAptProvider extends AptProvider {
  readonly removeDryRunCalls: string[][]
}

export function makeFakeAptProvider(opts: FakeAptProviderOptions = {}): FakeAptProvider {
  const files = new Map<string, Buffer>(
    Object.entries(opts.files ?? {}).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(v)])
  )
  const removeDryRunCalls: string[][] = []
  return {
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증). isAvailable은 AptProvider 인터페이스상
    // 그대로 plain boolean이라(providerTypes.ts) 감싸지 않는다.
    isAvailable: () => opts.available ?? true,
    manualInstalled: () => Promise.resolve([...(opts.manual ?? [])]),
    listSourceFiles: () => [...(opts.sourceFiles ?? [])],
    fileExists: (p) => files.has(p),
    readFileBytes: (p) => files.get(p) ?? null,
    descriptions: (names) => {
      const table = opts.descriptions ?? {}
      const out: Record<string, string> = {}
      for (const name of names) if (table[name] !== undefined) out[name] = table[name]
      return Promise.resolve(out)
    },
    removeDryRun: (names) => {
      removeDryRunCalls.push([...names])
      return Promise.resolve(opts.removeDryRunOutput ?? '')
    },
    policySourcesRaw: () => Promise.resolve(opts.policySourcesRaw ?? ''),
    policyPackagesRaw: () => Promise.resolve(opts.policyPackagesRaw ?? ''),
    dependsClosureRaw: () => Promise.resolve(opts.dependsClosureRaw ?? ''),
    prioritiesRaw: () => {
      if (opts.prioritiesRaw !== undefined) return Promise.resolve(opts.prioritiesRaw)
      if (!opts.classify) return Promise.resolve('')
      return Promise.resolve(
        Object.entries(opts.classify)
          .map(([name, cls]) => `${name}\t${cls === 'distro' ? 'required' : 'optional'}\tinstalled`)
          .join('\n')
      )
    },
    dpkgOwnsPaths: (paths) => {
      const owned = new Set(opts.dpkgOwnedPaths ?? [])
      return Promise.resolve(new Set(paths.filter((p) => owned.has(p))))
    },
    removeDryRunCalls
  }
}

export function makeFakeSnapProvider(
  rows: readonly SnapListRow[] = [],
  available = true
): SnapProvider {
  return {
    isAvailable: () => available,
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증).
    list: () => Promise.resolve([...rows])
  }
}

export interface FakeFlatpakProviderOptions {
  readonly available?: boolean
  readonly remotes?: readonly FlatpakRemoteRow[]
  readonly apps?: readonly FlatpakAppRow[]
  readonly addRemoteResult?: FlatpakCommandResult
  readonly installResult?: FlatpakCommandResult
  /** appId -> 라이브 override 파일 내용. `listOverrideFiles`/`overrideFileExists`/`readOverrideFileBytes`가 여기서만 답한다. */
  readonly overrideFiles?: Readonly<Record<string, string | Buffer>>
  readonly writeOverrideResult?: FlatpakCommandResult
  readonly uninstallResult?: FlatpakCommandResult
  /** applicationId -> {name, description}. `appDetails()`가 여기서만 답한다(기본 빈 맵). */
  readonly details?: Readonly<Record<string, FlatpakAppDetail>>
}

export interface FakeFlatpakProvider extends FlatpakProvider {
  readonly addRemoteCalls: Array<{ name: string; url: string }>
  readonly installCalls: Array<{ origin: string; application: string }>
  readonly writeOverrideCalls: Array<{ appId: string; content: Buffer }>
  readonly uninstallCalls: string[]
}

export function makeFakeFlatpakProvider(
  opts: FakeFlatpakProviderOptions = {}
): FakeFlatpakProvider {
  const addRemoteCalls: Array<{ name: string; url: string }> = []
  const installCalls: Array<{ origin: string; application: string }> = []
  const writeOverrideCalls: Array<{ appId: string; content: Buffer }> = []
  const uninstallCalls: string[] = []
  const overrideFiles = new Map<string, Buffer>(
    Object.entries(opts.overrideFiles ?? {}).map(([k, v]) => [
      k,
      Buffer.isBuffer(v) ? v : Buffer.from(v)
    ])
  )

  return {
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증). isAvailable은 FlatpakProvider
    // 인터페이스상 plain boolean이라(providerTypes.ts) 감싸지 않는다.
    isAvailable: () => opts.available ?? true,
    remotes: () => Promise.resolve([...(opts.remotes ?? [])]),
    apps: () => Promise.resolve([...(opts.apps ?? [])]),
    appDetails: () => Promise.resolve({ ...(opts.details ?? {}) }),
    addRemoteUser: (name, url) => {
      addRemoteCalls.push({ name, url })
      return Promise.resolve(opts.addRemoteResult ?? { ok: true, output: '' })
    },
    installAppUser: (origin, application) => {
      installCalls.push({ origin, application })
      return Promise.resolve(opts.installResult ?? { ok: true, output: '' })
    },
    listOverrideFiles: (): FlatpakOverrideFile[] =>
      [...overrideFiles.entries()].map(([appId, content]) => ({
        appId,
        content: content.toString('utf-8')
      })),
    overrideFileExists: (appId) => overrideFiles.has(appId),
    readOverrideFileBytes: (appId) => overrideFiles.get(appId) ?? null,
    writeOverrideFile: (appId, content) => {
      writeOverrideCalls.push({ appId, content })
      overrideFiles.set(appId, content)
      return opts.writeOverrideResult ?? { ok: true, output: '' }
    },
    uninstallAppUser: (application) => {
      uninstallCalls.push(application)
      return Promise.resolve(opts.uninstallResult ?? { ok: true, output: '' })
    },
    addRemoteCalls,
    installCalls,
    writeOverrideCalls,
    uninstallCalls
  }
}
