# pi-helper-core

pi 언어 헬퍼 확장(`pi-ros-helper`, `pi-python-helper`, `pi-rust-helper`, …)이 공유하는 **생태계 중립 코어**입니다.

## 왜 필요한가

`pi-ros-helper`와 `pi-python-helper`는 같은 것을 각자 구현했습니다.

- `src/core/version.ts` → **바이트 단위로 동일**
- `src/core/result.ts` → 같은 envelope, 이미 **드리프트**(ROS에 `attention`/`CommandPreview.risk` 없음)
- `src/core/{runner,safety}.ts`, `src/validation/{bundle,evidence,tdd}.ts`, `src/build/staleness.ts` → 양쪽에 중복

확장을 하나 더 복사할 때마다 이 계약이 한 벌씩 늘어납니다. 이 패키지가 단일 진실입니다.

## 무엇이 들어 있나

| 모듈 | 내용 |
|---|---|
| `core/result.ts` | 응답 envelope, `ok`/`attention` 계약, 생태계 중립 `ToolchainInfo` |
| `core/runner.ts` | 타임아웃·`AbortSignal`·출력 상한이 걸린 단일 서브프로세스 진입점 |
| `core/safety.ts` | 명령 위험도 분류(universal 규칙 + 어댑터 규칙 주입) |
| `core/transport.ts` | 명령 실행 위치 seam(로컬/원격) + 경로 매핑 fail-closed |
| `validation/evidence.ts` | 완료 증거 게이트 |
| `validation/tdd.ts` | 프로덕션 변경 ↔ 테스트 변경 연관 검사 |
| `validation/bundle.ts` | 검증 번들 요약 게이트 |
| `build/staleness.ts` | 파생 산출물이 소스보다 오래됐는지 판정 |
| `selection/select.ts` | 테스트 선별 랭킹 알고리즘 |
| `adapter.ts` | `EcosystemAdapter` 계약 |

**들어 있지 않은 것**: 도구 등록(`registerTool` 호출 금지), 특정 생태계의 명령·매니페스트·출력 형식. `test/purity.test.ts`가 코어 소스에 생태계 이름이 들어오는 것을 막습니다.

## 사용법

기존 헬퍼는 로컬 shim 두 줄로 마이그레이션할 수 있습니다. 호출부는 바뀌지 않습니다.

```ts
// src/core/result.ts (헬퍼 쪽 shim)
import { createResultFactory } from 'pi-helper-core';
import { TOOL_VERSION } from './version.ts';

export const { result, failure } = createResultFactory(TOOL_VERSION);
export { warn, note } from 'pi-helper-core';
export type { ToolResult, Diagnostic, CommandPreview, ToolchainInfo } from 'pi-helper-core';
```

어댑터는 생태계 지식만 채웁니다.

```ts
import { defineAdapter } from 'pi-helper-core';

export const adapter = defineAdapter({
  id: 'rust',
  riskRules: [/* cargo 전용 규칙 */],
  selectionSignals: {/* 파일 분류, 모듈명, 토큰 */},
  resolveToolchain: async (ctx) => {/* ... */},
  readProjectModel: async (ctx) => {/* ... */},
  testCommand: (input, ctx) => {/* ... */},
  parseTestOutput: (stdout, stderr) => {/* ... */},
  diagnoseFailure: (output) => {/* ... */},
  derivedArtifacts: () => [],
  testDirectories: () => ['tests'],
  checkCommand: (input, ctx) => {/* ... */},
});
```

## 원격 실행 (transport)

코어의 모든 서브프로세스는 `runCommand()` 한 곳을 지나갑니다. 여기에 transport를 등록하면
호출부 수정 없이 헬퍼 전체가 원격에서 명령을 실행합니다.

```ts
import { setTransport, mapPathPrefix, type CommandTransport } from 'pi-helper-core';

setTransport({
  id: 'ssh:robot-01',
  exec: async (spec) => sshExec(spec),          // RunResult를 돌려주거나, 시도조차 못 했으면 reject
  mapCwd: (cwd) => mapPathPrefix(cwd, '/home/me/ws', '/home/robot/ws'),
});
setTransport(null);                            // 로컬 실행으로 복귀
```

