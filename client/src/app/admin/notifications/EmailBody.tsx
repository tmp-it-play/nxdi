import type { EmailPreview } from "@/lib/notification-types";
import styles from "./notifications.module.css";

export function EmailBody({ subject, html, text }: Pick<EmailPreview, "subject" | "html" | "text">) {
  return (
    <div className={styles.emailBody}>
      <p className={styles.subject}><span>제목</span><strong>{subject}</strong></p>
      {html ? (
        <iframe className={styles.preview} title={`이메일 본문: ${subject}`} sandbox="" srcDoc={html} referrerPolicy="no-referrer" tabIndex={-1} />
      ) : <pre className={styles.plainText}>{text}</pre>}
    </div>
  );
}
