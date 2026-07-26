import { describe, expect, it } from 'vitest'
import { matchesDenylist } from './denylist'

// 케이스 출처: 구 repo ~/repos/rigsync/tests/test_dotfiles.py
// TestDotfilesDenylistApplyRejection / TestDotfilesDenylistCaptureNote 계열
// (행동만 옮김 — 코드 복사 아님).
describe('matchesDenylist', () => {
  it('blocks SSH private key basenames (id_*)', () => {
    expect(matchesDenylist('id_ed25519')).toBe(true)
    expect(matchesDenylist('id_rsa.pub')).toBe(true)
  })

  it('blocks *.pem certificates', () => {
    expect(matchesDenylist('server.pem')).toBe(true)
  })

  it('blocks dotenv-style secrets (.env*)', () => {
    expect(matchesDenylist('.env.local')).toBe(true)
  })

  it('blocks credential files wherever "credentials" sits in the basename', () => {
    expect(matchesDenylist('credentials.json')).toBe(true)
    expect(matchesDenylist('credentials_test')).toBe(true)
    // 2026-07-26 확대(`credentials*` → `*credentials*`): 선행 점이 붙은 이름도
    // 잡는다. 구 repo는 접두 고정이라 이 둘을 통과시켰다 — 이식 계약을 유지하지
    // 않기로 한 결정(사용자 승인)에 따라 뒤집은 동작이다.
    expect(matchesDenylist('.git-credentials')).toBe(true)
    expect(matchesDenylist('.credentials_test')).toBe(true)
  })

  it('blocks anything with "token" in the basename', () => {
    expect(matchesDenylist('aws_token')).toBe(true)
  })

  it('blocks anything with "secret" in the basename (실사례: secrets.zsh)', () => {
    expect(matchesDenylist('secrets.zsh')).toBe(true)
    expect(matchesDenylist('my-secret-config')).toBe(true)
    expect(matchesDenylist('SECRET')).toBe(false) // 대소문자 구분 — 기존 패턴들과 동일한 정책
  })

  it('blocks shell history files', () => {
    expect(matchesDenylist('.zsh_history')).toBe(true)
  })

  it('blocks known_hosts files', () => {
    expect(matchesDenylist('known_hosts')).toBe(true)
    expect(matchesDenylist('known_hosts.old')).toBe(true)
  })

  it('blocks *.key files', () => {
    expect(matchesDenylist('server.key')).toBe(true)
  })

  // 2026-07-26 실사례: Zotero WebDAV 브리지의 자격증명 파일들이 위 패턴을
  // 전부 통과했다(내용 기반 secretScan도 `RCLONE_PASS=`를 못 잡았다).
  it('blocks .env files that do not start with a dot (실사례: zotero-webdav.env)', () => {
    expect(matchesDenylist('zotero-webdav.env')).toBe(true)
    expect(matchesDenylist('production.env')).toBe(true)
    // 기존 `.env*` 경로도 그대로 유지된다.
    expect(matchesDenylist('.env')).toBe(true)
  })

  it('blocks credential files whose basename looks harmless (실사례: rclone.conf)', () => {
    expect(matchesDenylist('rclone.conf')).toBe(true)
    expect(matchesDenylist('.netrc')).toBe(true)
  })

  it('does not widen to every .conf file', () => {
    // 등재는 파일 하나 단위다 — 확장자 전체를 막으면 정상 설정이 동기화에서
    // 통째로 빠진다.
    expect(matchesDenylist('foo.conf')).toBe(false)
    expect(matchesDenylist('gearlever.conf')).toBe(false)
  })

  it('does not flag an ordinary dotfile', () => {
    expect(matchesDenylist('.zshrc')).toBe(false)
  })

  it('still requires the basename itself to match — a directory name does not leak in', () => {
    // 매칭 대상은 항상 basename이다(denylist.ts 모듈 주석). 호출부가 전체 경로가
    // 아니라 마지막 세그먼트를 넘기므로, 상위 디렉터리에 "secret"이 들어 있어도
    // 파일명이 평범하면 통과한다.
    expect(matchesDenylist('config.toml')).toBe(false)
  })
})
