"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

type CertificatePrintActionsProps = {
  backHref: string;
  printFileNamePrefix: string;
};

const KST_TIME_ZONE = "Asia/Seoul";

function formatPrintTimestamp(value: Date) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}-${values.hour}${values.minute}${values.second}`;
}

function nextPaint() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function waitForPrintAssets() {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images).map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }

      try {
        await image.decode();
      } catch {
        // The print preview will show the browser's fallback for a failed image.
      }
    })
  );
  await nextPaint();
  await nextPaint();
}

async function printCertificate(printFileNamePrefix: string) {
  await waitForPrintAssets();

  const originalTitle = document.title;
  document.title = `${printFileNamePrefix}_${formatPrintTimestamp(new Date())}`;
  window.addEventListener("afterprint", () => {
    document.title = originalTitle;
  }, { once: true });
  window.print();
}

export function CertificatePrintActions({
  backHref,
  printFileNamePrefix
}: CertificatePrintActionsProps) {
  const didRequestPrint = useRef(false);

  useEffect(() => {
    if (didRequestPrint.current) return;
    didRequestPrint.current = true;

    void printCertificate(printFileNamePrefix);
  }, [printFileNamePrefix]);

  return (
    <nav aria-label="확인서 작업" className="certificate-actions">
      <Link className="button ghost" href={backHref}>
        <ArrowLeft aria-hidden="true" size={16} />
        관리자
      </Link>
      <button type="button" onClick={() => void printCertificate(printFileNamePrefix)}>
        <Printer aria-hidden="true" size={16} />
        인쇄 또는 PDF 저장
      </button>
    </nav>
  );
}
