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

## 계약 (반드시 지킬 것)

- `ok`는 **도구의 판정**입니다("도구가 실행됐다"가 아님). 문제를 찾으면 도구가 실패하지 않았어도 `ok: false`입니다.
- `attention`은 **조치 필요 여부**입니다. `ok: false`이거나 warning/error가 있으면 `true`, `info`는 `false`.
- `ok: false`에는 **항상 설명하는 진단**이 따라옵니다.
- 프리뷰는 **절대 통과가 아닙니다**(`summarizeValidation`이 `preview: true`면 `ok: false`).
- 실행 범위를 숨기지 않습니다. 워크스페이스에서 "테스트 통과"는 **무엇이 실제로 실행됐는지**와 함께여야 합니다(`TestReport.ranTargets`, `noTestsRan`).

## 개발

```bash
npm install
npm test              # 48 tests
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

- `0.1.0`, **아직 npm에 배포하지 않음**
- TypeScript 소스를 그대로 export합니다(`exports: "./src/index.ts"`). pi 확장 생태계가 TS를 직접 로드하므로 빌드 단계를 두지 않습니다.
- 소비자: `pi-rust-helper`(파일럿) → 검증 후 `pi-ros-helper`, `pi-python-helper` 순으로 마이그레이션 예정
