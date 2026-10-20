---
name: nxdi-disclosure
description: Draft, revise, or review Korean NexTach Global Dividend Income Fund (NXDI) notices and disclosures. Use when the agent needs to write or check NXDI 공지/공시 documents for planned or completed capital increases, sales, reductions, rebalancing-related trades, execution reports, disclosure formatting, field selection, Korean ticker/name notation, date/time notation, amount wording, or pre-publication checklist validation.
---

# NexTach Global Dividend Income Fund (NXDI) Disclosure Writing

## Output Contract

- Write the final notice or disclosure in Korean.
- Keep planned events and completed events in separate documents. Use `[공지]` for planned events and `[공시]` for completed events.
- Preserve user-provided facts exactly. Do not invent amounts, tickers, quantities, times, execution status, fees, exchange rates, or attachments.
- Ask a concise follow-up only when a required fact cannot be inferred and drafting would create a factual claim.

## Workflow

1. Read `references/classification-and-terms.md` to classify the document type and operating action.
2. Read `references/style-and-fields.md` before drafting or reviewing the document format.
3. Read `references/template-selection.md` and select the closest template asset for the classified action.
4. Draft the Korean notice/disclosure using the selected asset in `assets/templates/`, adapting field labels only when the event requires it.
5. Run the checklist in `references/style-and-fields.md` before returning the result.
6. When the draft exists as a file or can be piped safely, run `scripts/validate_disclosure.py` for mechanical checks and address any reported issues.

## Reference Routing

- Use `classification-and-terms.md` for `[공지]` vs `[공시]`, operating action types, capital increase subtypes, reduction scope, and rebalancing distinctions.
- Use `style-and-fields.md` for common structure, standard fields, notation rules, title rules, closing wording, and the review checklist.
- Use `template-selection.md` to choose one of the Korean template assets under `assets/templates/`.
- Use `scripts/validate_disclosure.py` for repeatable checks on finished drafts.
