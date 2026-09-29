# 이메일 알림 배포·운영

이메일 알림은 기존 Fastify 서버와 MySQL을 사용한다. 서버가 시작되면 운영 자동 발송을 실행한다. 관리자는 `/admin#admin-notifications`의 발송 이력 패널에서 상태를 확인하고 상세 모달을 연다. 임시 테스트 발송 기능은 코드에서 제거했다. 필수 SMTP 환경변수가 누락되거나 유효하지 않으면 서버 시작을 실패 처리한다.

## 스키마 최초 배포

기존 저장소에 SQL migration 이력이 없어서 아래 두 migration을 추가했다.

1. `20260927000000_existing_schema_baseline`: 이메일 기능을 추가하기 전 Prisma 모델의 정확한 기준선. 같은 디렉터리의 `schema.prisma`는 기존 DB와 대조하는 보존본이다.
2. `20260928000000_email_notifications`: `tb_notification_recipients`, `tb_notification_events`, `tb_email_deliveries`, `tb_email_delivery_attempts`, `tb_notification_controls`만 추가한다. 기존 업무 테이블을 변경하거나 삭제하지 않는다.

월별 지급액·분기 확인서의 원본은 이벤트의 버전별 `payload`와 저장된 HTML·텍스트 본문으로 보존한다. 개인별 본문과 계산 원본은 해당 전송 항목에 저장한다. 별도 원본 테이블 두 개는 중복 생성하지 않는다. 공시·실배당의 ID는 원본 식별용 문자열이므로 원본 삭제가 발송 이력을 지우지 않는다. 이벤트→전송→시도 관계도 `Restrict`로 보호한다.

### 기존 DB

운영자가 DB를 백업하고 복구 가능성을 확인한 뒤, 스키마를 변경하는 다른 작업을 멈춘 유지보수 구간에서 진행한다. 테이블 이름 변경은 기존 `rename_tables.sh` 절차를 먼저 완료한다. 새 baseline을 적용했다는 이유로 기존 데이터·인덱스 차이를 무시하지 않는다.

서버 디렉터리에서 승인된 비밀 환경변수 주입 방법으로 `DATABASE_URL`을 제공한다. 비밀번호가 포함된 URL을 명령 인수나 셸 기록에 넣지 않는다.

```sh
npm run db:notification-baseline -- --check
```

이 명령은 DB의 테이블 구조·기존 migration 이력을 읽고 보존한 기준선과 비교한다. 행 데이터·스키마·migration 이력을 변경하지 않는다. 차이가 있거나 알 수 없는 migration 이력이 있으면 종료 코드 1로 중단한다. 차이는 DBA가 개별 검토하며 `db push`, `migrate reset`, 임의 `resolve`로 우회하지 않는다. 기준선과 일치한 DB에서만 다음을 실행한다.

```sh
npm run db:notification-baseline -- --mark-applied
npm run db:migrate
```

`--mark-applied`는 같은 검사를 다시 수행하고 `_prisma_migrations`에 기존 기준선만 기록한다. 기존 업무 테이블에 `CREATE TABLE`을 재실행하지 않는다. `db:migrate`가 새 알림 테이블을 만든다. 빈 DB에는 baseline 기록을 먼저 남기지 말고 `npm run db:migrate`로 두 SQL migration을 순서대로 적용한다.

Docker 이미지에도 Prisma CLI·schema engine·baseline 스크립트가 포함된다. 배포 디렉터리에서 동일 절차를 다음과 같이 실행할 수 있다.

```sh
docker compose -f deploy/compose.yml build
docker compose -f deploy/compose.yml run --rm --no-deps server npm run db:notification-baseline -- --check
docker compose -f deploy/compose.yml run --rm --no-deps server npm run db:notification-baseline -- --mark-applied
docker compose -f deploy/compose.yml run --rm --no-deps server npm run db:migrate
```

