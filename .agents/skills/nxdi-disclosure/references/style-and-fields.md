# Style and Fields

Use this reference for common structure, field selection, notation, and final review.

## Common Structure

Every NXDI notice or disclosure must follow this shape:

```text
[유형] 제목

본문 요약 문장(무엇을, 언제, 어떤 목적으로)

[필드명] 값
[필드명] 값
...
[공시일] YYYY/MM/DD

(변동 가능성 및 첨부 안내 문구)
```

## Title Rules

- Format the title as a Korean type tag plus the key target and matter.
- When multiple tickers are involved, use the representative ticker followed by `외`. For Korean-listed holdings, use the representative Korean name instead of the stock code.
- Example: `[공지] OCR 외 특별 증자 정기 진행 안내`.
- Keep the title factual. Do not add promotional or explanatory wording.

## Summary Rules

- Start the body with one or two Korean sentences stating the target, timing, and purpose.
- For planned events, state that the action is scheduled.
- For completed events, state that the action has been executed or completed.

## Standard Fields

Use only the fields that fit the event. Preserve Korean field labels in final output.

| Field labels                                                             | Use                                             |
|--------------------------------------------------------------------------|-------------------------------------------------|
| `[증자 구분]`, `[매도 사유]`, `[행위 구분]`, `[사유]`                                  | Nature, basis, or reason for the event.         |
| `[매수 재원]`                                                              | Funding source for a planned or executed purchase. |
| `[금액]`, `[체결금액]`, `[예정 금액]`, `[회차별 금액]`, `[총 증자액]`, `[축소 규모]`            | Amounts. Distinguish planned and final amounts. |
| `[정산금액]`                                                               | Net settled amount after fees, shown with the deducted fee, such as `원화 58,232원 (수수료 8원 차감)`. Use alongside `[체결금액]` when `[체결금액]` is the pre-fee price. |
| `[일시]`, `[체결 일시]`, `[예정 일시]`, `[진행 기간]`, `[진행 주기]`, `[축소 일시]`, `[축소 기간]` | Time, date, period, or cadence.                 |
| `[종목]`, `[매수 종목]`, `[매도 종목]`, `[예정 종목]`, `[매도 예정 종목]`, `[축소 대상]`         | Target tickers, holdings, or target scope.      |
| `[공시일]`                                                                  | Document creation or publication date.          |

## Closing Wording

The closing paragraph must match the status:

- Planned amounts: state that final executed amounts may differ because of exchange rates and broker/exchange fees.
- Final amounts: state that the amount is the actual executed amount reflecting exchange rates and fees.
- Transaction details: state whether detailed trade records are attached or will be separately attached/disclosed.

## Notation Rules

### Amounts

- Write KRW amounts as `원화 9,000원` or `9,000원`.
- Always use thousands separators.
- For planned amounts, include the idea that the amount may not exactly match after execution because of the exchange rate and broker/exchange fees.
- For confirmed amounts, state that the amount is the actual executed amount reflecting exchange rates and fees.

### Tickers

- For overseas holdings, use tickers as the primary identifier.
- On first mention only, add the Korean name in parentheses, such as `OCR(오피드 아일랜드 캐피탈)`, `ITUB(이타우 우니방쿠 홀딩스 ADR)`, or `O(리얼티 인컴)`.
- On repeated mentions, use the ticker only.
- For Korean-listed holdings with numeric stock codes, put the Korean name first and the code in parentheses, such as `TIGER CD금리투자KIS(357870)`.
- Use the name exactly as the user gives it. Add the code on first mention and in ticker fields such as `[매도 종목]` or `[예정 종목]`; use the name only on repeated mentions.

### Dates and Times

- Use `YYYY/MM/DD` for dates.
- Use 24-hour `HH:MM` for times.
- For a time window, use a Korean range with `경`, such as `야간(22:00~23:00경)`.

### Week Numbering

- Use `1주차` or `첫째 주`.
- Do not use nonstandard wording such as `1째주`.

### Sentences

- Avoid repeating the same word in close succession, such as `체결된 ... 체결된 건`.
- Put the actor first when relevant, such as `당사 특별 증자`.

## Review Checklist

Before returning a draft or review, verify:

- The type is correct: planned equals `[공지]`, completed equals `[공시]`.
- Planned and completed portions are not mixed in one document.
- The capital increase subtype matches the guide and existing disclosure terminology.
- Amounts include currency, commas, and the correct planned/final uncertainty wording.
- Tickers are consistent, with Korean names only on first mention; Korean-listed holdings use `종목명(종목코드)` with the name first.
- Quantities, amounts, and dates do not contradict each other.
- Buy/sell quantities align when the event implies a matching relationship.
- Sale or cleanup reasons match the actual nature of the ticker.
- A dividend stock is not incorrectly categorized as unrelated to dividends.
- The document mentions trade-detail attachment or separate disclosure.
- `[공시일]` is present.
