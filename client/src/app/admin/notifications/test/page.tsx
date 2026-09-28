import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthNavActions } from "@/app/components/auth-actions";
import { AppShell, Navigation, Top } from "@/app/components/tds";
import { ApiError, getSession } from "@/lib/api";
import { TemporaryEmailTests } from "./TemporaryEmailTests";
import type { TestEmailOptions } from "./types";

export const metadata: Metadata = { title: "이메일 발송 테스트 | NXDI" };

export default async function TemporaryEmailTestPage() {
  const { user, isAdmin } = await getSession();
  if (!isAdmin) redirect("/admin");
  const session = (await cookies()).get("nxdi_session");
  const origin = (process.env.API_ORIGIN ?? process.env.NXDI_API_ORIGIN ?? "https://kimtaeeun.site/nxdi-api").replace(/\/$/, "");
  const response = await fetch(`${origin}/api/admin/notifications/tests/options`, {
    headers: session ? { cookie: `nxdi_session=${session.value}` } : undefined,
    cache: "no-store"
  });
  if (response.status === 401 || response.status === 403) redirect("/admin");
  if (!response.ok) throw new ApiError(response.status, "테스트 발송 정보를 불러오지 못했습니다.");
  const data = await response.json() as TestEmailOptions;

  return (
    <AppShell>
      <Navigation actions={<AuthNavActions user={user} />} />
      <Top title="이메일 발송 테스트" description="공시·지급액·보유확인서를 지정한 테스트 주소로 미리 확인합니다." backLink={{ href: "/admin/notifications", label: "이메일 알림 관리" }} />
      <TemporaryEmailTests initialData={data} />
    </AppShell>
  );
}
