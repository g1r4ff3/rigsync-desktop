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

  it('blocks credentials* files', () => {
    expect(matchesDenylist('credentials.json')).toBe(true)
    expect(matchesDenylist('credentials_test')).toBe(true)
  })

  it('blocks anything with "token" in the basename', () => {
    expect(matchesDenylist('aws_token')).toBe(true)
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

  it('does not flag an ordinary dotfile', () => {
    expect(matchesDenylist('.zshrc')).toBe(false)
  })

  it('does not flag a leading-dot name that only coincidentally shares a prefix', () => {
    // 구 테스트의 주석: basename이 실제로 denylist glob에 매치해야 한다 —
    // ".credentials_test" 같은 leading-dot 이름은 "credentials*"에 매치하지 않는다.
    expect(matchesDenylist('.credentials_test')).toBe(false)
  })
})
