import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthNavActions } from "@/app/components/auth-actions";
import { AppShell, Navigation, Top } from "@/app/components/tds";
import { getAdminNotifications, getSession } from "@/lib/api";
import { NotificationManager } from "./NotificationManager";

export const metadata: Metadata = { title: "이메일 알림 관리 | NXDI" };

export default async function NotificationsPage() {
  const data = await getAdminNotifications();
  if (!data) redirect("/admin");
  const { user } = await getSession();

  return (
    <AppShell>
      <Navigation actions={<AuthNavActions user={user} />} />
      <Top
        title="이메일 알림 관리"
        description="공시, 월별 지급액, 분기 보유확인서를 미리 보고 발송 이력을 확인합니다."
        backLink={{ href: "/admin", label: "운영 관리" }}
      />
      <NotificationManager initialData={data} />
    </AppShell>
  );
}
