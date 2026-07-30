/**
 * repos 단건 등록 리졸버 — WS4("창고 모델 1차") `registry.ts`가 호출한다.
 * `capture.ts`의 스캔 루프(`scanGitDirsDepth1`)와 달리 주어진 경로 하나만
 * 확인해 common 계층 `repo` 배열에 upsert한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { expandHome } from '../../paths'
import { isGitWorktree } from './capture'
import { REPOS_LAYER } from './constants'
import type { GitProvider } from './providerTypes'
import type { RepoEntry, ReposManifest } from './types'

export class RepoPathNotFoundError extends Error {
  constructor(readonly repoPath: string) {
    super(`${repoPath}: 이 경로에 git 저장소가 없음`)
    this.name = 'RepoPathNotFoundError'
  }
}

/** `.git`이 gitdir 포인터 파일인 worktree는 자체 완결적 clone이 아니라 등록 대상이 아니다(capture.ts와 동일 원칙). */
export class RepoWorktreeNotSupportedError extends Error {
  constructor(readonly repoPath: string) {
    super(`${repoPath}: git worktree는 등록 대상이 아님(자체 완결적 clone이 아님)`)
    this.name = 'RepoWorktreeNotSupportedError'
  }
}

export async function registerRepoEntry(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'homeDir'>,
  provider: GitProvider,
  homePath: string
): Promise<void> {
  const abs = expandHome(ctx, homePath)
  if (!fs.existsSync(path.join(abs, '.git'))) throw new RepoPathNotFoundError(homePath)
  if (isGitWorktree(abs)) throw new RepoWorktreeNotSupportedError(homePath)

  const url = await provider.remoteUrl(abs)
  const branch = await provider.branch(abs)
  const entry: RepoEntry = { path: homePath, url, branch }

  const doc = readCommonLayer(ctx, REPOS_LAYER) as ReposManifest
  const entries = new Map<string, RepoEntry>((doc.repo ?? []).map((r) => [r.path, r]))
  entries.set(homePath, entry)
  writeCommonLayer(ctx, REPOS_LAYER, { repo: [...entries.values()] })
}
