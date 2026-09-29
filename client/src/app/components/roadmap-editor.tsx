"use client";

import {
  CalendarDays,
  Check,
  GripVertical,
  History,
  MapPinned,
  Plus,
  Save,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import {
  ROADMAP_EVENT_CATEGORIES,
  ROADMAP_EVENT_KINDS,
  addDaysToDateKey,
  roadmapCategoryLabel,
  roadmapDateKeys,
  roadmapKindLabel,
  stripDisclosureTag
} from "@/lib/roadmap";
import type {
  RoadmapEvent,
  RoadmapEventCategory,
  RoadmapEventKind,
  UpdateRoadmapEventInput
} from "@/lib/roadmap";
import { TdsSelect } from "@/app/components/tds";
import { showToast } from "@/app/components/toast";

const DRAG_MIME = "application/x-nxdi-roadmap-item";
const COLLAPSED_EDITOR_PINS_PER_DATE = 2;
const EDITOR_DATE_PAGE_DAYS = 30;
const LOAD_MORE_THRESHOLD_PX = 520;
const MOUSE_DRAG_THRESHOLD_PX = 5;

export type RoadmapEditorDisclosure = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

export type RoadmapEditorProps = {
  events: RoadmapEvent[];
  disclosures: RoadmapEditorDisclosure[];
  today: string;
};

type DragPayload =
  | { type: "disclosure"; disclosureId: string }
  | { type: "event"; eventId: string };

type EditorStatus = {
  tone: "success" | "error" | "progress";
  text: string;
};

type MouseDragState = {
  pointerId: number;
  captureTarget: Element;
  startClientX: number;
  startScrollLeft: number;
  didDrag: boolean;
};

function sortEvents(events: RoadmapEvent[]) {
  return [...events].sort(
    (left, right) =>
      left.eventDate.localeCompare(right.eventDate) ||
      left.createdAt.localeCompare(right.createdAt)
  );
}

function addEditorPageDays(dateKey: string, days: number) {
  try {
    return addDaysToDateKey(dateKey, days);
  } catch {
    return dateKey;
  }
}

function formatDateKey(dateKey: string, withYear = false) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ];
  return `${withYear ? `${year}년 ` : ""}${month}월 ${day}일 (${weekday})`;
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "등록일 미상";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Seoul"
  }).format(date);
}

function eventLabel(event: RoadmapEvent) {
  return event.label?.trim() || stripDisclosureTag(event.disclosure.title);
}

function isDragPayload(value: unknown): value is DragPayload {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "disclosure") {
    return "disclosureId" in value && typeof value.disclosureId === "string";
  }
  if (value.type === "event") {
    return "eventId" in value && typeof value.eventId === "string";
  }
  return false;
}

function readDragPayload(event: DragEvent, fallback: DragPayload | null) {
  try {
    const encoded = event.dataTransfer.getData(DRAG_MIME);
    if (!encoded) return fallback;
    const parsed: unknown = JSON.parse(encoded);
    return isDragPayload(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeDragPayload(event: DragEvent, payload: DragPayload) {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", payload.type === "event" ? payload.eventId : payload.disclosureId);
}

async function requestJson<T>(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body == null ? {} : { "Content-Type": "application/json" }),
      ...init.headers
    }
  });

  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) {
    throw new Error(body?.error || "요청을 처리하지 못했습니다.");
  }
  if (!body) throw new Error("서버 응답을 확인하지 못했습니다.");
  return body;
}

