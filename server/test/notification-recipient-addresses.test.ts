import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectNotificationAddresses } from "../src/application/notification-recipient-addresses.js";

const completed = (userEmail: string, id: string, userId = "investor-1") => ({
  id, userId, userEmail, status: "COMPLETED"
});

describe("Given a notification is prepared for an investor", () => {
  describe("When five completed intents have five different applicant emails", () => {
    it("Then every distinct email is selected as a recipient", () => {
      const intents = [
        completed("one@example.com", "one"),
        completed("two@example.com", "two"),
        completed("three@example.com", "three"),
        completed("four@example.com", "four"),
        completed("five@example.com", "five")
      ];

      assert.deepEqual(selectNotificationAddresses(intents, "investor-1"), {
        emails: ["five@example.com", "four@example.com", "one@example.com", "three@example.com", "two@example.com"],
        hasInvalidEmail: false
      });
    });
  });

  describe("When completed intents repeat an address or another user has an intent", () => {
    it("Then each address is selected once for the requested investor", () => {
      const intents = [
        completed("investor@example.com", "one"),
        completed("INVESTOR@example.com", "two"),
        completed("other@example.com", "other", "investor-2"),
        { ...completed("pending@example.com", "pending"), status: "PENDING" }
      ];

      assert.deepEqual(selectNotificationAddresses(intents, "investor-1"), {
        emails: ["investor@example.com"],
        hasInvalidEmail: false
      });
    });
  });

  describe("When a completed intent has an invalid applicant email", () => {
    it("Then valid addresses remain eligible and the invalid address is reported", () => {
      assert.deepEqual(selectNotificationAddresses([
        completed("valid@gmail.com", "valid"),
        completed("invalid@", "invalid")
      ], "investor-1"), {
        emails: ["valid@gmail.com"],
        hasInvalidEmail: true
      });
    });
  });

  describe("When the investor has no completed intent", () => {
    it("Then no login email is substituted as a recipient", () => {
      assert.deepEqual(selectNotificationAddresses([
        { ...completed("pending@example.com", "pending"), status: "PENDING" }
      ], "investor-1"), {
        emails: [],
        hasInvalidEmail: false
      });
    });
  });
});
