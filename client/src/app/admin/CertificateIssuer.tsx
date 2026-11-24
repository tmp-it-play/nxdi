import Image from "next/image";
import { FUND_TICKER } from "@/lib/brand";

export function CertificateIssuer() {
  return (
    <div className="certificate-issuer">
      <span>발급자</span>
      <strong>{FUND_TICKER}</strong>
      <Image
        alt="원형 직인"
        className="certificate-seal-image"
        height={512}
        priority
        src="/certificate/nxdi-seal-print.png"
        unoptimized
        width={512}
      />
    </div>
  );
}