function RoadmapPinEditor({
  event,
  busy,
  onClose,
  onSave,
  onDelete
}: {
  event: RoadmapEvent;
  busy: boolean;
  onClose: () => void;
  onSave: (input: UpdateRoadmapEventInput) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const formId = useId();
  const [eventDate, setEventDate] = useState(event.eventDate);
  const [kind, setKind] = useState<RoadmapEventKind>(event.kind);
  const [category, setCategory] = useState<RoadmapEventCategory>(event.category);
  const [label, setLabel] = useState(event.label ?? "");

  useEffect(() => {
    setEventDate(event.eventDate);
    setKind(event.kind);
    setCategory(event.category);
    setLabel(event.label ?? "");
  }, [event.category, event.eventDate, event.kind, event.label]);

  async function submit(eventObject: FormEvent<HTMLFormElement>) {
    eventObject.preventDefault();
    await onSave({
      eventDate,
      kind,
      category,
      label
    });
  }

  return (
    <section className="roadmap-editor-inspector" aria-labelledby={`${formId}-title`}>
      <header className="roadmap-editor-inspector-header">
        <div>
          <span className="roadmap-editor-eyebrow">선택한 핀</span>
          <h3 id={`${formId}-title`}>{eventLabel(event)}</h3>
          <p>{stripDisclosureTag(event.disclosure.title)}</p>
        </div>
        <button
          className="ghost roadmap-editor-close"
          type="button"
          onClick={onClose}
          aria-label="핀 편집 닫기"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <form className="roadmap-editor-inspector-form" onSubmit={submit}>
        <div className="roadmap-editor-field">
          <label htmlFor={`${formId}-date`}>날짜</label>
          <input
            id={`${formId}-date`}
            type="date"
            value={eventDate}
            disabled={busy}
            onChange={(changeEvent) => setEventDate(changeEvent.target.value)}
          />
        </div>

        <div className="roadmap-editor-field">
          <label htmlFor={`${formId}-kind`}>상태</label>
          <TdsSelect
            id={`${formId}-kind`}
            value={kind}
            disabled={busy}
            onChange={(changeEvent) => setKind(changeEvent.target.value as RoadmapEventKind)}
          >
            {ROADMAP_EVENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {roadmapKindLabel(value)}
              </option>
            ))}
          </TdsSelect>
        </div>

        <div className="roadmap-editor-field">
          <label htmlFor={`${formId}-category`}>분류</label>
          <TdsSelect
            id={`${formId}-category`}
            value={category}
            disabled={busy}
            onChange={(changeEvent) =>
              setCategory(changeEvent.target.value as RoadmapEventCategory)
            }
          >
            {ROADMAP_EVENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {roadmapCategoryLabel(value)}
              </option>
            ))}
          </TdsSelect>
        </div>

        <div className="roadmap-editor-field roadmap-editor-field--wide">
          <label htmlFor={`${formId}-label`}>표시 이름</label>
          <input
            id={`${formId}-label`}
            type="text"
            maxLength={160}
            value={label}
            disabled={busy}
            placeholder={stripDisclosureTag(event.disclosure.title)}
            onChange={(changeEvent) => setLabel(changeEvent.target.value)}
          />
          <span className="roadmap-editor-field-hint">비워 두면 공시 제목이 표시됩니다.</span>
        </div>

        <div className="roadmap-editor-inspector-actions">
          <button className="secondary" type="submit" disabled={busy || !eventDate}>
            <Save size={16} aria-hidden="true" />
            변경사항 저장
          </button>
          <button className="ghost danger" type="button" disabled={busy} onClick={onDelete}>
            <Trash2 size={16} aria-hidden="true" />
            핀 삭제
          </button>
        </div>
      </form>
    </section>
  );
}