`after_install.sh`는 기존 테이블 rename 뒤에 `prisma migrate deploy`를 실행한다. 기준선이 확인되지 않은 기존 DB에서는 첫 배포가 실패하도록 둔다. 자동으로 baseline 처리하거나 production DB를 초기화하지 않는다. SQL 적용 오류가 발생하면 해당 migration의 상태와 DB 실제 적용분을 확인하고 복구한 뒤 재개한다. 알림 테이블을 삭제해서 재시도하지 않는다.

### 수신 주소 선택

발송 항목을 만들 때 완료된 투자 의향서의 신청자 이메일(`userEmail`)을 DB에서 한 번 조회한다. 같은 투자자에게 서로 다른 주소가 여러 개면 각 주소에 개인별 메일을 한 번씩 만들고, 중복 주소는 한 번만 사용한다. DataGSM 로그인 이메일과 의향서의 연락처 입력란은 별도 수신 주소로 추가하지 않는다.

조회한 주소는 발송 항목에 저장한다. 대기 중 의향서 이메일이 바뀌어도 기존 발송 항목과 재시도 주소는 바뀌지 않는다. 주소가 없거나 형식이 잘못된 의향서는 관리자 화면에 표시하며, 수정된 주소로 보내려면 현재 데이터를 이용해 정정 발송을 준비한다. 기존 `tb_notification_recipients`와 부트스트랩 스크립트는 과거 이력용으로 남아 있지만 새 발송 항목의 주소 선택에는 사용하지 않는다.

## 필수 SMTP 설정과 최초 시작

서버 전용 환경변수는 [예시](../server/.env.example)를 따른다. 다음 여섯 항목을 모두 명시적으로 제공해야 서버가 시작된다. 예시에 적힌 호스트·포트·계정·발신자는 런타임 기본값으로 대체되지 않는다.

| 필수 변수 | 입력값·의미 |
| --- | --- |
| `SMTP_HOST` | `mail.kimtaeeun.site` |
| `SMTP_PORT` / `SMTP_SECURE` | `465` / `true` |
| `SMTP_USER` | `contact@kimtaeeun.site` |
| `SMTP_PASSWORD` | 서버 시작 전에 사용자가 비밀 환경변수로 입력. 실제 값을 저장소에 기록하지 않음 |
| `MAIL_FROM` | `NXDI <contact@kimtaeeun.site>` |

처리량·시간 제한은 다음 기본값을 사용하며 필요하면 조정할 수 있다.

| 선택 변수 | 기본값·의미 |
| --- | --- |
| `MAIL_BATCH_SIZE` | 한 작업 회차 최대 20건 |
| `SMTP_CONNECTION_TIMEOUT_MS` | DNS·연결·인사 각각 최대 10초 |
| `SMTP_SOCKET_TIMEOUT_MS` | 소켓 비활성 최대 20초 |

호스트·포트·TLS 방식·계정·비밀번호·발신자 중 하나라도 빠지면 시작 시 환경변수 검증에서 중단한다. 이는 설정 형식 검증이며 SMTP 접속·인증 성공을 의미하지 않는다. 포트 465에는 연결 시작부터 TLS를 사용하고 인증서 검증을 유지한다. 다른 포트에서 `SMTP_SECURE=false`를 지정하면 STARTTLS를 필수로 요구한다. 환경변수 변경 후 서버를 재시작한다. IMAP 연결은 사용하지 않는다.

실제 메일 검증이 필요하면 운영 투자자 의향서·발송 대기 항목이 없는 격리된 스테이징 DB에서 진행한다. 임시 테스트 화면·샘플·고정 수신자·임의 지급액 발송 API는 제공하지 않는다. 발송 권한을 확인한 검증용 계정과 데이터로 운영 이벤트 경로를 점검하고, 받은 메일의 한글·표·링크·텍스트 대체 본문과 휴대전화 가독성을 확인한다.

