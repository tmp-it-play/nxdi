"use client";

import { useState, type InputHTMLAttributes } from "react";

/** Adds hyphens to Korean phone numbers while typing; any value with letters or `@` is left as typed (email). */
export function formatContact(value: string) {
  if (/[^\d\s-]/.test(value)) return value;
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.startsWith("01")) {
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function ContactInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange">) {
  const [value, setValue] = useState("");
  return (
    <input
      {...props}
      autoComplete="off"
      onChange={(event) => setValue(formatContact(event.currentTarget.value))}
      type="text"
      value={value}
    />
  );
}
