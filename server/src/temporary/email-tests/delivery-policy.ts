import { TEST_RECIPIENT } from "./constants.js";

export const temporaryEmailTestDeliveryPolicy = {
  mode: "TEST",
  resolveRecipient(delivery: { userId: string | null; recipientEmail: string | null }) {
    if (delivery.userId !== null || delivery.recipientEmail !== TEST_RECIPIENT) return null;
    return { email: TEST_RECIPIENT };
  }
};