`ACCEPTED`는 SMTP 서버 접수 성공을 뜻하며 받은편지함 도착·열람 성공을 뜻하지 않는다. 격리 환경의 지정 주소에서 실제 수신을 확인하고 운영 DB의 스키마·의향서 신청자 이메일을 점검한 뒤 운영 서버를 시작한다. 알림 서버 최초 시작 시각은 `NotificationControl.activatedAt`에 한 번 저장되며 이후 예정된 기간의 누락 복구 기준이 된다. 재시작으로 초기화하지 않고, 과거 내역을 테스트하려고 이 값을 수정하지 않는다. 과거 TEST 원본·전송 이력은 보존하지만 새 테스트 발송은 처리하지 않는다.

## 실패·정정·종료

- 일시 SMTP 거절 또는 명확한 DNS·연결 실패는 저장된 원본과 수신 주소로 재시도한다. 인증·인증서·영구 거절은 설정과 저장된 수신 주소를 확인한 뒤 관리 화면에서 처리한다.
- 소켓 종료·응답 유실은 SMTP 접수 여부가 불명확할 수 있다. Nodemailer가 `command=CONN`을 기록해도 전송 전 실패라고 간주하지 않는다. 명확한 미접수 근거가 없으면 `UNKNOWN`으로 남기고 서버 로그의 저장된 Message-ID와 대조한다.
- `UNKNOWN`과 `ACCEPTED`를 일반 실패 재시도로 보내지 않는다. 확인된 근거를 결과 확인 작업에 남기고, 이미 접수된 내용을 바꾸려면 새 정정 버전을 준비하고 미리보기 후 별도로 전송한다.
- 운영 관리의 수동 재시도·정정은 `PRODUCTION` 기록만 허용한다. 과거 `TEST` 기록도 관리자 API로 상세·본문·시도 이력을 조회하고 `UNKNOWN`의 확인 근거를 기록할 수 있지만 운영 재시도 경로로 다시 발송할 수 없다.
- SMTP 연결은 한 번에 한 개를 사용한다. Nodemailer 내부 재시도는 `maxRequeues=0`으로 끄고 애플리케이션의 영속화된 재시도 정책만 사용한다. 종료 시 신규 접수를 멈추고 진행 중 요청을 정리한다. 강제 종료 후 미완료 시도는 저장된 단계와 claim 만료로 복구한다.
- SMTP 원문 로그·오류 메시지·오류 cause를 일반 로그에 남기지 않는다. 어댑터 오류는 정해진 코드로 정규화하고 SMTP 응답에서는 숫자 상태 코드만 저장한다. 전체 주소·계산액·본문은 접근이 제한된 관리 조회에서만 확인한다.

