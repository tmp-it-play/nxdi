import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDaysToDateKey,
  groupRoadmapEventsByDate,
  kstDateKey,
  roadmapCategoryLabel,
  roadmapDateKeys,
  roadmapHorizonEndDate,
  roadmapKindLabel,
  sortRoadmapEvents,
  stripDisclosureTag,
  type RoadmapEvent
} from "./roadmap";

function event(overrides: Partial<RoadmapEvent> & Pick<RoadmapEvent, "id" | "eventDate">): RoadmapEvent {
  const { id, eventDate, ...rest } = overrides;
  return {
    id,
    disclosureId: `disclosure-${id}`,
    eventDate,
    kind: "PLANNED",
    category: "OTHER",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    disclosure: {
      id: `disclosure-${id}`,
      title: "[공지] 테스트",
      body: "본문",
      createdAt: "2026-07-01T00:00:00.000Z"
    },
    ...rest
  };
}

describe("roadmap date helpers", () => {
  it("returns the Korean calendar date across the UTC boundary", () => {
    assert.equal(kstDateKey(new Date("2026-07-10T14:59:59.999Z")), "2026-07-10");
    assert.equal(kstDateKey(new Date("2026-07-10T15:00:00.000Z")), "2026-07-11");
  });

  it("adds and subtracts calendar days across leap days and year end", () => {
    assert.equal(addDaysToDateKey("2024-02-28", 1), "2024-02-29");
    assert.equal(addDaysToDateKey("2024-02-28", 2), "2024-03-01");
    assert.equal(addDaysToDateKey("2024-03-01", -1), "2024-02-29");
    assert.equal(addDaysToDateKey("2025-12-31", 1), "2026-01-01");
    assert.throws(() => addDaysToDateKey("2026-02-29", 1), RangeError);
    assert.throws(() => addDaysToDateKey("2026-07-11", 0.5), RangeError);
    assert.throws(() => addDaysToDateKey("2026-07-11", Number.MAX_SAFE_INTEGER), RangeError);
  });

  it("uses an inclusive 30-day future horizon", () => {
    assert.equal(roadmapHorizonEndDate("2026-07-11"), "2026-08-10");

    const keys = roadmapDateKeys("2026-07-11");
    assert.equal(keys.length, 31);
    assert.equal(keys[0], "2026-07-11");
    assert.equal(keys.at(-1), "2026-08-10");
    assert.deepEqual(roadmapDateKeys("2026-12-30", "2027-01-02"), [
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02"
    ]);
    assert.deepEqual(roadmapDateKeys("2026-07-12", "2026-07-11"), []);
    assert.deepEqual(roadmapDateKeys("9999-12-31", "9999-12-31"), ["9999-12-31"]);
  });

});

describe("roadmap disclosure defaults", () => {
  it("strips only leading disclosure tags", () => {
    assert.equal(stripDisclosureTag("  [공지] 정기 증자 예정 안내  "), "정기 증자 예정 안내");
    assert.equal(stripDisclosureTag("[공시] [공지] 매도 안내"), "매도 안내");
    assert.equal(stripDisclosureTag("제목 [공시] 유지"), "제목 [공시] 유지");
  });

  it("provides Korean labels for roadmap kinds and categories", () => {
    assert.equal(roadmapKindLabel("DELAYED"), "연기");
    assert.equal(roadmapCategoryLabel("REBALANCING"), "리밸런싱");
  });
});

describe("roadmap event collections", () => {
  it("sorts by event date, creation time, and id without mutating the input", () => {
    const events = [
      event({ id: "c", eventDate: "2026-07-12" }),
      event({ id: "b", eventDate: "2026-07-11", createdAt: "2026-07-02T00:00:00.000Z" }),
      event({ id: "a", eventDate: "2026-07-11", createdAt: "2026-07-02T00:00:00.000Z" }),
      event({ id: "d", eventDate: "2026-07-10" })
    ];

    assert.deepEqual(sortRoadmapEvents(events).map(({ id }) => id), ["d", "a", "b", "c"]);
    assert.deepEqual(events.map(({ id }) => id), ["c", "b", "a", "d"]);
  });

  it("returns chronologically ordered date groups with sorted events", () => {
    const groups = groupRoadmapEventsByDate([
      event({ id: "late", eventDate: "2026-07-13" }),
      event({ id: "second", eventDate: "2026-07-11", createdAt: "2026-07-02T00:00:00.000Z" }),
      event({ id: "first", eventDate: "2026-07-11", createdAt: "2026-07-01T00:00:00.000Z" })
    ]);

    assert.deepEqual(
      groups.map((group) => ({
        dateKey: group.dateKey,
        ids: group.events.map(({ id }) => id)
      })),
      [
        { dateKey: "2026-07-11", ids: ["first", "second"] },
        { dateKey: "2026-07-13", ids: ["late"] }
      ]
    );
  });
});
