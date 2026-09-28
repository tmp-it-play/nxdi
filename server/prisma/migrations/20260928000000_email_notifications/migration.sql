-- CreateTable
CREATE TABLE `tb_notification_recipients` (
    `user_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NULL,
    `name` VARCHAR(191) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `confirmed_at` DATETIME(3) NULL,
    `address_version` INTEGER NOT NULL DEFAULT 1,
    `error_code` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_notification_events` (
    `id` VARCHAR(191) NOT NULL,
    `business_key` VARCHAR(191) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `mode` VARCHAR(16) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `period` VARCHAR(16) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `source_id` VARCHAR(191) NULL,
    `source_updated_at` DATETIME(3) NULL,
    `parent_id` VARCHAR(191) NULL,
    `reason` VARCHAR(1000) NULL,
    `requested_by` VARCHAR(191) NULL,
    `request_key` VARCHAR(191) NULL,
    `eligible_at` DATETIME(3) NOT NULL,
    `prepared_at` DATETIME(3) NULL,
    `payload` JSON NOT NULL,
    `subject` VARCHAR(255) NULL,
    `html` LONGTEXT NULL,
    `text` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_notification_events_business_key`(`business_key`),
    UNIQUE INDEX `uq_notification_events_request_key`(`request_key`),
    INDEX `idx_notification_events_mode_status_eligible`(`mode`, `status`, `eligible_at`),
    INDEX `idx_notification_events_type_period`(`type`, `period`),
    INDEX `idx_notification_events_source_type`(`source_id`, `type`),
    INDEX `idx_notification_events_requester_created`(`requested_by`, `created_at`),
    INDEX `idx_notification_events_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_email_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `recipient_key` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `recipient_email` VARCHAR(254) NULL,
    `recipient_name` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `html` LONGTEXT NOT NULL,
    `text` LONGTEXT NOT NULL,
    `payload` JSON NULL,
    `message_id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL,
    `claim_token` VARCHAR(191) NULL,
    `claimed_until` DATETIME(3) NULL,
    `last_error_code` VARCHAR(64) NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_email_deliveries_message_id`(`message_id`),
    INDEX `idx_email_deliveries_status_next_attempt`(`status`, `next_attempt_at`),
    INDEX `idx_email_deliveries_status_claim_expiry`(`status`, `claimed_until`),
    INDEX `idx_email_deliveries_user_created`(`user_id`, `created_at`),
    UNIQUE INDEX `uq_email_deliveries_event_recipient`(`event_id`, `recipient_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_email_delivery_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `delivery_id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `to_email` VARCHAR(254) NOT NULL,
    `address_version` INTEGER NULL,
    `status` VARCHAR(32) NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `response_code` INTEGER NULL,
    `response` VARCHAR(255) NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NULL,
    `resolution_note` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_email_delivery_attempts_delivery_number`(`delivery_id`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tb_notification_controls` (
    `id` VARCHAR(64) NOT NULL,
    `activated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tb_email_deliveries` ADD CONSTRAINT `tb_email_deliveries_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `tb_notification_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tb_email_delivery_attempts` ADD CONSTRAINT `tb_email_delivery_attempts_delivery_id_fkey` FOREIGN KEY (`delivery_id`) REFERENCES `tb_email_deliveries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
