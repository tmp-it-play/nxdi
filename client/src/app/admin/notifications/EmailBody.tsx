import type { EmailPreview } from "@/lib/notification-types";
import styles from "./notifications.module.css";

export function EmailBody({ subject, html, text }: Pick<EmailPreview, "subject" | "html" | "text">) {
  return (
    <div className={styles.emailBody}>
      <p className={styles.subject}><span>제목</span><strong>{subject}</strong></p>
      <iframe className={styles.preview} title={`이메일 미리보기: ${subject}`} sandbox="" srcDoc={html} referrerPolicy="no-referrer" />
      <details className={styles.textDetails}>
        <summary>일반 텍스트 보기</summary>
        <pre>{text}</pre>
      </details>
    </div>
  );
}
