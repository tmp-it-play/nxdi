# 원래 저장소로 돌아가는 가이드

현재 작업 대상은 [tmp-it-play/nxdi](https://github.com/tmp-it-play/nxdi)이고, 복귀 대상은 [it-play/nxdi](https://github.com/it-play/nxdi)입니다.

| 항목 | 임시 저장소 사용 중 | 원래 저장소 복귀 후 |
| --- | --- | --- |
| `origin` | `https://github.com/tmp-it-play/nxdi.git` | `https://github.com/it-play/nxdi.git` |
| 새 작업 브랜치의 분기점 | 최신 `origin/main` | 복귀 시 원래 저장소의 정책 확인 |
| PR 대상 브랜치 | `main` | 복귀 시 원래 저장소의 정책 확인 |
| `main`에서 직접 작업 커밋 | 금지 | 임시 제한 해제, 원래 저장소 정책 적용 |

이전 시 확인한 두 저장소의 기본 브랜치는 모두 `main`입니다. **기본 브랜치 설정과 작업 브랜치 규칙은 별개**입니다. `main`에서 작업 브랜치를 만들고 PR을 보내는 규칙은 `origin`이 `tmp-it-play/nxdi`일 때만 적용하며, 복귀 후에는 유지하지 않습니다. 기존 스킬의 `develop`/`master` 기본값 역시 복귀 시 실제 정책과 일치하는지 확인해야 합니다.

## 임시 저장소에서 작업하기

각 로컬 복제본에서 다음과 같이 설정합니다. `origin` 주소 변경은 `.git/config`에만 저장되므로 커밋으로 다른 복제본에 전파되지 않습니다.

```bash
git remote set-url origin https://github.com/tmp-it-play/nxdi.git
git fetch origin --prune
git remote set-head origin --auto
git remote -v
```

작업 내용을 정리한 상태에서 최신 `main`을 기준으로 작업 브랜치를 만듭니다. 아래 이름은 예시이며 작업에 맞게 바꿉니다.

```bash
git fetch origin
git switch --no-track -c update/example-change origin/main
```

PR 대상은 `tmp-it-play/nxdi`의 `main`입니다. 임시 저장소는 원래 저장소의 포크이므로 GitHub CLI를 직접 사용할 때도 `--repo tmp-it-play/nxdi`를 지정합니다. 루트 `AGENTS.md`와 커밋·PR 스킬에 임시 규칙이 있고, PR 생성 스크립트도 `origin` 주소에 따라 저장소와 `main`을 선택합니다. HTTPS와 일반 SSH 주소의 `.git` 접미사 유무를 지원합니다.

## 배포 연결 상태 및 이전 시 남은 작업

`origin` 변경만으로 Vercel의 Git 연결이나 GitHub Actions의 Secret·환경 설정이 옮겨지지는 않습니다. Vercel Git 연결은 [프로젝트 Git 설정](https://vercel.com/snowykte0426s-projects/nxdi/settings/git)에서 별도로 변경합니다([Vercel 공식 안내](https://vercel.com/docs/git/vercel-for-github)).

2026-09-28 Vercel 연결 변경과 운영 재배포를 완료했습니다. 당시 확인 결과는 다음과 같습니다. GitHub Actions를 통한 서버 자동 배포 준비는 별도 확인이 남아 있습니다.

| 항목 | 확인 결과 |
| --- | --- |
| Vercel 프로젝트 | 기존 `snowykte0426s-projects/nxdi` 프로젝트 사용 |
| Vercel GitHub 앱 | `tmp-it-play/nxdi` 한 저장소만 선택하여 설치 |
| Vercel Git 연결 | `tmp-it-play/nxdi` 연결 완료, 기존 `Project Link not found` 오류 해소 |
| 빌드 설정 | 루트 `client`, Next.js, Node.js `24.x`, 운영 브랜치 `main` |
| 현재 운영 배포 | `Ready`, 새 저장소 `main`의 `171ac23` 커밋, 2026-09-28 재배포 완료 |
| 프런트엔드 응답 | `https://nxdi.vercel.app/` HTTP 200 |
| 프런트엔드 API 프록시 | `https://nxdi.vercel.app/api/public/home` HTTP 200, JSON 응답 확인 |
| 백엔드 응답 | `https://kimtaeeun.site/nxdi-api/health` HTTP 200, 서비스 및 DB `ok` |
| 새 저장소 Actions | `main` 푸시 후 `CI`와 `Deploy Server`가 등록되어 `active` 상태. 실제 실행 성공 여부는 별도 확인 필요 |
| 새 저장소 배포 설정 | 저장소 Secret 목록과 Environment 목록이 비어 있음. 조직 Secret은 현재 CLI 권한 부족으로 확인하지 못함 |

[완료한 Vercel 운영 배포](https://vercel.com/snowykte0426s-projects/nxdi/HM61PMbQDLDA4JwcnXo3FgvfYcyH)는 기존 `nxdi.vercel.app` 도메인을 사용합니다. 최초 배포 생성은 문서·도구만 변경한 커밋이어서 `Ignored Build Step`에 의해 취소되었고, 해당 배포의 `Redeploy`에서 `Use project's Ignore Build Step`을 해제하여 재배포했습니다. 프로젝트의 일반 변경 감지 설정은 유지했습니다.

배포 연결 이전 절차와 남은 확인 항목은 다음과 같습니다.

1. **완료:** 기존 Vercel 프로젝트의 Git 연결을 `tmp-it-play/nxdi`로 변경하고 저장소 접근, 빌드 루트 `client`, 운영 브랜치 `main`을 확인했습니다. 기존 도메인과 프로젝트 설정을 유지했습니다.
2. **등록 확인 완료, 실행 검증 필요:** 새 저장소의 [Actions](https://github.com/tmp-it-play/nxdi/actions)에서 `CI`와 `Deploy Server`의 실제 실행 결과를 확인합니다. 워크플로 활성화 상태만으로 실행 성공을 판단하지 않습니다.
3. **확인 필요:** 서버 워크플로가 사용하는 `production` 환경과 `SERVER_ENV`, `DATA_ENCRYPTION_KEY_BASE64`, `SERVER_HOST`, `SERVER_USER`, `SERVER_PASSWORD` Secret을 준비합니다. Secret 값은 가이드나 Git에 기록하지 않습니다.
4. **Vercel 완료, 서버 별도:** 새 저장소 커밋의 Vercel 운영 배포와 서비스 응답을 검증했습니다. 서버 재배포는 실행하지 않았으며, 현재 서비스와 DB가 정상 응답하는 것을 확인했습니다.

`Deploy Server`의 자동 실행은 `main`에 반영된 `server/**` 변경으로 한정됩니다. Vercel에도 `client/vercel.json`의 변경 감지 조건이 있으므로, 문서만 변경한 커밋은 배포 검증용으로 적절하지 않을 수 있습니다.

## 복귀 순서

### 1. 진행 중인 작업 보존

```bash
git status --short
git branch -vv
git remote -v
```

필요한 변경을 커밋하거나 따로 보관하고, 미전송 커밋과 열린 PR을 확인합니다. 저장소를 별도로 복제해 사용한 경우 커밋과 PR이 자동으로 옮겨지지는 않으므로, 가져갈 작업 브랜치와 커밋을 먼저 정리합니다.

### 2. `origin`을 원래 주소로 변경

```bash
git remote set-url origin https://github.com/it-play/nxdi.git
git fetch origin --prune
git remote set-head origin --auto
git remote -v
git symbolic-ref --short refs/remotes/origin/HEAD
git branch -vv
```

fetch와 push 주소가 모두 `it-play/nxdi`인지 확인합니다. 별도 push URL을 설정한 복제본은 해당 설정도 확인합니다. 원래 저장소의 기본 브랜치와 작업 정책을 확인한 뒤 필요한 커밋을 반영합니다. 로컬과 원격 이력이 다르면 차이를 검토하여 병합하거나 필요한 커밋만 가져오고, 강제 푸시나 `reset --hard`로 덮어쓰지 않습니다.

### 3. 스킬 원복 및 임시 규칙 제거

위 주소 변경 즉시 임시 규칙은 적용되지 않습니다. **복귀 작업에는 커밋·PR 스킬과 PR 생성 스크립트의 이전 관련 변경을 원복(revert)하는 작업도 반드시 포함합니다.** 임시 분기만 비활성화하거나 안내 문구만 삭제한 상태로 끝내지 않습니다. 스킬 설명과 명령 예시까지 이전 전 내용으로 되돌리되, 이후 추가된 다른 변경은 보존합니다.

이전 직전 기준 커밋은 `e204e5a6d738023bdde927179a4a55225483cab2`입니다. 복귀 작업 브랜치에서 다음 세 파일의 변경을 확인합니다.

```bash
git diff e204e5a6d738023bdde927179a4a55225483cab2 -- \
  .agents/skills/git-commit/SKILL.md \
  .agents/skills/write-pr/SKILL.md \
  .agents/skills/write-pr/scripts/create-pr.sh
```

차이가 이번 저장소 이전을 위한 변경뿐이라면 아래 명령으로 세 파일을 원본 내용으로 복원합니다. 이는 작업 트리 변경이며, 검토 후 복귀 변경과 함께 커밋합니다.

```bash
git restore --source=e204e5a6d738023bdde927179a4a55225483cab2 -- \
  .agents/skills/git-commit/SKILL.md \
  .agents/skills/write-pr/SKILL.md \
  .agents/skills/write-pr/scripts/create-pr.sh
```

다른 변경이 섞여 있다면 파일 전체를 복원하지 않고, 기준 커밋과 비교해 이전 관련 변경만 되돌립니다. 이후 정상적인 개선까지 덮어쓰지 않습니다. 원복 범위는 다음과 같습니다.

| 파일 | 제거할 내용 |
| --- | --- |
| `AGENTS.md` | `Temporary Repository Workflow` 절 전체 |
| `.agents/skills/git-commit/SKILL.md` | 임시 저장소 절, 추가한 Git Flow 소제목, 원격 조회 명령 및 이전 때문에 바꾼 스킬 설명과 안내를 원복 |
| `.agents/skills/write-pr/SKILL.md` | Step 1에 추가한 임시 저장소 판별, `origin/main` 전용 명령, PR 저장소 지정과 원복 안내를 모두 원복 |
| `.agents/skills/write-pr/scripts/create-pr.sh` | 원격 판별과 `main` 강제, 임시 저장소 PR 대상 지정, 관련 인자 변경을 모두 원복하여 기존 스크립트로 복원 |

PR 생성 스크립트에서 임시 분기를 제거하면 기존 브랜치 판별은 아래와 같습니다. 이 값들이 원래 저장소의 실제 정책과 다르면 현재 정책에 맞게 수정합니다. 임시 규칙을 이유로 `main`을 강제하지 않습니다.

```bash
CURRENT=$(git branch --show-current)
case "$CURRENT" in
  feature/*)  BASE="develop" ;;
  develop)    BASE="master" ;;
  *)          BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null || echo "develop") ;;
esac
```

`CLAUDE.md`는 `AGENTS.md`를 따르므로 별도 임시 규칙은 없습니다. 이 가이드는 복귀 이력으로 남기고 완료 여부를 기록하거나, 불필요하면 `README.md`의 링크와 함께 삭제합니다.

### 4. 배포 연결도 원래 저장소로 복귀

임시 저장소로 배포 연결을 옮겨 사용했다면, 로컬 `origin`과 스킬 원복에 더해 아래 설정도 되돌립니다.

1. 원래 저장소에 대한 Vercel GitHub 앱 접근이 복구되었는지 확인하고, 기존 Vercel 프로젝트의 Git 연결을 `it-play/nxdi`로 변경합니다. 연결 오류가 없어야 합니다.
2. 도메인 `nxdi.vercel.app`, 빌드 루트 `client`, 환경변수와 운영 배포 브랜치를 확인합니다. 임시 작업 브랜치 규칙을 제거하는 것과 Vercel 운영 브랜치 설정은 별개이므로, 브랜치 규칙 원복만을 이유로 운영 브랜치를 바꾸지 않습니다.
3. 원래 저장소의 `CI`, `Deploy Server`, `production` 환경, 서버 배포 Secret을 확인합니다. 임시 사용 기간에 변경한 배포 설정이 있다면 복귀 대상에도 필요한 값을 반영합니다.
4. 원래 저장소 커밋으로 배포 성공 및 프런트엔드·백엔드 상태를 확인한 뒤, 임시 저장소의 서버 자동 배포를 중지하여 같은 서버에 두 저장소가 배포하지 않도록 정리합니다.
5. 임시 저장소를 통한 배포가 더 이상 필요 없다면, 이번에 설치한 Vercel GitHub 앱의 `tmp-it-play/nxdi` 접근도 해제합니다. 다른 프로젝트가 사용 중인 설치나 저장소 권한은 보존합니다.

### 5. 복귀 확인

```bash
git remote -v
git diff --check
bash -n .agents/skills/write-pr/scripts/create-pr.sh
rg -n 'tmp-it-play|Temporary Repository Workflow|Temporary repository|Temporary repository override' AGENTS.md .agents/skills/git-commit .agents/skills/write-pr
```

마지막 검색에 임시 규칙이 남아 있지 않아야 합니다(일치 항목이 없으면 종료 코드 1). 변경 내용을 검토하고 원래 저장소의 브랜치 정책에 따라 반영합니다. 다른 로컬 복제본도 `origin`을 별도로 변경하고, 별도 저장소로 옮겼다면 CI·배포 연결과 저장소 설정도 복귀 대상을 가리키는지 확인합니다.
