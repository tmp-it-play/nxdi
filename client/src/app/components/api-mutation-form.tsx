"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import type { FormEvent, FormHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import { showToast, type ToastMessage } from "@/app/components/toast";
import { clearFieldError, validateFormFields } from "@/lib/form-validation";

export type ApiMutationResponse = {
  redirectTo?: string;
  message?: ToastMessage | string;
  error?: string;
};

type ApiMutationFormProps = Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSuccess?: (response: ApiMutationResponse) => void | Promise<void>;
  resetOnSuccess?: boolean;
};

function responseMessage(payload: ApiMutationResponse | null, success: boolean): ToastMessage {
  if (payload?.message && typeof payload.message === "object") return payload.message;

  const description =
    typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string"
        ? payload.error
        : undefined;

  return {
    id: `api-mutation-${success ? "success" : "error"}`,
    title: success ? "요청을 처리했습니다" : "요청을 처리하지 못했습니다",
    description,
    tone: success ? "success" : "error"
  };
}

function requestBody(form: HTMLFormElement, submitter: HTMLElement | null) {
  const formData = new FormData(form);
  if (
    (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
    submitter.name
  ) {
    formData.append(submitter.name, submitter.value);
  }

  const body = new URLSearchParams();
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string") {
      throw new TypeError(`파일 입력은 아직 지원하지 않습니다: ${name}`);
    }
    body.append(name, value);
  }
  return body;
}

export function ApiMutationForm({
  children,
  className,
  onSuccess,
  resetOnSuccess = false,
  ...props
}: ApiMutationFormProps) {
  const router = useRouter();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [resetVersion, setResetVersion] = useState(0);
  const busy = pending || refreshing;

  async function submit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const action =
      submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? window.location.href;
    const method = (
      submitter?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get"
    ).toUpperCase();
    const target = new URL(action, window.location.href);

    // Inline field errors replace the browser's validation bubbles (the form is `noValidate`).
    const skipValidation = submitter?.hasAttribute("formnovalidate") ?? false;
    if (!skipValidation && !validateFormFields(form)) {
      event.preventDefault();
      return;
    }

    // GET and cross-origin forms retain their normal browser behavior.
    if (method === "GET" || target.origin !== window.location.origin) return;

    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);

    try {
      const response = await fetch(target, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: requestBody(form, submitter),
        credentials: "same-origin"
      });
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? ((await response.json()) as ApiMutationResponse)
        : null;

      if (!payload || !response.ok) {
        showToast(responseMessage(payload, false));
        return;
      }

      showToast(responseMessage(payload, true));
      if (resetOnSuccess) {
        form.reset();
        setResetVersion((current) => current + 1);
      }
      await onSuccess?.(payload);
      startRefresh(() => router.refresh());
    } catch (error) {
      showToast({
        id: "api-mutation-network-error",
        title: "요청을 처리하지 못했습니다",
        description: error instanceof Error ? error.message : "네트워크 연결을 확인해 주세요.",
        tone: "error"
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <form
      {...props}
      aria-busy={busy}
      className={["api-mutation-form", className].filter(Boolean).join(" ")}
      noValidate
      onChange={(event) => clearFieldError(event.target)}
      onInput={(event) => clearFieldError(event.target as Element)}
      onSubmit={submit}
    >
      <fieldset className="api-mutation-fields" disabled={busy}>
        <Fragment key={resetVersion}>{children}</Fragment>
      </fieldset>
    </form>
  );
}