- transport는 **명령이 실행됐지만 실패한 경우 `RunResult`를 resolve**하고, **시도조차 못 했으면 reject**합니다. 빈 성공 결과는 통과로 오인됩니다.
- `mapCwd`가 throw하면 명령은 실행되지 않습니다(fail-closed). 엉뚱한 디렉터리에서 빌드/테스트가 도는 것보다 실패가 낫습니다.
- 레지스트리는 `Symbol.for('pi-helper-core.transport')`로 `globalThis`에 저장됩니다. npm이 이 패키지 사본 2개를 hoisting해도 라우팅이 유지됩니다.

## 계약 (반드시 지킬 것)

- `ok`는 **도구의 판정**입니다("도구가 실행됐다"가 아님). 문제를 찾으면 도구가 실패하지 않았어도 `ok: false`입니다.
- `attention`은 **조치 필요 여부**입니다. `ok: false`이거나 warning/error가 있으면 `true`, `info`는 `false`.
- `ok: false`에는 **항상 설명하는 진단**이 따라옵니다.
- 프리뷰는 **절대 통과가 아닙니다**(`summarizeValidation`이 `preview: true`면 `ok: false`).
- 실행 범위를 숨기지 않습니다. 워크스페이스에서 "테스트 통과"는 **무엇이 실제로 실행됐는지**와 함께여야 합니다(`TestReport.ranTargets`, `noTestsRan`).

## 개발

```bash
npm install
npm test              # 56 tests
npm run typecheck
npm run check         # test + typecheck + format:check + pack-check
```

## 릴리스

`package.json` 버전을 올리고 CHANGELOG를 옮긴 뒤 `v<version>` 태그를 푸시하면 `.github/workflows/publish.yml`이 npm provenance와 함께 배포합니다.

### 최초 배포만 수동이어야 합니다 (중요)

**npm Trusted Publishing(OIDC)은 패키지의 최초 버전을 만들 수 없습니다.** trusted publisher는 이미 존재하는 패키지에만 설정할 수 있기 때문에, 신규 패키지의 첫 배포는 OIDC로 실패하고 `ENEEDAUTH`가 나옵니다(npm/cli#8544, npm/documentation#1926). 이 오류는 인증 설정 오류처럼 보이지만 실제 원인은 그게 아닙니다.

최초 1회만:

1. `npm login` (패키지 소유자 계정)
2. `npm publish --access public` — **provenance 없이** 올라갑니다
3. npmjs.com → 패키지 → Settings → **Trusted Publisher** → GitHub Actions
   - Organization or user: `wkqco33`
   - Repository: `pi-helper-core`
   - Workflow filename: `publish.yml` (경로가 아니라 파일명만, 대소문자 구분)
   - Allowed actions: `npm publish`
4. 이후 태그 푸시는 OIDC + provenance로 자동 배포됩니다

부트스트랩 후에는 Settings → Publishing access에서 **"Require two-factor authentication and disallow tokens"**를 켜 두는 것이 권장됩니다.

> 워크플로에 `actions/setup-node`의 `registry-url`을 쓰지 마세요. `_authToken=${NODE_AUTH_TOKEN}` 줄을 써 넣고, 토큰이 없을 때 빈 값으로 확장되어 **OIDC 대신 일반 인증을 시도**합니다(ENEEDAUTH/E404의 가장 흔한 원인).

## 상태

- `0.1.2`, npm에 배포됨(`latest`).
- TypeScript 소스를 그대로 export합니다(`exports: "./src/index.ts"`). pi 확장 생태계가 TS를 직접 로드하므로 빌드 단계를 두지 않습니다.
- 소비자: `pi-rust-helper`(파일럿), `pi-ros-helper`, `pi-python-helper` 모두 `^0.1.1`을 의존한다(2026-09-21).
  - `pi-python-helper`: envelope/runner/TDD/번들/증거/staleness/selection 이관 완료.
  - `pi-ros-helper`: envelope/runner/TDD/증거 이관 완료.
  - 알려진 seam 부족분은 `pi-rust-helper/DEVELOPMENT-PLAN.md`의 "R1 실현" 참고:
    범용 안전 override(`--frozen`/`--locked`) 과다는 0.1.2에서 수정됨,
    `summarizeValidation`의 고정 단계 형태, 바이너리 mtime staleness·CTest 타겟 선별 미지원은 남음.