export function RoadmapEditor({ events, disclosures, today }: RoadmapEditorProps) {
  const editorId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const initialAnchorDateRef = useRef(
    events.reduce<string | null>(
      (latest, event) => latest === null || event.eventDate > latest ? event.eventDate : latest,
      null
    ) ?? today
  );
  const mouseDragRef = useRef<MouseDragState | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickFrameRef = useRef<number | null>(null);
  const loadInProgressRef = useRef(false);
  const pendingPrependRef = useRef<{ scrollLeft: number; scrollWidth: number } | null>(null);
  const pendingCenterDateRef = useRef<string | null>(initialAnchorDateRef.current);
  const [roadmapEvents, setRoadmapEvents] = useState(() => sortEvents(events));
  const [rangeStart, setRangeStart] = useState(() =>
    addEditorPageDays(initialAnchorDateRef.current, -EDITOR_DATE_PAGE_DAYS)
  );
  const [rangeEnd, setRangeEnd] = useState(() =>
    addEditorPageDays(initialAnchorDateRef.current, EDITOR_DATE_PAGE_DAYS)
  );
  const [isTimelineDragging, setIsTimelineDragging] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedDisclosureId, setSelectedDisclosureId] = useState(disclosures[0]?.id ?? "");
  const [fallbackDate, setFallbackDate] = useState(today);
  const [expandedDateKeys, setExpandedDateKeys] = useState<Set<string>>(() => new Set());
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);
  const [trashActive, setTrashActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<EditorStatus | null>(null);

  const selectedEvent = roadmapEvents.find((event) => event.id === selectedEventId) ?? null;
  const timelineDates = useMemo(
    () => roadmapDateKeys(rangeStart, rangeEnd),
    [rangeEnd, rangeStart]
  );
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, RoadmapEvent[]>();
    for (const event of roadmapEvents) {
      const group = grouped.get(event.eventDate) ?? [];
      group.push(event);
      grouped.set(event.eventDate, group);
    }
    return grouped;
  }, [roadmapEvents]);

  useEffect(() => () => {
    if (suppressClickFrameRef.current !== null) {
      window.cancelAnimationFrame(suppressClickFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const pendingPrepend = pendingPrependRef.current;
    if (pendingPrepend) {
      const addedWidth = viewport.scrollWidth - pendingPrepend.scrollWidth;
      viewport.scrollLeft = pendingPrepend.scrollLeft + addedWidth;
      if (mouseDragRef.current) {
        mouseDragRef.current.startScrollLeft += addedWidth;
      }
      pendingPrependRef.current = null;
    }

    const centerDate = pendingCenterDateRef.current;
    if (centerDate) {
      const target = viewport.querySelector<HTMLElement>(`[data-date="${centerDate}"]`);
      if (target) {
        viewport.scrollLeft = Math.max(
          0,
          target.offsetLeft - (viewport.clientWidth - target.clientWidth) / 2
        );
        pendingCenterDateRef.current = null;
      }
    }

    loadInProgressRef.current = false;
  }, [rangeEnd, rangeStart]);

  function centerDateInTimeline(eventDate: string) {
    pendingCenterDateRef.current = eventDate;

    if (eventDate < rangeStart || eventDate > rangeEnd) {
      setRangeStart(addEditorPageDays(eventDate, -EDITOR_DATE_PAGE_DAYS));
      setRangeEnd(addEditorPageDays(eventDate, EDITOR_DATE_PAGE_DAYS));
      return;
    }

    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const target = viewport?.querySelector<HTMLElement>(`[data-date="${eventDate}"]`);
      if (!viewport || !target) return;
      viewport.scrollTo({
        left: Math.max(0, target.offsetLeft - (viewport.clientWidth - target.clientWidth) / 2),
        behavior: "smooth"
      });
      pendingCenterDateRef.current = null;
    });
  }

  function loadMoreDates(direction: -1 | 1) {
    if (loadInProgressRef.current) return;
    loadInProgressRef.current = true;

    try {
      if (direction < 0) {
        const viewport = viewportRef.current;
        if (viewport) {
          pendingPrependRef.current = {
            scrollLeft: viewport.scrollLeft,
            scrollWidth: viewport.scrollWidth
          };
        }
        setRangeStart(addDaysToDateKey(rangeStart, -EDITOR_DATE_PAGE_DAYS));
      } else {
        setRangeEnd(addDaysToDateKey(rangeEnd, EDITOR_DATE_PAGE_DAYS));
      }
    } catch {
      loadInProgressRef.current = false;
    }
  }

  function handleViewportScroll() {
    const viewport = viewportRef.current;
    if (!viewport || loadInProgressRef.current) return;

    if (viewport.scrollLeft <= LOAD_MORE_THRESHOLD_PX) {
      loadMoreDates(-1);
      return;
    }

    const remaining = viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft;
    if (remaining <= LOAD_MORE_THRESHOLD_PX) loadMoreDates(1);
  }

  function clearSuppressedClick() {
    suppressClickRef.current = false;
    if (suppressClickFrameRef.current !== null) {
      window.cancelAnimationFrame(suppressClickFrameRef.current);
      suppressClickFrameRef.current = null;
    }
  }

  function suppressDragClick() {
    clearSuppressedClick();
    suppressClickRef.current = true;
    suppressClickFrameRef.current = window.requestAnimationFrame(() => {
      suppressClickRef.current = false;
      suppressClickFrameRef.current = null;
    });
  }

  function releaseMousePointer(captureTarget: Element, pointerId: number) {
    if (captureTarget.hasPointerCapture(pointerId)) {
      captureTarget.releasePointerCapture(pointerId);
    }
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary) return;
    if ((event.target as Element).closest("button, input, select, a, [draggable='true']")) return;

    clearSuppressedClick();
    const captureTarget = event.target as Element;
    mouseDragRef.current = {
      pointerId: event.pointerId,
      captureTarget,
      startClientX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      didDrag: false
    };
    captureTarget.setPointerCapture(event.pointerId);
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = mouseDragRef.current;
    if (event.pointerType !== "mouse" || !drag || drag.pointerId !== event.pointerId) return;

    const distanceX = event.clientX - drag.startClientX;
    if (!drag.didDrag && Math.abs(distanceX) <= MOUSE_DRAG_THRESHOLD_PX) return;

    if (!drag.didDrag) {
      drag.didDrag = true;
      setIsTimelineDragging(true);
    }

    event.preventDefault();
    event.currentTarget.scrollLeft = drag.startScrollLeft - distanceX;
  }

  function handleViewportPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = mouseDragRef.current;
    if (event.pointerType !== "mouse" || !drag || drag.pointerId !== event.pointerId) return;

    if (drag.didDrag) suppressDragClick();
    mouseDragRef.current = null;
    setIsTimelineDragging(false);
    releaseMousePointer(drag.captureTarget, event.pointerId);
  }

  function handleViewportPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = mouseDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    mouseDragRef.current = null;
    setIsTimelineDragging(false);
    releaseMousePointer(drag.captureTarget, event.pointerId);
  }

  function handleViewportLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = mouseDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    mouseDragRef.current = null;
    setIsTimelineDragging(false);
  }

  function handleViewportClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    clearSuppressedClick();
  }

  function duplicateExists(disclosureId: string, eventDate: string, exceptId?: string) {
    return roadmapEvents.some(
      (event) =>
        event.id !== exceptId &&
        event.disclosureId === disclosureId &&
        event.eventDate === eventDate
    );
  }

  function setError(error: unknown, fallback: string) {
    const text = error instanceof Error && error.message ? error.message : fallback;
    setStatus({
      tone: "error",
      text
    });
    showToast({
      id: "roadmap-server-error",
      title: "로드맵 요청을 처리하지 못했습니다",
      description: text,
      tone: "error"
    });
  }

  async function createPin(disclosureId: string, eventDate: string) {
    const disclosure = disclosures.find((item) => item.id === disclosureId);
    if (!disclosure) {
      setStatus({ tone: "error", text: "핀으로 만들 공시를 선택해 주세요." });
      return;
    }
    if (duplicateExists(disclosureId, eventDate)) {
      setStatus({ tone: "error", text: "같은 공시가 이미 이 날짜에 등록되어 있어요." });
      return;
    }

    setBusy(true);
    setStatus({ tone: "progress", text: "핀을 추가하고 있어요…" });
    try {
      const response = await requestJson<{ event: RoadmapEvent }>(
        "/api/admin/roadmap-events",
        {
          method: "POST",
          body: JSON.stringify({
            disclosureId,
            eventDate
          })
        }
      );
      setRoadmapEvents((current) => sortEvents([...current, response.event]));
      setSelectedEventId(response.event.id);
      setExpandedDateKeys((current) => new Set(current).add(response.event.eventDate));
      centerDateInTimeline(response.event.eventDate);
      setStatus({
        tone: "success",
        text: `${formatDateKey(response.event.eventDate)}에 핀을 추가했어요.`
      });
    } catch (error) {
      setError(error, "핀을 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function movePin(eventId: string, eventDate: string) {
    const currentEvent = roadmapEvents.find((event) => event.id === eventId);
    if (!currentEvent) return;
    if (currentEvent.eventDate === eventDate) {
      setStatus({ tone: "success", text: "핀이 이미 이 날짜에 있어요." });
      return;
    }
    if (duplicateExists(currentEvent.disclosureId, eventDate, currentEvent.id)) {
      setStatus({ tone: "error", text: "같은 공시가 이미 이 날짜에 등록되어 있어요." });
      return;
    }

    setBusy(true);
    setStatus({ tone: "progress", text: "핀을 옮기고 있어요…" });
    try {
      const response = await requestJson<{ event: RoadmapEvent }>(
        `/api/admin/roadmap-events/${encodeURIComponent(eventId)}`,
        { method: "PATCH", body: JSON.stringify({ eventDate }) }
      );
      setRoadmapEvents((current) =>
        sortEvents(current.map((event) => (event.id === eventId ? response.event : event)))
      );
      centerDateInTimeline(response.event.eventDate);
      setStatus({
        tone: "success",
        text: `${formatDateKey(response.event.eventDate)}로 핀을 옮겼어요.`
      });
    } catch (error) {
      setError(error, "핀을 옮기지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function savePin(eventId: string, input: UpdateRoadmapEventInput) {
    const currentEvent = roadmapEvents.find((event) => event.id === eventId);
    if (!currentEvent) return;
    if (
      input.eventDate &&
      duplicateExists(currentEvent.disclosureId, input.eventDate, currentEvent.id)
    ) {
      setStatus({ tone: "error", text: "같은 공시가 이미 이 날짜에 등록되어 있어요." });
      return;
    }

    setBusy(true);
    setStatus({ tone: "progress", text: "변경사항을 저장하고 있어요…" });
    try {
      const response = await requestJson<{ event: RoadmapEvent }>(
        `/api/admin/roadmap-events/${encodeURIComponent(eventId)}`,
        { method: "PATCH", body: JSON.stringify(input) }
      );
      setRoadmapEvents((current) =>
        sortEvents(current.map((event) => (event.id === eventId ? response.event : event)))
      );
      if (response.event.eventDate !== currentEvent.eventDate) {
        centerDateInTimeline(response.event.eventDate);
      }
      setStatus({ tone: "success", text: "핀 변경사항을 저장했어요." });
    } catch (error) {
      setError(error, "핀을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deletePin(eventId: string) {
    const currentEvent = roadmapEvents.find((event) => event.id === eventId);
    if (!currentEvent) return;

    setBusy(true);
    setStatus({ tone: "progress", text: "핀을 삭제하고 있어요…" });
    try {
      await requestJson<{ deleted: true; id: string }>(
        `/api/admin/roadmap-events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" }
      );
      setRoadmapEvents((current) => current.filter((event) => event.id !== eventId));
      setSelectedEventId((current) => (current === eventId ? null : current));
      setStatus({ tone: "success", text: `“${eventLabel(currentEvent)}” 핀을 삭제했어요.` });
    } catch (error) {
      setError(error, "핀을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function beginDisclosureDrag(event: DragEvent, disclosureId: string) {
    const payload: DragPayload = { type: "disclosure", disclosureId };
    writeDragPayload(event, payload);
    event.dataTransfer.effectAllowed = "copy";
    setDragging(payload);
  }

  function beginEventDrag(eventObject: DragEvent, roadmapEvent: RoadmapEvent) {
    if (busy) {
      eventObject.preventDefault();
      return;
    }
    const payload: DragPayload = { type: "event", eventId: roadmapEvent.id };
    writeDragPayload(eventObject, payload);
    eventObject.dataTransfer.effectAllowed = "move";
    setDragging(payload);
  }

  function finishDrag() {
    setDragging(null);
    setDropTargetDate(null);
    setTrashActive(false);
  }

  function toggleDatePins(eventDate: string) {
    setExpandedDateKeys((current) => {
      const next = new Set(current);
      if (next.has(eventDate)) next.delete(eventDate);
      else next.add(eventDate);
      return next;
    });
  }

  function allowDateDrop(eventObject: DragEvent, eventDate: string) {
    if (busy) return;
    eventObject.preventDefault();
    eventObject.dataTransfer.dropEffect = dragging?.type === "event" ? "move" : "copy";
    setDropTargetDate(eventDate);
  }

  async function dropOnDate(eventObject: DragEvent, eventDate: string) {
    eventObject.preventDefault();
    const payload = readDragPayload(eventObject, dragging);
    finishDrag();
    if (!payload || busy) return;
    if (payload.type === "disclosure") {
      await createPin(payload.disclosureId, eventDate);
    } else {
      await movePin(payload.eventId, eventDate);
    }
  }

  function allowTrashDrop(eventObject: DragEvent) {
    if (busy || dragging?.type !== "event") return;
    eventObject.preventDefault();
    eventObject.dataTransfer.dropEffect = "move";
    setTrashActive(true);
  }

  async function dropInTrash(eventObject: DragEvent) {
    eventObject.preventDefault();
    const payload = readDragPayload(eventObject, dragging);
    finishDrag();
    if (!payload || payload.type !== "event" || busy) return;
    await deletePin(payload.eventId);
  }

  async function submitFallback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createPin(selectedDisclosureId, fallbackDate);
  }

  return (
    <section className="roadmap-editor" aria-labelledby={`${editorId}-title`}>
      <header className="roadmap-editor-header">
        <div>
          <h2 id={`${editorId}-title`}>로드맵 편집</h2>
        </div>
        <div className="roadmap-editor-window" aria-label="편집 가능한 날짜">
          <CalendarDays size={17} aria-hidden="true" />
          <span>날짜 제한 없음</span>
        </div>
      </header>

      <div className="roadmap-editor-layout">
        <aside className="roadmap-disclosure-tray" aria-labelledby={`${editorId}-tray-title`}>
          <header className="roadmap-disclosure-tray-header">
            <div>
              <span className="roadmap-editor-eyebrow">1. 공시 선택</span>
              <h3 id={`${editorId}-tray-title`}>핀으로 만들 공시</h3>
            </div>
            <span className="roadmap-disclosure-count">{disclosures.length}건</span>
          </header>

          <form className="roadmap-editor-add-form" onSubmit={submitFallback}>
            <div className="roadmap-editor-field roadmap-editor-field--wide">
              <label htmlFor={`${editorId}-disclosure`}>공시</label>
              <TdsSelect
                id={`${editorId}-disclosure`}
                value={selectedDisclosureId}
                disabled={busy || disclosures.length === 0}
                onChange={(event) => setSelectedDisclosureId(event.target.value)}
              >
                {disclosures.length === 0 ? <option value="">등록된 공시가 없습니다</option> : null}
                {disclosures.map((disclosure) => (
                  <option key={disclosure.id} value={disclosure.id}>
                    {stripDisclosureTag(disclosure.title)}
                  </option>
                ))}
              </TdsSelect>
            </div>
            <div className="roadmap-editor-add-row">
              <div className="roadmap-editor-field">
                <label htmlFor={`${editorId}-fallback-date`}>날짜</label>
                <input
                  id={`${editorId}-fallback-date`}
                  type="date"
                  value={fallbackDate}
                  disabled={busy}
                  onChange={(event) => setFallbackDate(event.target.value)}
                />
              </div>
              <button
                className="secondary roadmap-editor-add-button"
                type="submit"
                disabled={busy || !selectedDisclosureId || !fallbackDate}
              >
                <Plus size={16} aria-hidden="true" /> 핀 추가
              </button>
            </div>
          </form>

          <div className="roadmap-disclosure-list">
            {disclosures.length === 0 ? (
              <div className="roadmap-disclosure-empty">
                <p>먼저 공시를 등록해 주세요.</p>
                <span>등록한 공시는 이곳에서 바로 핀으로 만들 수 있습니다.</span>
              </div>
            ) : (
              disclosures.map((disclosure) => {
                const pinCount = roadmapEvents.filter(
                  (event) => event.disclosureId === disclosure.id
                ).length;
                return (
                  <article
                    key={disclosure.id}
                    className="roadmap-disclosure-card"
                    draggable={!busy}
                    onDragStart={(event) => beginDisclosureDrag(event, disclosure.id)}
                    onDragEnd={finishDrag}
                  >
                    <GripVertical className="roadmap-disclosure-grip" size={18} aria-hidden="true" />
                    <div>
                      <h4>{stripDisclosureTag(disclosure.title)}</h4>
                      <p>{disclosure.body.slice(0, 88)}{disclosure.body.length > 88 ? "…" : ""}</p>
                      <div className="roadmap-disclosure-meta">
                        <time dateTime={disclosure.createdAt}>{formatCreatedAt(disclosure.createdAt)}</time>
                        {pinCount > 0 ? <span>핀 {pinCount}개</span> : <span>핀 없음</span>}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </aside>

        <div className="roadmap-editor-workspace">
          <section className="roadmap-editor-board" aria-labelledby={`${editorId}-timeline-title`}>
            <header className="roadmap-editor-board-header">
              <div>
                <span className="roadmap-editor-eyebrow">2. 날짜에 놓기</span>
                <h3 id={`${editorId}-timeline-title`}>전체 로드맵</h3>
              </div>
            </header>

            <div
              className={`roadmap-editor-viewport${isTimelineDragging ? " is-dragging" : ""}`}
              ref={viewportRef}
              tabIndex={0}
              onScroll={handleViewportScroll}
              onPointerDown={handleViewportPointerDown}
              onPointerMove={handleViewportPointerMove}
              onPointerUp={handleViewportPointerUp}
              onPointerCancel={handleViewportPointerCancel}
              onLostPointerCapture={handleViewportLostPointerCapture}
              onClickCapture={handleViewportClickCapture}
              aria-label="가로 로드맵, 좌우로 스크롤할 수 있습니다"
            >
              <ol className="roadmap-track roadmap-editor-track">
                {timelineDates.map((eventDate) => {
                  const dateEvents = eventsByDate.get(eventDate) ?? [];
                  const isExpanded = expandedDateKeys.has(eventDate);
                  const displayedEvents = isExpanded
                    ? dateEvents
                    : dateEvents.slice(0, COLLAPSED_EDITOR_PINS_PER_DATE);
                  const hiddenPinCount = dateEvents.length - displayedEvents.length;
                  const isPast = eventDate < today;
                  const isToday = eventDate === today;
                  return (
                    <li
                      key={eventDate}
                      className={[
                        "roadmap-stop",
                        "roadmap-editor-stop",
                        isPast ? "roadmap-editor-stop--history" : "",
                        isToday ? "roadmap-editor-stop--today" : "",
                        dropTargetDate === eventDate ? "roadmap-editor-stop--drop-active" : ""
                      ].filter(Boolean).join(" ")}
                      data-date={eventDate}
                      onDragOver={(event) => allowDateDrop(event, eventDate)}
                      onDrop={(event) => void dropOnDate(event, eventDate)}
                    >
                      <div className="roadmap-pin-stack roadmap-editor-pin-stack">
                        {displayedEvents.map((roadmapEvent) => {
                          const pinIsPast = roadmapEvent.eventDate < today;
                          const selected = roadmapEvent.id === selectedEventId;
                          return (
                            <button
                              key={roadmapEvent.id}
                              className={[
                                "roadmap-pin",
                                "roadmap-editor-pin",
                                `roadmap-pin--${roadmapEvent.kind.toLowerCase()}`,
                                selected ? "roadmap-editor-pin--selected" : ""
                              ].filter(Boolean).join(" ")}
                              type="button"
                              draggable={!busy}
                              aria-pressed={selected}
                              aria-label={`${eventLabel(roadmapEvent)}, ${formatDateKey(roadmapEvent.eventDate)}, ${roadmapKindLabel(roadmapEvent.kind)}. 드래그하여 이동 가능`}
                              onClick={() => setSelectedEventId(roadmapEvent.id)}
                              onDragStart={(event) => beginEventDrag(event, roadmapEvent)}
                              onDragEnd={finishDrag}
                            >
                              <span className="roadmap-editor-pin-topline">
                                <span>{roadmapCategoryLabel(roadmapEvent.category)}</span>
                                {pinIsPast ? <History size={13} aria-hidden="true" /> : <GripVertical size={13} aria-hidden="true" />}
                              </span>
                              <strong>{eventLabel(roadmapEvent)}</strong>
                              <small>{roadmapKindLabel(roadmapEvent.kind)}</small>
                            </button>
                          );
                        })}
                        {dateEvents.length > COLLAPSED_EDITOR_PINS_PER_DATE ? (
                          <button
                            className="roadmap-editor-pin-more"
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleDatePins(eventDate)}
                          >
                            {isExpanded ? "접기" : `${hiddenPinCount}개 더 보기`}
                          </button>
                        ) : null}
                        {dateEvents.length === 0 ? (
                          <span className="roadmap-editor-drop-hint" aria-hidden="true">여기에 놓기</span>
                        ) : null}
                      </div>
                      <span className="roadmap-node" aria-hidden="true" />
                      <time className="roadmap-date" dateTime={eventDate}>
                        {isToday ? <strong>오늘</strong> : null}
                        <span>{formatDateKey(eventDate, isPast)}</span>
                      </time>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div
              className={`roadmap-trash-zone${trashActive ? " roadmap-trash-zone--active" : ""}`}
              onDragOver={allowTrashDrop}
              onDragLeave={() => setTrashActive(false)}
              onDrop={(event) => void dropInTrash(event)}
              aria-label="핀 삭제 영역"
            >
              <Trash2 size={18} aria-hidden="true" />
              <span>핀을 이곳에 놓으면 삭제돼요</span>
            </div>

            {status ? (
              <div
                className={`roadmap-editor-status roadmap-editor-status--${status.tone}`}
                role={status.tone === "error" ? "alert" : "status"}
                aria-live="polite"
                aria-atomic="true"
              >
                {status.tone === "success" ? <Check size={16} aria-hidden="true" /> : null}
                {status.text}
              </div>
            ) : null}
          </section>

          {selectedEvent ? (
            <RoadmapPinEditor
              key={selectedEvent.id}
              event={selectedEvent}
              busy={busy}
              onClose={() => setSelectedEventId(null)}
              onSave={(input) => savePin(selectedEvent.id, input)}
              onDelete={() => deletePin(selectedEvent.id)}
            />
          ) : (
            <section className="roadmap-editor-inspector roadmap-editor-inspector--empty">
              <MapPinned size={22} aria-hidden="true" />
              <div>
                <h3>핀을 선택하세요</h3>
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