구현 근거: [Nodemailer SMTP·TLS 설정](https://nodemailer.com/smtp), [연결 풀·내부 재시도](https://nodemailer.com/smtp/pooled), [오류 구조](https://nodemailer.com/errors), [Prisma 기준선 절차](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining).

## 임시 테스트 기능 제거 후 배포

임시 서버 모듈·전용 테스트·클라이언트 화면과 등록 코드를 삭제했다. 작업자는 `PRODUCTION`만 가져오며, 구버전 TEST claim도 SMTP 시도 생성 전에 거절한다. 임시 옵션·미리보기·발송 API와 `/admin/notifications/test`는 더 이상 제공하지 않는다. 기존 `/admin/notifications` 링크는 `/admin#admin-notifications`로 이동한다.

기존 서버·발송 작업자에 종료 신호를 보내 진행 중 작업이 끝난 뒤 새 빌드를 시작한다. 이전 작업자가 계속 실행되면 아직 테스트 전송 코드를 갖고 있으므로 새 버전과 함께 남겨 두지 않는다. 이미 진행 중인 SMTP 전송은 회수할 수 없으며 결과를 확인하지 못한 시도는 기존 복구 절차로 `UNKNOWN` 처리한다.

이 변경에는 DB migration이나 이력 삭제가 필요하지 않다. 기존 TEST 원본·전송·활성화 기준을 보존하며, TEST 대기 항목은 새 작업자가 발송하지 않는다. 과거 이력 조회와 `UNKNOWN` 확인 API는 유지한다. 운영 화면은 `PRODUCTION` 이력만 조회하며 발송 모드 선택을 제공하지 않는다. SMTP 필수 설정과 정기 발송은 그대로 적용한다.

공시 이메일의 제목·HTML 제목·본문 제목·일반 텍스트 제목은 공시 제목을 그대로 사용한다. 예를 들어 `[공시] NXDI 외부 투자 의향 접수 기준 변경 완료 안내` 앞에 `NXDI 새 공시 · `를 붙이지 않는다. 템플릿 버전 2부터 적용하며 저장된 과거 발송 원본은 재작성하지 않는다. 정정 제목의 `[정정]` 표시는 유지한다.

## 구현 동작과 확인 범위

- 운영 관리는 `/admin`의 발송 이력 섹션에서 제공한다. 종류·상태·기간으로 조회하고 상세 버튼으로 모달을 연다. 메일 본문·전송 결과·시도 이력을 접기 메뉴 없이 확인하며 재시도·결과 확인·정정도 모달에서 처리한다. 발송 일정 안내 카드와 발송 모드 필터는 제공하지 않는다.
- 예약 작업은 서버 시작 시와 매분 실행한다. 공시 저장·실배당 저장·관리자 발송 요청 뒤에도 즉시 작업을 깨운다. 알림 서버 최초 시작 기준 이후 도래한 월과 분기만 자동 준비하며, 미입력 월은 다음 달에도 계속 확인한다. 준비되지 않은 지난 분기는 건너뛴다.
- 공시 수정은 최초 SMTP 시도 전까지만 본문에 반영한다. 최초 수신자와 Message-ID는 유지한다. 한 명이라도 시도한 원본은 고정되며 정정은 별도 버전으로 준비한다. 공시를 삭제하면 대기 항목을 취소하고 이미 진행된 시도 이력은 보존한다.
- 공시·분기 정정은 기존 버전들의 수신자를 유지한다. 월별 정정은 기존 수신자와 새 계산의 적격자를 포함하며, 적격 대상에서 제외된 기존 수신자에게도 수정된 0원을 안내한다. 모든 정정은 사유와 고정된 미리보기를 확인한 뒤 발송한다.
- 본문과 원본 입력의 SHA-256 지문, 템플릿 버전, 월별 계산의 상품 정책·문서 버전 및 반올림 차이를 저장한다. 같은 전송 항목의 재시도는 새 계산이나 주소 조회를 수행하지 않고 저장된 수신 주소를 사용한다. 실제 사용 주소는 시도별로 보존한다.
- 일시 오류는 1·5·30·120분 후 재시도하고 총 5회 시도 뒤 실패로 남긴다. 운영 메일의 수동 재시도는 관리자 작업 이력에 기록한다. `UNKNOWN`은 확인 근거를 등록해 SMTP 접수 또는 미접수를 확정해야 하며, 운영 메일의 미접수 확정 뒤에도 별도의 재시도 동작이 필요하다. TEST 메일은 운영 재시도를 허용하지 않는다.
- 작업 임대는 10분이다. 만료된 `CLAIMED`는 다시 준비할 수 있고, SMTP 호출 직전 저장한 `SUBMITTING`은 `UNKNOWN`으로 복구한다. 이 구분은 중복 위험을 줄이지만 SMTP에서 정확히 한 번 전달을 보장하지 않는다.

변경 검증은 서버 `npm run verify`, 클라이언트 lint·타입 검사·프로덕션 빌드와 격리된 브라우저 점검으로 수행한다. 공시 제목 렌더링, 삭제한 API의 404, TEST claim 차단, 상세 모달의 열기·닫기·키보드 동작을 함께 확인한다. SMTP 필수값을 제공하지 않은 서버 프로세스는 시작되지 않는다. 실제 SMTP 접수·받은편지함 도착은 별도의 발송 검증이 필요하다.
